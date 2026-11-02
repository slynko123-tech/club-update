const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../app-config.json');

// Инициализация конфига при первом запуске
function initConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        const defaultConfig = {
            setupCompleted: false,
            club: null,
            clubName: null,
            credentials: {
                phone: '',
                password: '',
                companyId: ''
            },
            lastTokenRefresh: null
        };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
        return defaultConfig;
    }
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

// Сохранение конфига
function saveConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Получение конфига
function getConfig() {
    return initConfig();
}

// Обновление конфига
function updateConfig(updates) {
    const config = getConfig();
    const newConfig = { ...config, ...updates };
    saveConfig(newConfig);
    return newConfig;
}

module.exports = {
    initConfig,
    saveConfig,
    getConfig,
    updateConfig,
    CONFIG_PATH
};
