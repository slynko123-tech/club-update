const os = require('os');
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// 👇 НАСТРОЙКИ ЯНДЕКС.ДИСКА
const YANDEX_TOKEN = 'y0__wgBEISkm6wFGNuWAyDC7vTLGWU0F0dbBxnmvFEVZmDGsnI2nRqG';
const AGENT_VERSION = '1.0.9'; // 👈 Версия агента

// 👇 ЛОГИ
let agentLogs = [];
const originalLog = console.log;
console.log = function(...args) {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    const time = new Date().toLocaleTimeString();
    agentLogs.push(`[${time}] ${msg}`);
    if (agentLogs.length > 100) agentLogs.shift();
    originalLog.apply(console, args);
};
const originalError = console.error;
console.error = function(...args) {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    const time = new Date().toLocaleTimeString();
    agentLogs.push(`[${time}] [ОШИБКА] ${msg}`);
    if (agentLogs.length > 100) agentLogs.shift();
    originalError.apply(console, args);
};

process.on('unhandledRejection', (reason) => {
    console.error('⚠️ Необработанная ошибка:', reason);
});

const baseDir = process.pkg ? path.dirname(process.execPath) : __dirname;
const steamCmdPath = path.join(baseDir, 'steamcmd', 'steamcmd.exe');
const configPath = path.join(baseDir, 'config.json');

let currentSteamStatus = '✅ Готов';
let SERVER_URL = 'http://localhost:3000';
let DEFAULT_STEAM_USER = 'anonymous';
let DEFAULT_STEAM_PASS = '';
let DEFAULT_STEAM_PIN = '';

let taskQueue = [];
let isProcessingTask = false;
let isReporting = false;
let isCancelled = false;

// 👇 ХРАНИМ СТАТУС ОБНОВЛЕНИЙ ДЛЯ КАЖДОЙ ИГРЫ
let gameUpdateStatus = {}; 

let cachedDisksInfo = 'Загрузка...';
let cachedInstalledGames = [];
let cachedWorkshopSize = '—';
let lastCacheUpdate = 0;
let lastWorkshopCalc = 0;
let gameStatusCache = {}; // ← Кэш статусов игр
let lastGameStatusCheck = {}; // ← Время последней проверки каждой игры

if (fs.existsSync(configPath)) {
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        SERVER_URL = config.serverUrl || SERVER_URL;
        DEFAULT_STEAM_USER = config.steamUsername || DEFAULT_STEAM_USER;
        DEFAULT_STEAM_PASS = config.steamPassword || DEFAULT_STEAM_PASS;
        DEFAULT_STEAM_PIN = config.steamPin || DEFAULT_STEAM_PIN;
    } catch (e) {
        console.error('⚠️ Ошибка чтения config.json:', e.message);
    }
}

async function fetchWithTimeout(url, options = {}, timeout = 3000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (e) {
        clearTimeout(id);
        throw e;
    }
}

function getAllIps() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
        }
    }
    return ips;
}

function getActiveGame() {
    try {
        const stdout = execSync('tasklist').toString().toLowerCase();
        const games = [
            { proc: 'cs2.exe', name: 'CS 2' }, { proc: 'dota2.exe', name: 'Dota 2' },
            { proc: 'csgo.exe', name: 'CS:GO' }, { proc: 'rust.exe', name: 'Rust' },
            { proc: 'pubg.exe', name: 'PUBG' }, { proc: 'tslgame.exe', name: 'PUBG' },
            { proc: 'warthunder.exe', name: 'War Thunder' }, { proc: 'gta5.exe', name: 'GTA V' },
            { proc: 'deadlock.exe', name: 'Deadlock' }
        ];
        for (const g of games) {
            if (stdout.includes(g.proc)) return g.name;
        }
    } catch(e) {}
    return null;
}

