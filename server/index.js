const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const dgram = require('dgram');
const os = require('os');
const path = require('path');
const packageJson = require('../package.json');
const { getConfig, updateConfig, initConfig } = require('./config-manager');

const app = express();
const PORT = 3000;
const UDP_PORT = 41234;

app.use(cors());
app.use(express.json());

// Инициализация конфига при запуске
initConfig();

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return '127.0.0.1';
}

const udpServer = dgram.createSocket('udp4');
udpServer.on('message', (msg, rinfo) => {
    if (msg.toString() === 'DISCOVER_CLUB_UPDATE_SERVER') {
        const ip = getLocalIp();
        const response = JSON.stringify({ ip: ip, port: PORT });
        udpServer.send(response, rinfo.port, rinfo.address);
    }
});
udpServer.bind(UDP_PORT);

const GAMES = [
  { appId: '730', name: 'CS 2' },
  { appId: '570', name: 'DOTA 2' },
  { appId: '252490', name: 'RUST' },
  { appId: '578080', name: 'PUBG' },
  { appId: '10', name: 'CS 1.6' },
  { appId: '240', name: 'CS Source' },
  { appId: '236390', name: 'War Thunder' },
  { appId: '1422450', name: 'Deadlock' },
  { appId: '271590', name: 'GTA V' },
  { appId: '1407200', name: 'World of Tanks' },
  { appId: '444200', name: 'World of Tanks Blitz' }
];

const agentsData = {};
const commandsQueue = {};
const API_URL = 'https://billing.smartshell.gg/api/graphql';
const tokensCache = {}; // Простой кеш токенов: { [clubId]: token }
const hostsCache = {};

const taskHistory = [];
const lastSteamStatuses = {};

// 👇 НОВОЕ: Функция для получения токена (с авторизацией при необходимости)
async function loginToSmartShell(companyId, phone, password) {
    console.log('🔐 Авторизация в SmartShell для компании:', companyId);

    const loginResponse = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': `company_id=${companyId}`
        },
        body: JSON.stringify({
            query: `mutation login { login(input: { login: "${phone}", password: "${password}", company_id: ${companyId} }) { access_token } }`
        })
    });

    const loginData = await loginResponse.json();

    if (loginData.errors || !loginData.data?.login?.access_token) {
        throw new Error('Ошибка авторизации SmartShell');
    }

    const token = loginData.data.login.access_token;
    console.log('✅ Токен получен успешно');

    return token;
}

// 👇 НОВОЕ: Обертка для всех запросов к SmartShell API
async function fetchFromSmartShell(query, clubData) {
    const clubId = clubData.companyId;

    // Если токена нет в кеше - получаем новый
    if (!tokensCache[clubId]) {
        const token = await loginToSmartShell(clubData.companyId, clubData.phone, clubData.password);
        tokensCache[clubId] = token;
    }

    // Делаем запрос с текущим токеном
    let response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': `company_id=${clubData.companyId}`,
            'Authorization': `Bearer ${tokensCache[clubId]}`
        },
        body: JSON.stringify({ query })
    });

    let data = await response.json();

    // Если получили ошибку авторизации - обновляем токен и повторяем запрос
    if (data.errors && data.errors.some(err =>
        err.message?.includes('Unauthenticated') ||
        err.message?.includes('Unauthorized') ||
        err.extensions?.category === 'authentication'
    )) {
        console.log('⚠️  Токен протух, получаем новый...');

        // Получаем новый токен
        const newToken = await loginToSmartShell(clubData.companyId, clubData.phone, clubData.password);
        tokensCache[clubId] = newToken;

        // Повторяем запрос с новым токеном
        response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': `company_id=${clubData.companyId}`,
                'Authorization': `Bearer ${tokensCache[clubId]}`
            },
            body: JSON.stringify({ query })
        });

        data = await response.json();
    }

    return data;
}

