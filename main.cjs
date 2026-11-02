const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { fork, spawn } = require('child_process');
const https = require('https');
const AdmZip = require('adm-zip');
const { getYandexDirectLink } = require('./yandex-downloader.cjs');

let mainWindow;
let serverProcess;

const preloadPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'preload.cjs') 
    : path.join(__dirname, 'preload.cjs');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Club Update Admin",
    icon: path.join(__dirname, 'build', 'icon.ico'),
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  });

  const serverPath = path.join(__dirname, 'server', 'index.js');
  serverProcess = fork(serverPath);

  setTimeout(() => {
    mainWindow.loadURL('http://localhost:3000');
  }, 2000);

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (serverProcess) serverProcess.kill();
  });
}

// Обработчики кнопок окна
ipcMain.on('window-close', () => { if (mainWindow) mainWindow.close(); });
ipcMain.on('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
    }
});

// 👇 ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ СКАЧИВАНИЯ ФАЙЛОВ
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            // Обработка редиректов
            if (response.statusCode === 301 || response.statusCode === 302) {
                return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
            }
            if (response.statusCode !== 200) {
                reject(new Error(`Ошибка скачивания: ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => reject(err));
        });
    });
}

// 👇 НОВАЯ ФУНКЦИЯ ПРОВЕРКИ ОБНОВЛЕНИЙ (ЧЕРЕЗ ZIP)
async function checkForUpdates() {
    console.log('--- [UPDATE] Проверка обновлений... ---');
    try {
        // 1. Получаем ссылку на latest.json (вместо yml)
        const latestJsonUrl = await getYandexDirectLink('/ClubUpdate/admin/latest.json');
        
        if (latestJsonUrl) {
            console.log('[UPDATE] Ссылка на latest.json получена.');
            
            // 2. Скачиваем и читаем latest.json
            const res = await fetch(latestJsonUrl);
            const data = await res.json();
            const currentVersion = app.getVersion();
            
            console.log(`[UPDATE] Текущая версия: ${currentVersion}, на сервере: ${data.version}`);

            if (data.version && data.version !== currentVersion) {
                console.log(`[UPDATE] ДОСТУПНО ОБНОВЛЕНИЕ! Версия: ${data.version}`);
                
                // Показываем окно с предложением обновиться
                const result = await dialog.showMessageBox(mainWindow, {
                    type: 'info',
                    title: 'Доступно обновление',
                    message: `Доступна новая версия ${data.version}. Обновить сейчас?`,
                    buttons: ['Обновить', 'Позже']
                });

                if (result.response === 0) {
                    // 3. Получаем ссылку на ZIP-архив
                    const zipUrl = await getYandexDirectLink('/ClubUpdate/admin/update.zip');
                    const zipPath = path.join(app.getPath('temp'), 'update.zip');
                    
                    console.log('[UPDATE] Скачивание архива...');
                    await downloadFile(zipUrl, zipPath);
                    
                    console.log('[UPDATE] Распаковка архива...');
                    const extractPath = path.join(app.getPath('temp'), 'club-update-update');
                    if (fs.existsSync(extractPath)) {
                        fs.rmSync(extractPath, { recursive: true, force: true });
                    }
                    const zip = new AdmZip(zipPath);
                    zip.extractAllTo(extractPath, true);
                    
                    // 4. Находим и запускаем установщик
                    // Имя файла установщика должно быть точным!
                    const setupPath = path.join(extractPath, `ClubUpdateAdmin Setup ${data.version}.exe`); 
                    console.log('[UPDATE] Запуск установщика:', setupPath);
                    
                    const installer = spawn(setupPath, [], {
                        detached: true,
                        stdio: 'ignore'
                    });
                    installer.unref();
                    
                    // 5. Закрываем текущее приложение
                    app.quit();
                }
            } else {
                console.log('[UPDATE] Обновлений нет.');
            }
        } else {
            console.log('[UPDATE] Не удалось получить ссылку на latest.json.');
        }
    } catch (e) {
        console.error('[UPDATE] КРИТИЧЕСКАЯ ОШИБКА:', e.message);
    }
}

app.whenReady().then(() => {
    createWindow();
    setTimeout(checkForUpdates, 5000); 
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});