function getDisksInfo() {
    if (Date.now() - lastCacheUpdate < 30000 && cachedDisksInfo !== 'Загрузка...') return cachedDisksInfo;
    try {
        const stdout = execSync('powershell -command "Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID, FreeSpace | ConvertTo-Json"').toString().trim();
        let disks = JSON.parse(stdout);
        if (!Array.isArray(disks)) disks = [disks];
        cachedDisksInfo = disks.map(disk => `${disk.DeviceID} (${Math.round(disk.FreeSpace / (1024 * 1024 * 1024))} ГБ свободно)`).join(', ');
        return cachedDisksInfo;
    } catch (e) { return 'Ошибка чтения дисков'; }
}

function findSteamPath() {
    try {
        const regQuery = execSync('reg query HKCU\\Software\\Valve\\Steam /v SteamPath').toString();
        const match = regQuery.match(/SteamPath\s+REG_SZ\s+(.+)/);
        if (match) {
            const p = match[1].trim().replace(/\//g, '\\');
            if (fs.existsSync(path.join(p, 'steam.exe'))) return p;
        }
    } catch (e) {}
    try {
        const regQuery = execSync('reg query HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam /v InstallPath').toString();
        const match = regQuery.match(/InstallPath\s+REG_SZ\s+(.+)/);
        if (match) {
            const p = match[1].trim().replace(/\//g, '\\');
            if (fs.existsSync(path.join(p, 'steam.exe'))) return p;
        }
    } catch (e) {}
    const commonPaths = ['C:\\Program Files (x86)\\Steam','C:\\Program Files\\Steam','D:\\Steam','E:\\Steam','D:\\Games\\Steam','C:\\Games\\Steam'];
    for (const p of commonPaths) {
        if (fs.existsSync(path.join(p, 'steam.exe'))) return p;
    }
    try {
        const drives = ['C:', 'D:', 'E:', 'F:'];
        for (const drive of drives) {
            if (fs.existsSync(drive + '\\')) {
                const steamDir = path.join(drive + '\\', 'Steam');
                if (fs.existsSync(path.join(steamDir, 'steam.exe'))) return steamDir;
            }
        }
    } catch(e) {}
    return null;
}

function ensureSystemPermissions() {
    const steamPath = findSteamPath();
    if (!steamPath) return;
    try {
        const steamappsPath = path.join(steamPath, 'steamapps');
        if (fs.existsSync(steamappsPath)) {
            fs.readdirSync(steamappsPath);
            return; 
        }
    } catch (e) {
        console.log(`🔧 Нет прав SYSTEM. Выдаю права в фоне...`);
        const { exec } = require('child_process');
        exec(`icacls "${steamPath}" /grant "SYSTEM:(OI)(CI)(RX)"`, (err) => {
            if (err) console.error('❌ Ошибка выдачи прав:', err.message);
            else console.log(`✅ Права доступа SYSTEM выданы (в фоне).`);
        });
    }
}

function getSteamLibraries() {
    const steamPath = findSteamPath();
    if (!steamPath) return [];
    const libraries = [steamPath];
    const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
    if (fs.existsSync(vdfPath)) {
        const content = fs.readFileSync(vdfPath, 'utf8');
        const pathMatches = [...content.matchAll(/"path"\s+"([^"]+)"/g)];
        pathMatches.forEach(m => {
            const libPath = m[1].replace(/\\\\/g, '\\');
            if (!libraries.includes(libPath)) libraries.push(libPath);
        });
    }
    return libraries;
}

function getDirSize(directoryPath) {
    let size = 0;
    if (!fs.existsSync(directoryPath)) return 0;
    try {
        const files = fs.readdirSync(directoryPath, { withFileTypes: true });
        for (const file of files) {
            const filePath = path.join(directoryPath, file.name);
            if (file.isDirectory()) size += getDirSize(filePath);
            else { try { size += fs.statSync(filePath).size; } catch (e) {} }
        }
    } catch (e) {}
    return size;
}

function getWorkshopSize() {
    // Увеличен кэш с 60 до 300 секунд (5 минут)
    if (Date.now() - lastWorkshopCalc < 300000) return cachedWorkshopSize;
    let totalBytes = 0;
    try {
        const libraries = getSteamLibraries();
        for (const lib of libraries) {
            const workshopPath = path.join(lib, 'steamapps', 'workshop');
            if (fs.existsSync(workshopPath)) totalBytes += getDirSize(workshopPath);
        }
        cachedWorkshopSize = `${(totalBytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
        lastWorkshopCalc = Date.now();
        return cachedWorkshopSize;
    } catch (e) { return '—'; }
}

function getInstalledGamesData() {
    if (Date.now() - lastCacheUpdate < 30000 && cachedInstalledGames.length > 0) return cachedInstalledGames;
    const libraries = getSteamLibraries();
    const installedGames = [];
    for (const lib of libraries) {
        const steamappsPath = path.join(lib, 'steamapps');
        if (fs.existsSync(steamappsPath)) {
            try {
                const files = fs.readdirSync(steamappsPath);
                for (const file of files) {
                    const match = file.match(/^appmanifest_(\d+)\.acf$/);
                    if (match) {
                        const appId = match[1];
                        const filePath = path.join(steamappsPath, file);
                        const content = fs.readFileSync(filePath, 'utf8');
                        const nameMatch = content.match(/"name"\s+"([^"]+)"/);
                        const name = nameMatch ? nameMatch[1] : `App ${appId}`;
                        installedGames.push({ appId, name });
                    }
                }
            } catch (e) {}
        }
    }
    const uniqueGames = [];
    const seen = new Set();
    for (const game of installedGames) {
        if (!seen.has(game.appId)) { seen.add(game.appId); uniqueGames.push(game); }
    }
    cachedInstalledGames = uniqueGames;
    lastCacheUpdate = Date.now();
    return uniqueGames;
}

function isSteamRunning() {
    try {
        const stdout = execSync('tasklist /FI "IMAGENAME eq steam.exe"').toString();
        return stdout.includes('steam.exe');
    } catch (e) { return false; }
}

function getLocalBuildId(appId) {
    const libraries = getSteamLibraries();
    for (const lib of libraries) {
        const manifestPath = path.join(lib, 'steamapps', `appmanifest_${appId}.acf`);
        if (fs.existsSync(manifestPath)) {
            const content = fs.readFileSync(manifestPath, 'utf8');
            const buildMatch = content.match(/"buildid"\s+"(\d+)"/);
            const dirMatch = content.match(/"installdir"\s+"([^"]+)"/);
            if (buildMatch && dirMatch) return { buildId: buildMatch[1], libraryDir: lib, installDirName: dirMatch[1] };
        }
    }
    return null;
}

// 👇 ФУНКЦИЯ ПРОВЕРКИ СТАТУСА ИГРЫ (С КЭШИРОВАНИЕМ)
function checkGameStatus(appId) {
    // Проверяем кэш (10 минут)
    const cacheKey = appId;
    const now = Date.now();
    if (gameStatusCache[cacheKey] && lastGameStatusCheck[cacheKey] && (now - lastGameStatusCheck[cacheKey] < 600000)) {
        console.log(`✅ Используем кэшированный статус для App ${appId}`);
        return gameStatusCache[cacheKey];
    }

    const local = getLocalBuildId(appId);
    if (!local) {
        const result = { status: '❌ Не установлена', dir: null };
        gameStatusCache[cacheKey] = result;
        lastGameStatusCheck[cacheKey] = now;
        return result;
    }
    try {
        const command = `"${steamCmdPath}" +login anonymous +app_info_print ${appId} +quit`;
        const stdout = execSync(command, { timeout: 30000 }).toString();
        const remoteMatch = stdout.match(/"buildid"\s+"(\d+)"/);
        if (remoteMatch && remoteMatch[1]) {
            const result = local.buildId === remoteMatch[1]
                ? { status: '✅ Актуален', dir: local.libraryDir }
                : { status: '🔄 Есть обновление', dir: local.libraryDir };
            gameStatusCache[cacheKey] = result;
            lastGameStatusCheck[cacheKey] = now;
            return result;
        }
    } catch (e) { console.error(e); }
    const result = { status: '❓ Ошибка', dir: local.libraryDir };
    gameStatusCache[cacheKey] = result;
    lastGameStatusCheck[cacheKey] = now;
    return result;
}

// 👇 ФУНКЦИЯ МАССОВОЙ ПРОВЕРКИ
async function performCheck(games, ips) {
    const updates = [];
    for (const game of games) {
        const res = checkGameStatus(game.appId);
        gameUpdateStatus[game.appId] = res.status; // Сохраняем статус
        if (res.status === '🔄 Есть обновление') {
            updates.push(game.name);
        }
    }
    if (updates.length > 0) {
        currentSteamStatus = `🔄 Требуют обновления: ${updates.join(', ')}`;
    } else {
        currentSteamStatus = '✅ Все игры актуальны';
    }
    await sendReport(ips, [], getActiveGame());
}

// 👇 ФУНКЦИЯ ПОИСКА ПАПКИ (С ПРОВЕРКОЙ РАЗМЕРА)
function findBestInstallDir(appId, gameName) {
    try {
        const libraries = getSteamLibraries();
        if (libraries.length === 0) {
            console.log('⚠️ Библиотеки Steam не найдены. Качаю в D:\\SteamCMD_Library');
            return 'D:\\SteamCMD_Library';
        }

        const cleanGameName = gameName.toLowerCase().replace(/[^a-z0-9]/g, '');

        for (const lib of libraries) {
            const commonPath = path.join(lib, 'steamapps', 'common');
            if (fs.existsSync(commonPath)) {
                const folders = fs.readdirSync(commonPath);
                for (const folder of folders) {
                    const cleanFolder = folder.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (cleanFolder.includes(cleanGameName) || cleanGameName.includes(cleanFolder)) {
                        const gamePath = path.join(commonPath, folder);
                        
                        const dirSizeBytes = getDirSize(gamePath);
                        const dirSizeMB = dirSizeBytes / (1024 * 1024);
                        
                        if (dirSizeMB > 100) {
                            console.log(`⚠️ ВНИМАНИЕ: Найдена папка игры "${folder}" (${dirSizeMB.toFixed(1)} МБ) в ${lib}, но нет манифеста!`);
                            console.log(`⚠️ Чтобы не качать заново, обновление отменено. Запустите игру через Steam для создания манифеста.`);
                            return null; 
                        } else {
                            console.log(`🧹 Найдена пустая/битая папка "${folder}" (${dirSizeMB.toFixed(1)} МБ). Удаляю и качаю заново...`);
                            try {
                                fs.rmSync(gamePath, { recursive: true, force: true });
                            } catch (e) {
                                console.log(`⚠️ Не удалось удалить папку: ${e.message}`);
                            }
                        }
                    }
                }
            }
        }

        let bestLib = libraries[0];
        let maxFree = -1;

        for (const lib of libraries) {
            try {
                const drive = lib.substring(0, 2);
                const psCommand = `(Get-PSDrive ${drive.replace(':', '')}).Free`;
                const freeBytes = parseInt(execSync(`powershell -command "${psCommand}"`).toString().trim(), 10);
                
                if (freeBytes > maxFree) {
                    maxFree = freeBytes;
                    bestLib = lib;
                }
            } catch (e) {}
        }
        
        console.log(`💾 Выбрана библиотека Steam для установки: ${bestLib} (Свободно: ${Math.round(maxFree / (1024*1024*1024))} ГБ)`);
        return bestLib;
    } catch (e) {
        return 'D:\\SteamCMD_Library'; 
    }
}

// 👇 ФУНКЦИЯ АВТООБНОВЛЕНИЯ АГЕНТА
async function getYandexDirectLink(filePathOnDisk) {
    const encodedPath = encodeURIComponent(filePathOnDisk);
    const apiUrl = `https://cloud-api.yandex.net/v1/disk/resources/download?path=${encodedPath}`;
    try {
        const response = await fetch(apiUrl, {
            headers: { 'Authorization': `OAuth ${YANDEX_TOKEN}` }
        });
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        const data = await response.json();
        return data.href;
    } catch (error) {
        console.error('Ошибка получения ссылки с Яндекс.Диска:', error.message);
        return null;
    }
}

async function checkSelfUpdate() {
    try {
        const versionJsonUrl = await getYandexDirectLink('/ClubUpdate/agent/version.json');
        if (!versionJsonUrl) return;

        const versionRes = await fetch(versionJsonUrl);
        const versionData = await versionRes.json();
        
        if (versionData.version && versionData.version !== AGENT_VERSION) {
            console.log(`🔄 Доступно обновление агента: ${versionData.version} (текущая: ${AGENT_VERSION})`);
            
            const exeUrl = await getYandexDirectLink('/ClubUpdate/agent/ClubUpdateAgent.exe');
            if (!exeUrl) return;

            const newExePath = path.join(os.tmpdir(), 'ClubUpdateAgent_new.exe');
            const downloadRes = await fetch(exeUrl);
            const buffer = await downloadRes.arrayBuffer();
            fs.writeFileSync(newExePath, Buffer.from(buffer));
            
            const batPath = path.join(os.tmpdir(), 'update_agent.bat');
            const exePath = process.pkg ? process.execPath : path.join(__dirname, 'ClubUpdateAgent.exe');
            const batContent = `
@echo off
timeout /t 2 /nobreak >nul
taskkill /F /IM ClubUpdateAgent.exe >nul 2>&1
timeout /t 1 /nobreak >nul
move /Y "${newExePath}" "${exePath}"
start "" "C:\\ClubUpdateAgent\\start-hidden.vbs"
del "%~f0"
`;
            fs.writeFileSync(batPath, batContent);
            
            const { spawn } = require('child_process');
            spawn('cmd.exe', ['/c', batPath], { detached: true, stdio: 'ignore' }).unref();
            process.exit(0);
        }
    } catch(e) {
        console.log('Ошибка проверки обновления:', e.message);
    }
}

async function sendReport(ips, queueSummary, activeGame) {
    try {
        await fetchWithTimeout(`${SERVER_URL}/api/agent/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                ips, 
                disksInfo: getDisksInfo(), 
                steamStatus: currentSteamStatus, 
                installedApps: getInstalledGamesData(), 
                queue: queueSummary, 
                activeGame, 
                logs: agentLogs, 
                workshopSize: getWorkshopSize(),
                agentVersion: AGENT_VERSION,
                gameUpdateStatus: gameUpdateStatus // 👈 ОТПРАВЛЯЕМ СТАТУСЫ
            })
        });
    } catch (e) {}
}

async function clearWorkshop(ips) {
    return new Promise(async (resolve) => {
        if (isSteamRunning()) { currentSteamStatus = '⚠️ Steam запущен'; return resolve(); }
        currentSteamStatus = `🔍 Поиск Мастерских...`;
        await sendReport(ips, taskQueue.map(t => t.gameName), getActiveGame());
        try {
            console.log(`🔍 Сканирую папки workshop на всех дисках...`);
            const libraries = getSteamLibraries();
            let totalClearedBytes = 0;
            let clearedFolders = 0;
            for (const lib of libraries) {
                const workshopPath = path.join(lib, 'steamapps', 'workshop');
                if (fs.existsSync(workshopPath)) {
                    const size = getDirSize(workshopPath);
                    console.log(`🗑️ Найдена ${workshopPath} (${(size / (1024 * 1024 * 1024)).toFixed(2)} ГБ). Удаляю...`);
                    fs.rmSync(workshopPath, { recursive: true, force: true });
                    totalClearedBytes += size;
                    clearedFolders++;
                }
            }
            if (clearedFolders > 0) {
                const clearedGB = (totalClearedBytes / (1024 * 1024 * 1024)).toFixed(2);
                console.log(`✅ Очищено папок: ${clearedFolders}. Освобождено: ${clearedGB} ГБ.`);
                currentSteamStatus = `✅ Очищено: ${clearedGB} ГБ`;
            } else {
                console.log(`⚠️ Папка workshop не найдена.`);
                currentSteamStatus = `✅ Мастерская пуста (0 ГБ)`;
            }
        } catch (e) {
            console.error(`❌ Ошибка очистки:`, e.message);
            currentSteamStatus = `❌ Ошибка очистки`;
        }
        lastWorkshopCalc = 0; 
        await sendReport(ips, taskQueue.map(t => t.gameName), getActiveGame());
        setTimeout(resolve, 3000);
    });
}

async function uninstallGame(appId, gameName, ips) {
    return new Promise(async (resolve) => {
        const local = getLocalBuildId(appId);
        if (!local) return resolve();
        if (isSteamRunning()) { currentSteamStatus = '⚠️ Steam запущен'; return resolve(); }
        currentSteamStatus = `🗑️ Удаление: ${gameName}...`;
        await sendReport(ips, taskQueue.map(t => t.gameName), getActiveGame());
        try {
            console.log(`🗑️ Удаляю игру ${gameName}...`);
            const gamePath = path.join(local.libraryDir, 'steamapps', 'common', local.installDirName);
            const manifestPath = path.join(local.libraryDir, 'steamapps', `appmanifest_${appId}.acf`);
            if (fs.existsSync(gamePath)) fs.rmSync(gamePath, { recursive: true, force: true });
            if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
            console.log(`✅ Игра ${gameName} успешно удалена.`);
            currentSteamStatus = `✅ ${gameName}: Удалена`;
        } catch (e) {
            console.error(`❌ Ошибка удаления ${gameName}:`, e.message);
            currentSteamStatus = `❌ Ошибка удаления: ${gameName}`;
        }
        lastCacheUpdate = 0;
        lastWorkshopCalc = 0;
        await sendReport(ips, taskQueue.map(t => t.gameName), getActiveGame());
        setTimeout(resolve, 2000);
    });
}

async function processSingleGame(appId, gameName, ips, customAuth = null) {
    return new Promise(async (resolve) => {
        let success = false;
        let attempts = 0;
        const maxAttempts = 3;

        while (!success && attempts < maxAttempts) {
            if (isCancelled) {
                console.log(`🛑 Задача ${gameName} отменена. Выход из цикла.`);
                return resolve();
            }

            attempts++;
            if (attempts > 1) {
                console.log(`\n🔄 Повторная попытка ${attempts} из ${maxAttempts} для ${gameName}...`);
                currentSteamStatus = `🔄 ${gameName}: Повтор (${attempts}/${maxAttempts})...`;
                await sendReport(ips, taskQueue.map(t => t.gameName), getActiveGame());
                for(let i=0; i<5; i++) {
                    if (isCancelled) return resolve();
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            const local = getLocalBuildId(appId);
            let installDir = local ? local.libraryDir : findBestInstallDir(appId, gameName);
            
            if (!installDir) {
                currentSteamStatus = `❌ ${gameName}: Нет манифеста (отмена)`;
                await sendReport(ips, taskQueue.map(t => t.gameName), getActiveGame());
                return resolve();
            }

            let actionText = local ? 'Обновление' : 'Установка';

            if (isSteamRunning()) { currentSteamStatus = '⚠️ Steam запущен'; return resolve(); }

            if (attempts === 1) {
                currentSteamStatus = `⏳ ${actionText}: ${gameName}...`;
                await sendReport(ips, taskQueue.map(t => t.gameName), getActiveGame());
            }

            const steamUser = customAuth ? customAuth.username : DEFAULT_STEAM_USER;
            const steamPass = customAuth ? customAuth.password : DEFAULT_STEAM_PASS;
            const steamPin = customAuth ? customAuth.pin : DEFAULT_STEAM_PIN;

            const args = ['+force_install_dir', installDir];
            if (steamPass) args.push('+login', steamUser, steamPass);
            else args.push('+login', steamUser); 
            
            args.push('+app_update', appId, '+quit'); 
            
            console.log(`\n🎮 Запуск SteamCMD: login=${steamUser}, app=${appId} (попытка ${attempts})`);
            const child = spawn(steamCmdPath, args);

            let lastSentTime = 0; 
            let errorMsg = ''; 

            child.stdout.on('data', (data) => {
                const text = data.toString();
                process.stdout.write(text);
                if ((text.includes('Family View PIN') || text.includes('Steam Guard code')) && steamPin) {
                    console.log(`\n🔑 Вводим PIN-код...`);
                    child.stdin.write(`${steamPin}\n`);
                }
                if (text.includes('ERROR!') || text.includes('Failed')) errorMsg += text;
                
                const progressMatch = text.match(/progress:\s+([\d\.]+)\s+\((\d+)\s*\/\s*(\d+)\)/);
                if (progressMatch) {
                    const percent = Math.floor(parseFloat(progressMatch[1]));
                    const downloaded = parseInt(progressMatch[2]);
                    const total = parseInt(progressMatch[3]);
                    
                    if (total > 0) {
                        const downloadedMB = (downloaded / (1024*1024)).toFixed(0);
                        const totalMB = (total / (1024*1024)).toFixed(0);
                        currentSteamStatus = `⏳ ${gameName}: ${percent}% (${downloadedMB} / ${totalMB} МБ)`;
                    } else {
                        currentSteamStatus = `⏳ ${gameName}: ${percent}%`;
                    }

                    const now = Date.now();
                    if (now - lastSentTime > 3000) {
                        lastSentTime = now;
                        sendReport(ips, taskQueue.map(t => t.gameName), getActiveGame());
                    }
                }
            });

            child.stderr.on('data', (data) => {
                const text = data.toString();
                process.stderr.write(text);
                errorMsg += text; 
            });

            await new Promise((resolveAttempt) => {
                child.on('close', async (code) => {
                    if (isCancelled) {
                        console.log('🛑 Процесс завершен по команде отмены.');
                        return resolveAttempt(); 
                    }

                    const manifestPath = path.join(installDir, 'steamapps', `appmanifest_${appId}.acf`);
                    
                    if (fs.existsSync(manifestPath)) {
                        success = true;
                        currentSteamStatus = `✅ ${gameName}: Готово`;
                        gameUpdateStatus[appId] = '✅ Актуален'; // Обновили статус
                    } else {
                        console.log(`⚠️ SteamCMD завершился, но файл манифеста (${appId}) не найден.`);
                        
                        const gamePath = path.join(installDir, 'steamapps', 'common', local ? local.installDirName : '');
                        if (local && fs.existsSync(gamePath)) {
                            console.log(`🧹 Удаляю недокачанную папку: ${gamePath}`);
                            try { fs.rmSync(gamePath, { recursive: true, force: true }); } catch(e) {}
                        }

                        if (errorMsg.includes('No subscription')) { 
                            attempts = maxAttempts; 
                            currentSteamStatus = `❌ ${gameName}: Нет лицензии`;
                        } else if (errorMsg.includes('Invalid Password')) {
                            attempts = maxAttempts;
                            currentSteamStatus = `❌ ${gameName}: Неверный пароль`;
                        } else {
                            currentSteamStatus = `❌ ${gameName}: Манифест не создан`;
                        }
                    }
                    resolveAttempt();
                });
            });
        }

        lastCacheUpdate = 0;
        lastWorkshopCalc = 0;
        await sendReport(ips, taskQueue.map(t => t.gameName), getActiveGame());
        setTimeout(resolve, 2000); 
    });
}

async function processQueue(ips) {
    if (isProcessingTask || taskQueue.length === 0 || isCancelled) return;
    
    isProcessingTask = true;
    const task = taskQueue[0]; 

    if (task.action === 'install_or_update') {
        await processSingleGame(task.appId, task.gameName, ips, task.customAuth);
    } else if (task.action === 'uninstall') {
        await uninstallGame(task.appId, task.gameName, ips);
    } else if (task.action === 'clear_workshop') { 
        await clearWorkshop(ips);
    }

    taskQueue.shift(); 
    isProcessingTask = false;
    
    if (!isCancelled) {
        if (taskQueue.length === 0) {
            currentSteamStatus = '✅ Готов';
            await sendReport(ips, [], getActiveGame());
        } else {
            processQueue(ips); 
        }
    }
}

async function checkCommands(ips) {
    try {
        for (const ip of ips) {
            const response = await fetchWithTimeout(`${SERVER_URL}/api/command/${ip}`, {}, 3000).catch(() => null);
            if (!response) continue;
            const data = await response.json();
            
            if (data.commands && data.commands.length > 0) {
                for (const cmd of data.commands) {
                    if (cmd.action === 'cancel_all') {
                        console.log(`🛑 Получена команда ОТМЕНА ВСЕХ ЗАДАЧ!`);
                        isCancelled = true; 
                        try {
                            console.log(`🔪 Убиваю процесс SteamCMD...`);
                            execSync('taskkill /F /IM steamcmd.exe'); 
                        } catch (e) {}
                        taskQueue = [];
                        currentSteamStatus = '✅ Отменено';
                        await sendReport(ips, [], getActiveGame());
                        setTimeout(() => { isCancelled = false; }, 2000);
                        continue;
                    }

                    if (cmd.action === 'update_agent') {
                        console.log(`🔄 Получена команда на обновление агента! Запускаю проверку...`);
                        await checkSelfUpdate();
                        continue;
                    }

                    if (cmd.action === 'check_all' && cmd.games) {
                        performCheck(cmd.games, ips).catch(e => console.error(e));
                        continue;
                    }

                    // 👇 ПРОВЕРКА ОДНОЙ ИГРЫ
                    if (cmd.action === 'check_game' && cmd.appId) {
                        console.log(`🔍 Проверка обновления для App ${cmd.appId}...`);
                        const res = checkGameStatus(cmd.appId);
                        gameUpdateStatus[cmd.appId] = res.status;
                        await sendReport(ips, [], getActiveGame());
                        continue;
                    }

                    if (cmd.action === 'update_all' && cmd.games) {
                        for (const game of cmd.games) {
                            taskQueue.push({ action: 'install_or_update', appId: game.appId, gameName: game.name, customAuth: cmd.customAuth });
                        }
                    } else if (cmd.action === 'install_or_update' || cmd.action === 'uninstall' || cmd.action === 'clear_workshop') { 
                        taskQueue.push(cmd);
                        console.log(`📥 Задача добавлена в очередь: ${cmd.action} (${cmd.gameName || 'Очистка'})`);
                    }
                }
                processQueue(ips); 
            }
        }
    } catch (error) {}
}

async function mainLoop() {
    if (isReporting) return;
    isReporting = true;
    try {
        const ips = getAllIps();
        await sendReport(ips, taskQueue.map(t => t.gameName || (t.action === 'clear_workshop' ? 'Очистка Мастерской' : `App ${t.appId}`)), getActiveGame());
        await checkCommands(ips);
    } catch (error) {}
    isReporting = false;
    setTimeout(mainLoop, 5000); // ← Увеличено с 3000 до 5000 мс
}

console.log(`🤖 Агент запущен (v${AGENT_VERSION}). Слушаю сервер: ${SERVER_URL}`);
ensureSystemPermissions(); 
checkSelfUpdate();
mainLoop();