// 👇 ОБНОВЛЕННАЯ: Функция получения хостов через обертку
async function fetchHostsFromSmartShell(clubData) {
    const query = `query hostsData {
        hostsOverview {
            id
            alias
            online
            in_service
            ip_addr
            client_sessions {
                id
                started_at
                finished_at
                duration
                elapsed
                time_left
            }
        }
    }`;

    const data = await fetchFromSmartShell(query, clubData);
    return data.data?.hostsOverview || [];
}

// 👇 Обновление хостов каждые 10 секунд (только для настроенного клуба)
setInterval(async () => {
    const config = getConfig();
    if (!config.setupCompleted) return;

    const clubId = config.credentials.companyId;
    const clubData = {
        companyId: config.credentials.companyId,
        phone: config.credentials.phone,
        password: config.credentials.password
    };

    try {
        const hosts = await fetchHostsFromSmartShell(clubData);
        hostsCache[clubId] = { data: hosts, lastUpdate: Date.now() };
    } catch (error) {
        console.error('❌ Ошибка обновления хостов:', error.message);
    }
}, 10000);

app.get('/api/games', (req, res) => res.json(GAMES));
app.get('/api/history', (req, res) => res.json(taskHistory));

app.get('/api/config', (req, res) => {
    const config = getConfig();
    res.json({
        setupCompleted: config.setupCompleted,
        clubName: config.clubName,
        companyId: config.credentials.companyId
    });
});

app.post('/api/config/setup', async (req, res) => {
    const { clubName, phone, password, companyId } = req.body;

    console.log('📝 Настройка клуба:', { clubName, phone: phone.substring(0, 5) + '***', companyId });

    if (!clubName || !phone || !password || !companyId) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    try {
        // Проверяем данные, пытаясь получить токен
        const token = await loginToSmartShell(companyId, phone, password);

        // Сохраняем конфиг
        updateConfig({
            setupCompleted: true,
            clubName: clubName,
            credentials: {
                phone,
                password,
                companyId
            }
        });

        // Сохраняем токен в кеш
        tokensCache[companyId] = token;

        res.json({ success: true, message: 'Настройка завершена успешно!' });
    } catch (error) {
        console.error('❌ Ошибка настройки:', error.message);
        return res.status(401).json({ error: 'Неверные данные SmartShell. Проверьте телефон, пароль и ID компании.' });
    }
});

app.post('/api/config/logout', (req, res) => {
    console.log('🚪 Выход из клуба');

    const config = getConfig();
    const clubId = config.credentials.companyId;

    // Очищаем конфиг
    updateConfig({
        setupCompleted: false,
        clubName: '',
        credentials: {
            phone: '',
            password: '',
            companyId: ''
        }
    });

    // Очищаем кеш токенов и хостов
    if (clubId) {
        delete tokensCache[clubId];
        delete hostsCache[clubId];
    }

    res.json({ success: true, message: 'Выход выполнен успешно' });
});

app.get('/api/version', (req, res) => {
    res.json({ version: packageJson.version });
});

