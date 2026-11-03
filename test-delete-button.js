// Скрипт для тестирования кнопки удаления
const fetch = require('node-fetch');

const SERVER_URL = 'http://localhost:3000';
const TEST_IP = '192.168.1.99'; // Тестовый IP

// Симулируем агент с установленными играми
async function sendMockAgentData() {
    const mockData = {
        ips: [TEST_IP],
        disksInfo: 'C: 450.2 ГБ свободно из 931.5 ГБ',
        steamStatus: '✅ Готов',
        installedApps: [
            { appId: '730', name: 'CS 2', buildId: '15819419' },
            { appId: '570', name: 'DOTA 2', buildId: '15768293' },
            { appId: '252490', name: 'RUST', buildId: '14521983' }
        ],
        queue: [],
        activeGame: null,
        logs: ['[20:52:12] 🤖 Тестовый агент запущен', '[20:52:15] ✅ Связь с сервером установлена'],
        workshopSize: '12.5 ГБ',
        agentVersion: '1.0.8',
        gameUpdateStatus: {
            '730': '✅ Актуален',
            '570': '✅ Актуален',
            '252490': '🔄 Есть обновление'
        }
    };

    try {
        const response = await fetch(`${SERVER_URL}/api/agent/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mockData)
        });
        const result = await response.json();
        console.log('✅ Тестовые данные агента отправлены:', result);
    } catch (e) {
        console.error('❌ Ошибка отправки:', e.message);
    }
}

// Проверяем команды от сервера
async function checkCommands() {
    try {
        const response = await fetch(`${SERVER_URL}/api/command/${TEST_IP}`);
        const data = await response.json();

        if (data.commands && data.commands.length > 0) {
            console.log('\n📥 Получены команды от сервера:');
            data.commands.forEach(cmd => {
                console.log(`  - ${cmd.action} ${cmd.gameName || ''} (appId: ${cmd.appId || 'N/A'})`);

                // Симулируем выполнение удаления
                if (cmd.action === 'uninstall') {
                    console.log(`  🗑️  СИМУЛЯЦИЯ УДАЛЕНИЯ: ${cmd.gameName}`);
                    console.log(`  ✅ Игра ${cmd.gameName} успешно "удалена" (тест)`);
                }
            });
        }
    } catch (e) {
        console.error('❌ Ошибка проверки команд:', e.message);
    }
}

// Основной тестовый цикл
async function runTest() {
    console.log('🧪 Запуск теста кнопки удаления...\n');

    // Отправляем данные агента
    await sendMockAgentData();

    console.log('\n⏳ Ожидаем команды удаления...');
    console.log('👉 Откройте интерфейс: http://localhost:3000');
    console.log('👉 Выберите клуб Староминская');
    console.log('👉 Найдите ПК с IP 192.168.1.99 (Тестовый ПК)');
    console.log('👉 Нажмите на него и попробуйте удалить игру CS 2, DOTA 2 или RUST\n');

    // Проверяем команды каждые 3 секунды
    setInterval(async () => {
        await checkCommands();
        // Обновляем данные агента
        await sendMockAgentData();
    }, 3000);
}

runTest();
