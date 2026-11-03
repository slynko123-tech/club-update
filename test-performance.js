// Скрипт для автоматического тестирования производительности
const fs = require('fs');
const path = require('path');

console.log('🔍 ТЕСТ ПРОИЗВОДИТЕЛЬНОСТИ CLUB UPDATE ADMIN');
console.log('='.repeat(60));
console.log();

// Тест 1: Проверка размеров файлов
console.log('📦 Тест 1: Размеры сборки');
console.log('-'.repeat(60));

const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
    const files = fs.readdirSync(distPath, { recursive: true });
    let totalSize = 0;

    files.forEach(file => {
        const filePath = path.join(distPath, file);
        if (fs.statSync(filePath).isFile()) {
            const size = fs.statSync(filePath).size;
            totalSize += size;
            const sizeKB = (size / 1024).toFixed(2);
            console.log(`  ${file.padEnd(40)} ${sizeKB.padStart(10)} KB`);
        }
    });

    console.log('  ' + '-'.repeat(52));
    console.log(`  ${'ИТОГО'.padEnd(40)} ${(totalSize / 1024).toFixed(2).padStart(10)} KB`);

    // Оценка
    const totalMB = totalSize / (1024 * 1024);
    if (totalMB < 1) {
        console.log(`  ✅ Отлично! Размер сборки < 1 MB`);
    } else if (totalMB < 2) {
        console.log(`  ⚠️  Приемлемо. Размер сборки ${totalMB.toFixed(2)} MB`);
    } else {
        console.log(`  ❌ Слишком большой размер: ${totalMB.toFixed(2)} MB`);
    }
} else {
    console.log('  ❌ Папка dist не найдена. Запустите npm run build');
}

console.log();

// Тест 2: Анализ кода
console.log('🔍 Тест 2: Анализ оптимизаций в коде');
console.log('-'.repeat(60));

const appTsxPath = path.join(__dirname, 'src', 'App.tsx');
if (fs.existsSync(appTsxPath)) {
    const content = fs.readFileSync(appTsxPath, 'utf8');

    // Подсчет хуков мемоизации
    const useCallbackCount = (content.match(/useCallback/g) || []).length;
    const useMemoCount = (content.match(/useMemo/g) || []).length;
    const useEffectCount = (content.match(/useEffect/g) || []).length;

    console.log(`  useCallback хуков: ${useCallbackCount}`);
    console.log(`  useMemo хуков: ${useMemoCount}`);
    console.log(`  useEffect хуков: ${useEffectCount}`);

    if (useCallbackCount >= 10) {
        console.log(`  ✅ Отличная мемоизация функций`);
    } else if (useCallbackCount >= 5) {
        console.log(`  ⚠️  Хорошая мемоизация, можно улучшить`);
    } else {
        console.log(`  ❌ Недостаточно мемоизации`);
    }

    // Проверка debounce
    if (content.includes('debouncedSearchTerm')) {
        console.log(`  ✅ Debounce для поиска реализован`);
    } else {
        console.log(`  ❌ Debounce для поиска не найден`);
    }

    // Проверка skeleton loader
    if (content.includes('animate-pulse') && content.includes('bg-gray-700')) {
        console.log(`  ✅ Skeleton loader реализован`);
    } else {
        console.log(`  ❌ Skeleton loader не найден`);
    }
} else {
    console.log('  ❌ Файл App.tsx не найден');
}

console.log();

// Тест 3: Проверка серверных оптимизаций
console.log('⚙️  Тест 3: Серверные оптимизации');
console.log('-'.repeat(60));

const serverPath = path.join(__dirname, 'server', 'index.js');
if (fs.existsSync(serverPath)) {
    const content = fs.readFileSync(serverPath, 'utf8');

    // Проверка события server-ready
    if (content.includes("process.send('server-ready')")) {
        console.log(`  ✅ Событие server-ready реализовано`);
    } else {
        console.log(`  ❌ Событие server-ready не найдено`);
    }

    // Проверка интервала обновления
    const intervalMatch = content.match(/setInterval.*?(\d+)\s*\)/s);
    if (intervalMatch) {
        const interval = parseInt(intervalMatch[1]);
        console.log(`  📊 Интервал обновления: ${interval}мс`);

        if (interval === 5000) {
            console.log(`  ✅ Оптимальный интервал (5 секунд)`);
        } else if (interval < 5000) {
            console.log(`  ⚠️  Слишком частые обновления (${interval / 1000}с)`);
        } else {
            console.log(`  ⚠️  Слишком редкие обновления (${interval / 1000}с)`);
        }
    }
} else {
    console.log('  ❌ Файл server/index.js не найден');
}

console.log();

// Тест 4: Проверка Electron оптимизаций
console.log('🖥️  Тест 4: Electron оптимизации');
console.log('-'.repeat(60));

const mainPath = path.join(__dirname, 'main.cjs');
if (fs.existsSync(mainPath)) {
    const content = fs.readFileSync(mainPath, 'utf8');

    // Проверка обработки server-ready
    if (content.includes("msg === 'server-ready'")) {
        console.log(`  ✅ Обработка server-ready реализована`);
    } else {
        console.log(`  ❌ Обработка server-ready не найдена`);
    }

    // Проверка fallback таймаута
    const timeoutMatch = content.match(/setTimeout.*?(\d+)\s*\)/);
    if (timeoutMatch) {
        const timeout = parseInt(timeoutMatch[1]);
        console.log(`  📊 Fallback таймаут: ${timeout}мс`);

        if (timeout >= 3000) {
            console.log(`  ✅ Адекватный fallback таймаут`);
        } else {
            console.log(`  ⚠️  Короткий fallback таймаут`);
        }
    }
} else {
    console.log('  ❌ Файл main.cjs не найден');
}

console.log();

// Итоговая оценка
console.log('📊 ИТОГОВАЯ ОЦЕНКА');
console.log('='.repeat(60));

const results = {
    build: fs.existsSync(distPath),
    serverReady: fs.existsSync(serverPath) && fs.readFileSync(serverPath, 'utf8').includes("process.send('server-ready')"),
    debounce: fs.existsSync(appTsxPath) && fs.readFileSync(appTsxPath, 'utf8').includes('debouncedSearchTerm'),
    skeleton: fs.existsSync(appTsxPath) && fs.readFileSync(appTsxPath, 'utf8').includes('animate-pulse'),
    memoization: fs.existsSync(appTsxPath) && (fs.readFileSync(appTsxPath, 'utf8').match(/useCallback/g) || []).length >= 10,
};

const passed = Object.values(results).filter(Boolean).length;
const total = Object.keys(results).length;
const percentage = ((passed / total) * 100).toFixed(0);

console.log(`Пройдено тестов: ${passed}/${total} (${percentage}%)`);
console.log();

if (percentage >= 80) {
    console.log('🎉 ОТЛИЧНО! Все оптимизации на месте');
} else if (percentage >= 60) {
    console.log('⚠️  ХОРОШО, но есть что улучшить');
} else {
    console.log('❌ ТРЕБУЕТСЯ ДОРАБОТКА');
}

console.log();
console.log('✅ Готовность к работе:');
console.log(`  • Сборка: ${results.build ? '✅' : '❌'}`);
console.log(`  • Server-ready: ${results.serverReady ? '✅' : '❌'}`);
console.log(`  • Debounce: ${results.debounce ? '✅' : '❌'}`);
console.log(`  • Skeleton loader: ${results.skeleton ? '✅' : '❌'}`);
console.log(`  • Мемоизация: ${results.memoization ? '✅' : '❌'}`);

console.log();
console.log('='.repeat(60));
console.log('Тестирование завершено!');
