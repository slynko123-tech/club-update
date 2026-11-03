const http = require('http');

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║          Тестирование агента SmartShell API              ║');
console.log('╚═══════════════════════════════════════════════════════════╝');
console.log();
console.log(`⏰ Время начала: ${new Date().toLocaleString('ru-RU')}`);
console.log();

// Конфигурация
const API_BASE = 'http://localhost:3000';
let testsPassed = 0;
let testsFailed = 0;

// Утилиты
function makeRequest(path, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, API_BASE);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: method,
            headers: data ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(JSON.stringify(data))
            } : {}
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    resolve({ status: res.statusCode, data: json });
                } catch (e) {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });

        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

async function runTest(name, testFn) {
    process.stdout.write(`🧪 ${name.padEnd(60)}`);
    try {
        const startTime = Date.now();
        await testFn();
        const duration = Date.now() - startTime;
        console.log(`✅ (${duration}ms)`);
        testsPassed++;
        return true;
    } catch (error) {
        console.log(`❌`);
        console.log(`   Ошибка: ${error.message}`);
        testsFailed++;
        return false;
    }
}

// Тесты
async function runTests() {
    console.log('📋 Тест 1: Проверка базовых эндпоинтов');
    console.log('-'.repeat(70));

    await runTest('Получение списка клубов', async () => {
        const res = await makeRequest('/api/clubs');
        if (res.status !== 200) throw new Error(`Status ${res.status}`);
        if (!Array.isArray(res.data)) throw new Error('Ответ не массив');
        if (res.data.length === 0) throw new Error('Список клубов пуст');
    });

    await runTest('Получение списка игр', async () => {
        const res = await makeRequest('/api/games');
        if (res.status !== 200) throw new Error(`Status ${res.status}`);
        if (!Array.isArray(res.data)) throw new Error('Ответ не массив');
        if (res.data.length === 0) throw new Error('Список игр пуст');
    });

    console.log();
    console.log('📋 Тест 2: Проверка получения данных ПК');
    console.log('-'.repeat(70));

    // Получаем первый клуб для тестов
    const clubsRes = await makeRequest('/api/clubs');
    const firstClub = clubsRes.data[0];

    await runTest('Получение списка ПК для клуба', async () => {
        const res = await makeRequest(`/api/pcs?clubId=${firstClub.id}`);
        if (res.status !== 200) throw new Error(`Status ${res.status}`);
        if (!Array.isArray(res.data)) throw new Error('Ответ не массив');
        console.log(`\n   📊 Найдено ПК: ${res.data.length}`);
    });

    await runTest('Проверка формата данных ПК', async () => {
        const res = await makeRequest(`/api/pcs?clubId=${firstClub.id}`);
        if (res.data.length === 0) {
            console.log('\n   ⚠️  Нет ПК онлайн, пропускаем проверку формата');
            return;
        }
        const pc = res.data[0];
        if (!pc.id) throw new Error('Отсутствует поле id');
        if (!pc.status) throw new Error('Отсутствует поле status');
        console.log(`\n   📊 Пример ПК: ${pc.id} - ${pc.status}`);
    });

    console.log();
    console.log('📋 Тест 3: Проверка времени отклика');
    console.log('-'.repeat(70));

    await runTest('Скорость получения списка клубов', async () => {
        const start = Date.now();
        await makeRequest('/api/clubs');
        const duration = Date.now() - start;
        if (duration > 1000) throw new Error(`Слишком медленно: ${duration}ms`);
    });

    await runTest('Скорость получения списка ПК', async () => {
        const start = Date.now();
        await makeRequest(`/api/pcs?clubId=${firstClub.id}`);
        const duration = Date.now() - start;
        if (duration > 3000) throw new Error(`Слишком медленно: ${duration}ms`);
    });

    console.log();
    console.log('📋 Тест 4: Проверка истории');
    console.log('-'.repeat(70));

    await runTest('Получение истории операций', async () => {
        const res = await makeRequest('/api/history');
        if (res.status !== 200) throw new Error(`Status ${res.status}`);
        if (!Array.isArray(res.data)) throw new Error('Ответ не массив');
        console.log(`\n   📊 Записей в истории: ${res.data.length}`);
    });

    console.log();
    console.log('📋 Тест 5: Проверка обработки ошибок');
    console.log('-'.repeat(70));

    await runTest('Запрос несуществующего клуба', async () => {
        const res = await makeRequest('/api/pcs?clubId=nonexistent');
        if (res.status !== 200) throw new Error(`Status ${res.status}`);
        if (!Array.isArray(res.data)) throw new Error('Ответ не массив');
        if (res.data.length > 0) throw new Error('Вернулись данные для несуществующего клуба');
    });

    await runTest('Запрос без параметра clubId', async () => {
        const res = await makeRequest('/api/pcs');
        // Должен вернуть пустой массив или ошибку
        if (res.status === 200 && Array.isArray(res.data)) {
            // OK
        } else if (res.status >= 400) {
            // Тоже OK
        } else {
            throw new Error('Неожиданный ответ');
        }
    });

    console.log();
    console.log('📋 Тест 6: Проверка статической раздачи');
    console.log('-'.repeat(70));

    await runTest('Загрузка index.html', async () => {
        const res = await makeRequest('/');
        if (res.status !== 200) throw new Error(`Status ${res.status}`);
        if (typeof res.data !== 'string') throw new Error('Не HTML');
    });

    console.log();
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║                      РЕЗУЛЬТАТЫ ТЕСТОВ                    ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log();

    const total = testsPassed + testsFailed;
    const percentage = ((testsPassed / total) * 100).toFixed(0);

    console.log(`✅ Пройдено: ${testsPassed}`);
    console.log(`❌ Провалено: ${testsFailed}`);
    console.log(`📊 Успешность: ${percentage}%`);
    console.log();

    if (testsFailed === 0) {
        console.log('🎉 ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО!');
        console.log();
        console.log('✅ Агент работает корректно');
        console.log('✅ API отвечает быстро');
        console.log('✅ Данные приходят в правильном формате');
        console.log('✅ Обработка ошибок работает');
    } else {
        console.log('⚠️  НЕКОТОРЫЕ ТЕСТЫ НЕ ПРОШЛИ');
        console.log();
        console.log('Проверьте:');
        console.log('  • Запущен ли сервер (npm start)');
        console.log('  • Доступен ли SmartShell API');
        console.log('  • Корректны ли учетные данные клубов');
    }

    console.log();
    console.log(`⏰ Время окончания: ${new Date().toLocaleString('ru-RU')}`);
    console.log('='.repeat(70));
}

// Проверка доступности сервера
console.log('🔍 Проверка доступности сервера...');
makeRequest('/api/clubs')
    .then(() => {
        console.log('✅ Сервер доступен');
        console.log();
        return runTests();
    })
    .catch((error) => {
        console.log('❌ Сервер недоступен');
        console.log();
        console.log('Ошибка:', error.message);
        console.log();
        console.log('Убедитесь что сервер запущен:');
        console.log('  npm start');
        console.log();
        process.exit(1);
    });
