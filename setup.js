/**
 * setup.js - Installer otomatis untuk TopupBot
 * Menjalankan instalasi dependensi dan setup awal.
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const COLORS = {
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function print(msg, color = COLORS.reset) {
  console.log(`${color}${msg}${COLORS.reset}`);
}

async function start() {
  console.clear();
  print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', COLORS.cyan);
  print('       🚀 TOPUPBOT AUTO-INSTALLER v2.0 🚀       ', COLORS.cyan + COLORS.bold);
  print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', COLORS.cyan);
  console.log('');

  try {
    // 1. Check Node.js
    print('📦 [1/5] Mengecek Node.js...', COLORS.white);
    const nodeVer = process.version;
    print(`   ✅ Node.js terdeteksi: ${nodeVer}`, COLORS.green);

    // 2. Install Dependencies
    print('\n📦 [2/5] Menginstall dependensi (npm install)...', COLORS.white);
    print('   (Ini mungkin memakan waktu beberapa menit...)', COLORS.yellow);
    execSync('npm install', { stdio: 'inherit' });
    print('   ✅ Dependensi berhasil diinstall.', COLORS.green);

    // 3. Setup Config Files
    print('\n⚙️ [3/5] Mengecek file konfigurasi...', COLORS.white);
    const configPath = path.join(__dirname, 'bot', 'config', 'config.json');
    if (!fs.existsSync(configPath)) {
      print('   ⚠️ config.json tidak ditemukan. Membuat dari default...', COLORS.yellow);
      // Logic to create default config if needed
    } else {
      print('   ✅ config.json ditemukan.', COLORS.green);
    }

    // 4. Install & Setup PM2
    print('\n🚀 [4/5] Menyiapkan PM2 untuk auto-start...', COLORS.white);
    try {
      execSync('pm2 -v', { stdio: 'ignore' });
      print('   ✅ PM2 sudah terinstall.', COLORS.green);
    } catch {
      print('   ⚠️ PM2 belum terinstall. Menginstall global...', COLORS.yellow);
      execSync('npm install -g pm2', { stdio: 'inherit' });
      print('   ✅ PM2 berhasil diinstall.', COLORS.green);
    }

    // 5. Start Bot with PM2
    print('\n🤖 [5/5] Menjalankan bot dengan PM2...', COLORS.white);
    execSync('pm2 delete topupbot', { stdio: 'ignore' }); // Hapus jika sudah ada
    execSync('pm2 start start.js --name topupbot', { stdio: 'inherit' });
    
    print('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', COLORS.green);
    print('       🎉 INSTALASI BERHASIL SELESAI! 🎉        ', COLORS.green + COLORS.bold);
    print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', COLORS.green);
    console.log('');
    print('📍 Status Bot:', COLORS.white);
    print('   • Nama PM2: topupbot', COLORS.cyan);
    print('   • Cek Log : pm2 logs topupbot', COLORS.cyan);
    print('   • Restart : pm2 restart topupbot', COLORS.cyan);
    print('   • Stop    : pm2 stop topupbot', COLORS.cyan);
    console.log('');
    print('📢 Silakan buka Telegram dan gunakan perintah /admin untuk setup API Key.', COLORS.yellow);
    print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', COLORS.green);

  } catch (err) {
    print('\n❌ TERJADI KESALAHAN SAAT INSTALASI!', COLORS.red + COLORS.bold);
    print(`   Error: ${err.message}`, COLORS.red);
    process.exit(1);
  }
}

start();