app.get('/api/pcs', async (req, res) => {
  const config = getConfig();

  if (!config.setupCompleted) {
    return res.status(401).json({ error: 'Клуб не настроен. Введите данные в настройках.' });
  }

  const clubId = config.credentials.companyId;
  const clubData = {
    companyId: config.credentials.companyId,
    phone: config.credentials.phone,
    password: config.credentials.password
  };

  if (!hostsCache[clubId]) {
      try {
          const hosts = await fetchHostsFromSmartShell(clubData);
          hostsCache[clubId] = { data: hosts, lastUpdate: Date.now() };
      } catch (e) {
          console.error('❌ Ошибка загрузки хостов:', e.message);
          return res.status(500).json({ error: 'Ошибка SmartShell' });
      }
  }

  try {
    const hosts = hostsCache[clubId].data;
    const formattedPcs = hosts.map(host => {
      let status = 'Оффлайн';
      let statusColor = 'bg-gray-600';

      if (host.in_service) {
          status = 'Обслуживание'; statusColor = 'bg-yellow-500';
      } else if (host.online) {
          const hasActiveSession = host.client_sessions &&
                                    Array.isArray(host.client_sessions) &&
                                    host.client_sessions.length > 0 &&
                                    host.client_sessions.some(s => s && s.time_left && s.time_left > 0);

          if (hasActiveSession) {
              status = 'В игре'; statusColor = 'bg-blue-500';
          } else {
              status = 'Свободен'; statusColor = 'bg-green-500';
          }
      }

      const pcName = host.alias || `ПК-${host.id}`;
      let diskDataFromAgent = '—'; let steamDataFromAgent = 'Проверить';
      let installedGamesData = [];
      let agentQueue = [];
      let agentLogs = [];
      let workshopSize = '—';
      let agentVersion = '—';
      let gameUpdateStatus = {};

      if (host.ip_addr && agentsData[host.ip_addr]) {
          diskDataFromAgent = agentsData[host.ip_addr].disks;
          steamDataFromAgent = agentsData[host.ip_addr].steam;
          installedGamesData = agentsData[host.ip_addr].installedApps || [];
          agentQueue = agentsData[host.ip_addr].queue || [];
          agentLogs = agentsData[host.ip_addr].logs || [];
          workshopSize = agentsData[host.ip_addr].workshopSize || '—';
          agentVersion = agentsData[host.ip_addr].agentVersion || '—';
          gameUpdateStatus = agentsData[host.ip_addr].gameUpdateStatus || {};
      }
      return {
        id: pcName, status, statusColor, disk: diskDataFromAgent,
        update: steamDataFromAgent, ip: host.ip_addr,
        installedGamesData: installedGamesData,
        queue: agentQueue,
        logs: agentLogs,
        workshopSize: workshopSize,
        agentVersion: agentVersion,
        gameUpdateStatus: gameUpdateStatus,
        updateColor: steamDataFromAgent.includes('✅') ? 'text-green-500' : (steamDataFromAgent.includes('⏳') || steamDataFromAgent.includes('🗑️') || steamDataFromAgent.includes('🔄') ? 'text-yellow-500' : 'text-club-accent')
      };
    });
    res.json(formattedPcs);
  } catch (error) {
    console.error('❌ Ошибка форматирования ПК:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/agent/report', (req, res) => {
  const { ips, disksInfo, steamStatus, installedApps, queue, activeGame, logs, workshopSize, agentVersion, gameUpdateStatus } = req.body;
  if (ips && Array.isArray(ips)) {
    const ip = ips[0];

    if (steamStatus && steamStatus !== lastSteamStatuses[ip]) {
        if ((steamStatus.includes('✅') || steamStatus.includes('❌')) && !steamStatus.includes('Готов')) {
            let pcName = ip;
            for (const clubId in hostsCache) {
                const host = hostsCache[clubId].data.find(h => h.ip_addr === ip);
                if (host) { pcName = host.alias || `ПК-${host.id}`; break; }
            }
            taskHistory.unshift({
                id: Date.now(),
                time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                pc: pcName,
                action: steamStatus.replace('✅ ', '').replace('❌ ', ''),
                status: steamStatus.includes('✅') ? 'success' : 'error'
            });
            if (taskHistory.length > 100) taskHistory.pop();
        }
        lastSteamStatuses[ip] = steamStatus;
    }

    ips.forEach(ip => {
        agentsData[ip] = { disks: disksInfo, steam: steamStatus, installedApps: installedApps || [], queue: queue || [], activeGame: activeGame || null, logs: logs || [], workshopSize: workshopSize || '—', agentVersion: agentVersion || '—', gameUpdateStatus: gameUpdateStatus || {} };
    });
  }
  res.json({ success: true });
});

app.post('/api/command', (req, res) => {
    const { ip, action, appId, customAuth } = req.body;
    if (!ip || !action) return res.status(400).json({ error: 'Нужен IP и действие' });
    let gameName = '';
    if (appId) {
        const game = GAMES.find(g => g.appId === appId);
        gameName = game ? game.name : `App ${appId}`;
    }
    if (!commandsQueue[ip]) commandsQueue[ip] = [];
    commandsQueue[ip].push({ action, appId, gameName, customAuth });
    res.json({ success: true });
});

app.post('/api/update_all_free', async (req, res) => {
    const { games, customAuth } = req.body;
    const config = getConfig();
    if (!config.setupCompleted) {
        return res.status(401).json({ error: 'Клуб не настроен' });
    }
    const clubId = config.credentials.companyId;
    try {
        const hosts = hostsCache[clubId]?.data || [];
        let updatedCount = 0;
        hosts.forEach(host => {
            const hasActiveSession = host.client_sessions && host.client_sessions.some(s => !s.finished_at);
            if (host.online && !host.in_service && host.ip_addr && !hasActiveSession) {
                if (!commandsQueue[host.ip_addr]) commandsQueue[host.ip_addr] = [];
                commandsQueue[host.ip_addr].push({ action: 'update_all', games: games || GAMES, customAuth });
                updatedCount++;
            }
        });
        res.json({ success: true, count: updatedCount });
    } catch (error) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/clear_workshop_all_free', async (req, res) => {
    const config = getConfig();
    if (!config.setupCompleted) {
        return res.status(401).json({ error: 'Клуб не настроен' });
    }
    const clubId = config.credentials.companyId;
    try {
        const hosts = hostsCache[clubId]?.data || [];
        let clearedCount = 0;
        hosts.forEach(host => {
            const hasActiveSession = host.client_sessions && host.client_sessions.some(s => !s.finished_at);
            if (host.online && !host.in_service && host.ip_addr && !hasActiveSession) {
                if (!commandsQueue[host.ip_addr]) commandsQueue[host.ip_addr] = [];
                commandsQueue[host.ip_addr].push({ action: 'clear_workshop' });
                clearedCount++;
            }
        });
        res.json({ success: true, count: clearedCount });
    } catch (error) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/update_agents_all', async (req, res) => {
    const config = getConfig();
    if (!config.setupCompleted) {
        return res.status(401).json({ error: 'Клуб не настроен' });
    }
    const clubId = config.credentials.companyId;
    try {
        const hosts = hostsCache[clubId]?.data || [];
        let count = 0;
        hosts.forEach(host => {
            if (host.online && host.ip_addr) {
                if (!commandsQueue[host.ip_addr]) commandsQueue[host.ip_addr] = [];
                commandsQueue[host.ip_addr].push({ action: 'update_agent' });
                count++;
            }
        });
        res.json({ success: true, count });
    } catch (error) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/command/:ip', (req, res) => {
    const ip = req.params.ip;
    if (commandsQueue[ip] && commandsQueue[ip].length > 0) {
        const commands = [...commandsQueue[ip]];
        commandsQueue[ip] = [];
        res.json({ commands: commands });
    } else {
        res.json({ commands: [] });
    }
});

cron.schedule('0 6 * * *', async () => {
    const config = getConfig();
    if (!config.setupCompleted) return;

    const clubId = config.credentials.companyId;
    try {
        const hosts = hostsCache[clubId]?.data || [];
        hosts.forEach(host => {
            const hasActiveSession = host.client_sessions && host.client_sessions.some(s => !s.finished_at);
            if (host.online && !host.in_service && host.ip_addr && !hasActiveSession) {
                if (!commandsQueue[host.ip_addr]) commandsQueue[host.ip_addr] = [];
                commandsQueue[host.ip_addr].push({ action: 'update_all', games: GAMES });
            }
        });
    } catch (error) {
        console.error('❌ Ошибка cron задачи:', error.message);
    }
});

app.use(express.static(path.join(__dirname, '../dist')));

app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на http://localhost:${PORT}`);
    console.log(`🌐 Твой локальный IP: ${getLocalIp()}`);

    if (process.send) {
        process.send('server-ready');
    }
});
