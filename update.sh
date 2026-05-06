#!/bin/bash

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#      🚀 TOPUPBOT AUTO-UPDATE (GIT PULL) 🚀
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Warna untuk output
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RESET='\033[0m'

echo -e "${CYAN}🔄 Memulai proses update bot...${RESET}"

# 1. Tarik kode terbaru dari GitHub
echo -e "📥 Menarik kode terbaru dari GitHub..."
git pull origin main

# 2. Install dependensi baru jika ada
echo -e "📦 Mengupdate dependensi..."
npm install --production

# 3. Restart bot di PM2
echo -e "🚀 Merestart bot di PM2..."
pm2 restart topupbot

echo -e "${GREEN}✅ Update selesai! Bot sekarang menjalankan versi terbaru.${RESET}"
echo -e "${YELLOW}💡 Gunakan 'pm2 logs topupbot' untuk melihat log.${RESET}"
