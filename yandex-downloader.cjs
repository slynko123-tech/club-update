const https = require('https');

// 👇 ВСТАВЬ СЮДА СВОЙ НОВЫЙ ТОКЕН!
const YANDEX_TOKEN = 'y0__wgBEISkm6wFGNuWAyDC7vTLGWU0F0dbBxnmvFEVZmDGsnI2nRqG';

function getYandexDirectLink(filePathOnDisk) {
    return new Promise((resolve) => {
        const encodedPath = encodeURIComponent(filePathOnDisk);
        
        const options = {
            hostname: 'cloud-api.yandex.net',
            path: `/v1/disk/resources/download?path=${encodedPath}`,
            method: 'GET',
            headers: {
                'Authorization': `OAuth ${YANDEX_TOKEN}`
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const json = JSON.parse(data);
                        resolve(json.href);
                    } catch (e) {
                        console.error('Ошибка парсинга ответа Яндекс.Диска');
                        resolve(null);
                    }
                } else {
                    console.error(`Ошибка API Яндекс.Диска: ${res.statusCode}`);
                    resolve(null);
                }
            });
        });

        req.on('error', (e) => {
            console.error('Ошибка сети:', e.message);
            resolve(null);
        });

        req.end();
    });
}

module.exports = { getYandexDirectLink };