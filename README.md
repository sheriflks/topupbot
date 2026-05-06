# TopupBot v2.0.0

Bot Telegram & WhatsApp All-in-One untuk Topup Game dan PPOB (Pulsa, Data, PLN, dll).

## ✨ Fitur Utama
- **Multi-Payment Gateway**: Integrasi OrderKuota (Orkut), Pakasir, dan Midtrans.
- **Auto Check Mutasi**: Pengecekan pembayaran QRIS otomatis via API Orkut.
- **Multi-Provider API**: Integrasi APIGames (Engine Kiosgamer) dan VIP Reseller.
- **PPOB & Tagihan**: Mendukung Pulsa, Paket Data, Token PLN, PDAM, dll.
- **Panel Admin Powerfull**: Kelola API Key, Markup, Nama Bot, dan Thumbnail langsung dari Telegram.
- **Sistem Withdraw**: Penarikan saldo admin dan user (DANA, OVO, Bank).
- **Auto Sync Produk**: Update harga modal dan stok otomatis dari provider.
- **Professional Logging**: Tampilan log terminal yang rapi dan berwarna.

## 🚀 Cara Instalasi

### Windows
1. Pastikan sudah install [Node.js](https://nodejs.org/).
2. Download/Clone repository ini.
3. Klik 2x file `installer.bat`.
4. Selesai! Bot akan aktif di PM2.

### Linux / VPS
1. Jalankan perintah berikut:
```bash
chmod +x installer.sh
./installer.sh
```

## 🛠️ Konfigurasi Awal
1. Buka file `bot/config/config.json` dan isi `telegram.token`.
2. Buka file `payment.json` dan isi kredensial OrderKuota Anda.
3. Jalankan bot, lalu masuk ke menu `/admin` di Telegram untuk mengatur API Key provider lainnya.

## 📱 Koneksi WhatsApp
1. Masuk ke Panel Admin di Telegram (`/admin`).
2. Pilih menu **📱 WhatsApp**.
3. Scan QR Code yang muncul menggunakan WhatsApp Anda.

## 📄 Lisensi
MIT License - Dibuat untuk keperluan edukasi dan bisnis topup.
