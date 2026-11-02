const os = require('os');
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

process.on('unhandledRejection', (reason) => {
    console.error('⚠️ Ошибка:', reason.message || reason);
});

const SERVER_URL = 'http://localhost:3000';
const steamCmdPath = path.join(__dirname, 'steamcmd', 'steamcmd.exe');
const authPath = path.join(__dirname, 'steam_auth.json');

let currentSteamStatus = '✅ Готов';
let isUpdating = false; 

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

function getDisksInfo() {
    try {
        const stdout = execSync('powershell -command "Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID, FreeSpace | ConvertTo-Json"').toString().trim();
        let disks = JSON.parse(stdout);
        if (!Array.isArray(disks)) disks = [disks];
        return disks.map(disk => `${disk.DeviceID} (${Math.round(disk.FreeSpace / (1024 * 1024 * 1024))} ГБ свободно)`).join(', ');
    } catch (e) { return 'Ошибка чтения дисков'; }
}

function findSteamPath() {
    try {
        const regQuery = execSync('reg query HKCU\\Software\\Valve\\Steam /v SteamPath').toString();
        const match = regQuery.match(/SteamPath\s+REG_SZ\s+(.+)/);
        if (match) return match[1].trim().replace(/\//g, '\\');
    } catch (e) {
        try {
            const regQuery = execSync('reg query HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam /v InstallPath').toString();
            const match = regQuery.match(/InstallPath\s+REG_SZ\s+(.+)/);
            if (match) return match[1].trim().replace(/\//g, '\\');
        } catch (err) {}
    }
    return null;
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

function getInstalledAppIds() {
    const libraries = getSteamLibraries();
    const installed = new Set();
    for (const lib of libraries) {
        const steamappsPath = path.join(lib, 'steamapps');
        if (fs.existsSync(steamappsPath)) {
            try {
                const files = fs.readdirSync(steamappsPath);
                for (const file of files) {
                    const match = file.match(/^appmanifest_(\d+)\.acf$/);
                    if (match) installed.add(match[1]);
                }
            } catch (e) {}
        }
    }
    return Array.from(installed);
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
            const match = content.match(/"buildid"\s+"(\d+)"/);
            if (match) return { buildId: match[1], dir: lib };
        }
    }
    return null;
}

// 👇 УМНАЯ ФУНКЦИЯ ПОИСКА МЕСТА ДЛЯ НОВОЙ ИГРЫ
function findBestInstallDir() {
    try {
        const psCommand = `Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID, FreeSpace | ConvertTo-Json`;
        const stdout = execSync(`powershell -command "${psCommand}"`).toString().trim();
        let disks = JSON.parse(stdout);
        if (!Array.isArray(disks)) disks = [disks];
        let bestDisk = 'D:';
        let maxFree = 0;
        
        for (const disk of disks) {
            if (disk.DeviceID !== 'C:' && disk.FreeSpace > maxFree) {
                maxFree = disk.FreeSpace;
                bestDisk = disk.DeviceID;
            }
        }
        if (maxFree === 0) {
            const cDrive = disks.find(d => d.DeviceID === 'C:');
            if (cDrive) bestDisk = 'C:';
        }
        return `${bestDisk}\\SteamCMD_Library`;
    } catch (e) {
        return 'D:\\SteamCMD_Library'; 
    }
}

// 👇 ФУНКЦИЯ ОБНОВЛЕНИЯ/УСТАНОВКИ ОДНОЙ ИГРЫ
async function processSingleGame(appId, gameName, ips) {
    if (isUpdating) return;
    isUpdating = true;

    let username = 'anonymous';
    let password = '';
    if (fs.existsSync(authPath)) {
        const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
        username = auth.username || 'anonymous';
        password = auth.password || '';
    }

    const local = getLocalBuildId(appId);
    let installDir;
    let actionText;

    if (local) {
        installDir = local.dir;
        actionText = 'Обновление';
    } else {
        installDir = findBestInstallDir();
        actionText = 'Установка';
    }

    if (isSteamRunning()) {
        currentSteamStatus = '⚠️ Steam запущен';
        isUpdating = false;
        return;
    }

    currentSteamStatus = `⏳ ${actionText}: ${gameName}...`;
    await fetch(`${SERVER_URL}/api/agent/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ips, disksInfo: getDisksInfo(), steamStatus: currentSteamStatus, installedApps: getInstalledAppIds() })
    }).catch(() => {});

    const args = ['+force_install_dir', installDir];
    if (password) args.push('+login', username, password);
    else args.push('+login', username); 
    args.push('+app_update', appId, '+quit'); 
    
    const child = spawn(steamCmdPath, args);

    let lastSentTime = 0; 
    child.stdout.on('data', (data) => {
        const text = data.toString();
        const progressMatch = text.match(/progress:\s+([\d\.]+)/);
        if (progressMatch && progressMatch[1]) {
            const percent = Math.floor(parseFloat(progressMatch[1]));
            currentSteamStatus = `⏳ ${gameName}: ${percent}%`;

            const now = Date.now();
            if (now - lastSentTime > 5000) { 
                lastSentTime = now;
                fetch(`${SERVER_URL}/api/agent/report`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ips, disksInfo: getDisksInfo(), steamStatus: currentSteamStatus, installedApps: getInstalledAppIds() })
                }).catch(() => {});
            }
        }
    });

    await new Promise((resolve) => {
        child.on('close', async (code) => {
            if (code === 0) currentSteamStatus = `✅ ${gameName}: Готово`;
            else currentSteamStatus = `❌ Ошибка: ${gameName}`;
            
            await fetch(`${SERVER_URL}/api/agent/report`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ips, disksInfo: getDisksInfo(), steamStatus: currentSteamStatus, installedApps: getInstalledAppIds() })
            }).catch(() => {});
            setTimeout(resolve, 2000); 
        });
    });

    isUpdating = false;
}

async function updateGamesList(games, ips) {
    for (const game of games) {
        await processSingleGame(game.appId, game.name, ips);
    }
}

async function checkCommands(ips) {
    try {
        for (const ip of ips) {
            const response = await fetch(`${SERVER_URL}/api/command/${ip}`).catch(() => null);
            if (!response) continue;
            const data = await response.json();
            
            if (data.commands && data.commands.length > 0) {
                for (const cmd of data.commands) {
                    if (cmd.action === 'update_all' && cmd.games) {
                        updateGamesList(cmd.games, ips); 
                    }
                    if (cmd.action === 'install_or_update' && cmd.appId) {
                        const gameInfo = GAMES.find(g => g.appId === cmd.appId) || { name: `App ${cmd.appId}` };
                        processSingleGame(cmd.appId, gameInfo.name, ips);
                    }
                }
            }
        }
    } catch (error) {}
}

async function reportStatus() {
  try {
    const disksInfo = getDisksInfo();
    const ips = getAllIps();
    const installedApps = getInstalledAppIds();
    
    await fetch(`${SERVER_URL}/api/agent/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ips, disksInfo, steamStatus: currentSteamStatus, installedApps })
    }).catch(() => {});
    await checkCommands(ips);
  } catch (error) {}
}

console.log(`🤖 Агент запущен. Слушаю сервер...`);
reportStatus();
setInterval(reportStatus, 10000);