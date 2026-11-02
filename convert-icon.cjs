const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;
const fs = require('fs');

async function convert() {
    try {
        console.log('⏳ Конвертирую logo.png в icon.ico...');
        
        // 1. Сжимаем картинку до 256x256
        const buffer = await sharp('logo.png')
            .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .toBuffer();
        
        fs.writeFileSync('temp_256.png', buffer);
        
        // 2. Конвертируем в ICO
        const icoBuffer = await pngToIco('temp_256.png');
        fs.writeFileSync('build/icon.ico', icoBuffer);
        
        // 3. Удаляем временный файл
        fs.unlinkSync('temp_256.png');
        
        console.log('✅ Успех! Файл build/icon.ico готов.');
    } catch (e) {
        console.error('❌ Ошибка:', e.message);
    }
}

convert();