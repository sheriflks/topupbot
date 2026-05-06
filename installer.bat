@echo off
TITLE TOPUPBOT AUTO-INSTALLER v2.0
CLS

echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo        🚀 TOPUPBOT AUTO-INSTALLER v2.0 🚀       
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.

:: 1. Cek Node.js
echo 📦 [1/5] Mengecek Node.js...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo    ❌ Node.js belum terinstall!
    echo    Silakan install Node.js (v18+) terlebih dahulu.
    pause
    exit /b
)
for /f "delims=" %%v in ('node -v') do set NODE_VER=%%v
echo    ✅ Node.js terdeteksi: %NODE_VER%

:: 2. Install Dependensi
echo.
echo 📦 [2/5] Menginstall dependensi (npm install)...
echo    (Ini mungkin memakan waktu beberapa menit...)
call npm install
if %errorlevel% neq 0 (
    echo    ❌ Gagal menginstall dependensi!
    pause
    exit /b
)
echo    ✅ Dependensi berhasil diinstall.

:: 3. Setup Config
echo.
echo ⚙️ [3/5] Mengecek file konfigurasi...
if not exist "bot\config\config.json" (
    echo    ⚠️ config.json tidak ditemukan!
) else (
    echo    ✅ config.json ditemukan.
)

:: 4. Install & Setup PM2
echo.
echo 🚀 [4/5] Menyiapkan PM2 untuk auto-start...
call pm2 -v >nul 2>&1
if %errorlevel% neq 0 (
    echo    ⚠️ PM2 belum terinstall. Menginstall global...
    call npm install -g pm2
    echo    ✅ PM2 berhasil diinstall.
) else (
    echo    ✅ PM2 sudah terinstall.
)

:: 5. Jalankan Bot dengan PM2
echo.
echo 🤖 [5/5] Menjalankan bot dengan PM2...
call pm2 delete topupbot >nul 2>&1
call pm2 start start.js --name topupbot

echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo        🎉 INSTALASI BERHASIL SELESAI! 🎉        
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.
echo 📍 Status Bot:
echo    • Nama PM2 : topupbot
echo    • Cek Log  : pm2 logs topupbot
echo    • Restart  : pm2 restart topupbot
echo    • Stop     : pm2 stop topupbot
echo.
echo 📢 Silakan buka Telegram dan gunakan perintah /admin untuk setup API Key.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
pause
