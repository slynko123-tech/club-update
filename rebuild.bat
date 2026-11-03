@echo off
echo Очистка и пересборка приложения...
timeout /t 2 /nobreak > nul
rmdir /s /q dist 2>nul
call npm run build
call npm run build-exe
echo.
echo Готово! Установщик в папке release
pause
