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

// 👇 УБРАЛИ ЗАХАРДКОЖЕННЫЙ МАССИВ КЛУБОВ

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
const tokensCache = {}; 
const hostsCache = {}; 

const taskHistory = [];
const lastSteamStatuses = {}; 

async function getValidToken(club) {
    const now = Date.now();
    const clubId = club.id || club;

    if (tokensCache[clubId] && tokensCache[clubId].expiresAt > now) {
        return tokensCache[clubId].token;
    }

    const loginResponse = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': `company_id=${club.companyId}`
        },
        body: JSON.stringify({
            query: `mutation login { login(input: { login: "${club.phone}", password: "${club.password}", company_id: ${club.companyId} }) { access_token } }`
        })
    });

    const loginData = await loginResponse.json();
    if (loginData.errors || !loginData.data?.login?.access_token) {
        throw new Error(`Ошибка авторизации для ${club.name || club.clubName}`);
    }

    const token = loginData.data.login.access_token;
    tokensCache[clubId] = { token: token, expiresAt: now + (55 * 60 * 1000) };
    return token;
}

async function fetchHostsFromSmartShell(club) {
    const token = await getValidToken(club);
    const hostsResponse = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': `company_id=${club.companyId}`, 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
          query: `query hostsData {
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
          }`
      })
    });
    const hostsData = await hostsResponse.json();
    return hostsData.data?.hostsOverview || [];
}

// 👇 Обновление хостов каждые 10 секунд (только для настроенного клуба)
setInterval(async () => {
    const config = getConfig();
    if (!config.setupCompleted) return; // Если клуб не настроен — пропускаем

    const clubId = config.credentials.companyId;
    const clubData = {
        id: clubId,
        name: config.clubName,
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
}, 10000); // 👈 10 секунд

// 👇 НОВОЕ: Обновление токена раз в час
setInterval(async () => {
    const config = getConfig();
    if (!config.setupCompleted) return;

    const clubId = config.credentials.companyId;
    const clubData = {
        id: clubId,
        companyId: config.credentials.companyId,
        phone: config.credentials.phone,
        password: config.credentials.password
    };

    try {
        console.log('🔄 Обновление токена для клуба:', clubId);
        const token = await getValidToken(clubData);
        console.log('✅ Токен обновлен успешно');
    } catch (error) {
        console.error('❌ Ошибка обновления токена:', error.message);
    }
}, 3600000); // 👈 1 час (60 * 60 * 1000)

app.get('/api/clubs', (req, res) => {
    const config = getConfig();
    if (!config.setupCompleted) {
        return res.json([]);
    }
    return res.json([{
        id: config.credentials.companyId,
        name: config.clubName
    }]);
});
app.get('/api/games', (req, res) => res.json(GAMES));
app.get('/api/history', (req, res) => res.json(taskHistory));

// 👇 НОВЫЕ API ДЛЯ НАСТРОЙКИ
app.get('/api/config', (req, res) => {
    const config = getConfig();
    // Не отдаём пароль клиенту
    res.json({
        setupCompleted: config.setupCompleted,
        club: config.club,
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
        const loginResponse = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': `company_id=${companyId}` },
            body: JSON.stringify({
                query: `mutation login { login(input: { login: "${phone}", password: "${password}", company_id: ${companyId} }) { access_token } }`
            })
        });

        const loginData = await loginResponse.json();
        console.log('📡 Ответ SmartShell:', loginData);

        if (loginData.errors || !loginData.data?.login?.access_token) {
            console.log('❌ Ошибка авторизации SmartShell:', loginData.errors);
            return res.status(401).json({ error: 'Неверные данные SmartShell. Проверьте телефон, пароль и ID компании.' });
        }

        // Сохраняем конфиг
        const config = updateConfig({
            setupCompleted: true,
            club: `club_${companyId}`,
            clubName: clubName,
            credentials: {
                phone,
                password,
                companyId
            },
            lastTokenRefresh: Date.now()
        });

        // Сохраняем токен в кеш
        tokensCache[config.club] = {
            token: loginData.data.login.access_token,
            expiresAt: Date.now() + (55 * 60 * 1000)
        };

        res.json({ success: true, message: 'Настройка завершена успешно!' });
    } catch (error) {
        console.error('Ошибка настройки:', error);
        res.status(500).json({ error: 'Ошибка подключения к SmartShell' });
    }
});

// 👇 НОВОЕ: Выход из клуба
app.post('/api/config/logout', (req, res) => {
    console.log('🚪 Выход из клуба');

    const config = getConfig();
    const clubId = config.club;

    // Очищаем конфиг
    updateConfig({
        setupCompleted: false,
        club: '',
        clubName: '',
        credentials: {
            phone: '',
            password: '',
            companyId: ''
        },
        lastTokenRefresh: 0
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
  // 👇 НОВАЯ ЛОГИКА: берем данные из конфига
  const config = getConfig();

  if (!config.setupCompleted) {
    return res.status(401).json({ error: 'Клуб не настроен. Введите данные в настройках.' });
  }

  const clubId = config.club;
  const clubData = {
    id: clubId,
    name: config.clubName,
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
          // Проверяем активные сессии:
          // Сессия активна если есть оставшееся время (time_left > 0)
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
    if (!config.setupCompleted) return; // Если клуб не настроен — пропускаем

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

// Fallback route для SPA - должен быть последним
app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на http://localhost:${PORT}`);
    console.log(`🌐 Твой локальный IP: ${getLocalIp()}`);

    // Уведомляем главный процесс о готовности сервера
    if (process.send) {
        process.send('server-ready');
    }
});