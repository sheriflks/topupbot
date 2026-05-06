/**
 * app.js - Entry point utama bot
 * Flow: Telegram aktif dulu → Admin connect WA via bot → Sync Produk
 * WA TIDAK wajib connect sebelum Telegram jalan.
 * Admin bisa connect WA kapan saja lewat panel admin di Telegram.
 */

'use strict';

const logger = require('./utils/logger');

process.on('uncaughtException',  (err) => logger.error('App', 'Uncaught Exception', { msg: err.message, stack: err.stack }));
process.on('unhandledRejection', (err) => logger.error('App', 'Unhandled Rejection', { msg: err?.message }));

const { initBot }            = require('./services/telegram');
const { startWebhookServer } = require('./services/webhookServer');
const { syncProducts, startAutoSync } = require('./services/productSync');
const { startAutoCheck } = require('./services/paymentChecker');
const config = require('./config/config.json');

async function main() {
  const cfg = require('./config/config.json');
  const botName = cfg.app.bot_name || 'TOPUPBOT';
  const version = cfg.app.version || '2.0.0';

  console.log('\x1b[36m%s\x1b[0m', '\n╔══════════════════════════════════════╗');
  console.log('\x1b[36m%s\x1b[0m', `║  🚀 ${botName.padEnd(25)} v${version.padEnd(6)} ║`);
  console.log('\x1b[36m%s\x1b[0m', '║     Topup Game & PPOB All-in-One     ║');
  console.log('\x1b[36m%s\x1b[0m', '╚══════════════════════════════════════╝\n');

  // ─── Step 1: Init Telegram Bot (wajib ada token) ──────────────────────────
  logger.info('App', '🤖 Menginisialisasi Telegram Bot...');

  let bot;
  try {
    bot = initBot();
    logger.info('App', '✅ Telegram Bot aktif!');
    console.log('✅ Telegram Bot aktif!\n');
  } catch (err) {
    logger.error('App', '❌ Telegram Bot gagal', { msg: err.message });
    console.error('❌ Telegram Bot gagal:', err.message);
    console.error('   Pastikan telegram.token di config.json sudah diisi.\n');
    process.exit(1);
  }

  // ─── Step 2: Webhook Server ───────────────────────────────────────────────
  try {
    startWebhookServer(bot);
    console.log(`✅ Webhook Server aktif di port ${config.webhook.port}\n`);
  } catch (err) {
    logger.warn('App', 'Webhook server gagal (opsional)', { msg: err.message });
  }

  // ─── Step 3: Payment Auto-check (OrderKuota Mutasi) ──────────────────────
  startAutoCheck(bot);
  logger.info('App', '✅ Payment Auto-check aktif!');

  // ─── Step 4: Sync Produk (background, tidak block) ───────────────────────
  if (config.product_sync.on_startup) {
    syncProducts()
      .then(total => logger.info('App', `Produk tersinkronisasi: ${total} item`))
      .catch(err  => logger.warn('App', 'Sync produk gagal, pakai default', { msg: err.message }));
  }
  startAutoSync();

  // ─── Step 4: Auto-connect WA jika session sudah ada ──────────────────────
  const fs   = require('fs');
  const path = require('path');
  const sessionPath = path.resolve(config.whatsapp.session_path || './wa_session');
  const hasCreds = fs.existsSync(path.join(sessionPath, 'creds.json'));

  if (hasCreds) {
    logger.info('App', '� Session WA ditemukan, auto-connect...');
    const { connectWhatsApp } = require('./services/whatsapp');
    connectWhatsApp(bot).catch(err =>
      logger.warn('App', 'Auto-connect WA gagal', { msg: err.message })
    );
  } else {
    logger.info('App', '📱 WA belum connect. Gunakan /admin → Koneksi WA di Telegram.');
    console.log('� WA belum connect. Buka Telegram → /admin → Koneksi WA\n');
  }

  console.log('╔══════════════════════════════════════╗');
  console.log('║      ✅ BOT TELEGRAM SIAP!           ║');
  console.log('╚══════════════════════════════════════╝\n');
  logger.info('App', '🚀 TopupBot siap!');
}

main();
