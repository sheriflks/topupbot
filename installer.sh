#!/bin/bash

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#        🚀 TOPUPBOT AUTO-INSTALLER v2.0 🚀
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Warna untuk output
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

clear
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${CYAN}${BOLD}       🚀 TOPUPBOT AUTO-INSTALLER v2.0 🚀       ${RESET}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# 1. Cek Node.js
echo -e "📦 [1/5] Mengecek Node.js..."
if ! command -v node &> /dev/null; then
    echo -e "   ${RED}❌ Node.js belum terinstall!${RESET}"
    echo -e "   Silakan install Node.js (v18+) terlebih dahulu."
    exit 1
fi
NODE_VER=$(node -v)
echo -e "   ${GREEN}✅ Node.js terdeteksi: $NODE_VER${RESET}"

# 2. Install Dependensi
echo -e "\n📦 [2/5] Menginstall dependensi (npm install)..."
echo -e "   ${YELLOW}(Ini mungkin memakan waktu beberapa menit...)${RESET}"
npm install
if [ $? -eq 0 ]; then
    echo -e "   ${GREEN}✅ Dependensi berhasil diinstall.${RESET}"
else
    echo -e "   ${RED}❌ Gagal menginstall dependensi!${RESET}"
    exit 1
fi

# 3. Setup Config
echo -e "\n⚙️ [3/5] Mengecek file konfigurasi..."
if [ ! -f "./bot/config/config.json" ]; then
    echo -e "   ${YELLOW}⚠️ config.json tidak ditemukan!${RESET}"
    echo -e "   Pastikan Anda sudah menyiapkan file konfigurasi."
else
    echo -e "   ${GREEN}✅ config.json ditemukan.${RESET}"
fi

# 4. Install & Setup PM2
echo -e "\n🚀 [4/5] Menyiapkan PM2 untuk auto-start..."
if ! command -v pm2 &> /dev/null; then
    echo -e "   ${YELLOW}⚠️ PM2 belum terinstall. Menginstall global...${RESET}"
    npm install -g pm2
    echo -e "   ${GREEN}✅ PM2 berhasil diinstall.${RESET}"
else
    echo -e "   ${GREEN}✅ PM2 sudah terinstall.${RESET}"
fi

# 5. Jalankan Bot dengan PM2
echo -e "\n🤖 [5/5] Menjalankan bot dengan PM2..."
pm2 delete topupbot &> /dev/null
pm2 start start.js --name topupbot

echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${GREEN}${BOLD}       🎉 INSTALASI BERHASIL SELESAI! 🎉        ${RESET}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "📍 ${BOLD}Status Bot:${RESET}"
echo -e "   • Nama PM2 : ${CYAN}topupbot${RESET}"
echo -e "   • Cek Log  : ${CYAN}pm2 logs topupbot${RESET}"
echo -e "   • Restart  : ${CYAN}pm2 restart topupbot${RESET}"
echo -e "   • Stop     : ${CYAN}pm2 stop topupbot${RESET}"
echo ""
echo -e "${YELLOW}📢 Silakan buka Telegram dan gunakan perintah /admin untuk setup API Key.${RESET}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
