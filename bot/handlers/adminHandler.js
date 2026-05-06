/**
 * adminHandler.js - Panel Admin Telegram
 * Semua setting bisa diubah langsung dari bot tanpa edit file manual
 * Fitur: WA Connect, Sync Produk, Statistik, Broadcast, Settings Markup/API/Reseller
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const config = require('../config/config.json');
const logger = require('../utils/logger');
const { usersDB, transactionsDB, productsDB } = require('../utils/jsonDB');
const { formatCurrency, formatDate } = require('../utils/validator');
const { syncProducts } = require('../services/productSync');
const whatsapp = require('../services/whatsapp');
const menuHandler = require('./menuHandler');

// Path ke config.json agar bisa ditulis ulang
const CONFIG_PATH = path.resolve(__dirname, '../config/config.json');
const PAYMENT_PATH = path.resolve(__dirname, '../../payment.json');

// ─── Helper: Simpan config ke file ────────────────────────────────────────────
function saveConfig(updatedConfig) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updatedConfig, null, 2), 'utf8');
}

function savePayment(updatedPayment) {
  fs.writeFileSync(PAYMENT_PATH, JSON.stringify(updatedPayment, null, 2), 'utf8');
}

// ─── Helper: Reload config (baca ulang dari file) ─────────────────────────────
function getConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return config;
  }
}

function getPayment() {
  try {
    return JSON.parse(fs.readFileSync(PAYMENT_PATH, 'utf8'));
  } catch {
    return {};
  }
}

// ─── Cek Admin ─────────────────────────────────────────────────────────────────
function isAdmin(userId) {
  const cfg = getConfig();
  return String(userId) === String(cfg.telegram.admin_id);
}

// ─── /admin command ────────────────────────────────────────────────────────────
async function handleAdmin(bot, msg) {
  const userId = String(msg.from.id);
  if (!isAdmin(userId)) {
    return bot.sendMessage(msg.chat.id, '❌ Anda tidak memiliki akses admin.');
  }
  await sendAdminPanel(bot, msg.chat.id);
}

// ─── Panel Admin Utama ─────────────────────────────────────────────────────────
async function sendAdminPanel(bot, chatId, messageId = null) {
  const cfg = getConfig();
  const users = usersDB.read();
  const transactions = transactionsDB.read();
  const products = productsDB.read();

  const totalUsers = Object.values(users).filter(u => u && u.id).length;
  const allTrx     = Object.values(transactions).filter(t => t && t.id);
  const totalTrx   = allTrx.length;
  const successTrx = allTrx.filter(t => t.status === 'success').length;
  const lastSync   = products._meta?.last_sync ? formatDate(products._meta.last_sync) : 'Belum pernah';
  const waStatus   = whatsapp.isWAConnected() ? '✅ Terhubung' : whatsapp.isWAConnecting() ? '⏳ Connecting...' : '❌ Terputus';

  const text =
    `✨ *ADMIN CONTROL CENTER* ✨\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🤖 *Bot:* ${cfg.app.bot_name}\n` +
    `👥 *Users:* ${totalUsers.toLocaleString()}\n` +
    `📊 *Trx:* ${totalTrx} (✅ ${successTrx})\n` +
    `📱 *WA Status:* ${waStatus}\n` +
    `🔄 *Last Sync:* ${lastSync}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `Silakan pilih menu manajemen di bawah ini:`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '📱 WhatsApp',     callback_data: 'admin_wa'        },
        { text: '🔄 Sync Produk',  callback_data: 'admin_sync'      }
      ],
      [
        { text: '💰 Saldo Orkut',  callback_data: 'admin_orkut_balance' },
        { text: '📊 Statistik',    callback_data: 'admin_stats'     }
      ],
      [
        { text: '👥 Manajemen User', callback_data: 'admin_users'     }
      ],
      [
        { text: '📢 Broadcast',    callback_data: 'admin_broadcast' },
        { text: '⚙️ Bot Identity', callback_data: 'admin_bot_identity' }
      ],
      [
        { text: '💸 Withdrawals',  callback_data: 'admin_withdrawals' },
        { text: '⚙️ Settings',     callback_data: 'admin_settings'  }
      ],
      [
        { text: '🔑 API Keys',     callback_data: 'admin_apikeys'  },
        { text: '💰 Markup',       callback_data: 'admin_markup'   }
      ],
      [
        { text: '❌ Tutup Panel',   callback_data: 'admin_close'    }
      ]
    ]
  };

  if (messageId) {
    await bot.editMessageText(text, {
      chat_id: chatId, message_id: messageId,
      parse_mode: 'Markdown', reply_markup: keyboard
    }).catch(() => {});
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

// ─── Route Callback Admin ──────────────────────────────────────────────────────
async function handleAdminCallback(bot, chatId, userId, data, query) {
  if (!isAdmin(userId)) return;
  const messageId = query.message.message_id;

  // ── WA ──────────────────────────────────────────────────────────────────────
  if (data === 'admin_wa')             { await showWAMenu(bot, chatId, messageId); return; }
  if (data === 'admin_wa_connect')     { await bot.answerCallbackQuery(query.id, { text: '⏳ Menyiapkan QR...' }); await whatsapp.connectWhatsApp(bot); return; }
  if (data === 'admin_wa_disconnect')  { await whatsapp.disconnectWhatsApp(); await bot.answerCallbackQuery(query.id, { text: '✅ WA Terputus' }); await showWAMenu(bot, chatId, messageId); return; }

  // ── Sync ─────────────────────────────────────────────────────────────────────
  if (data === 'admin_sync')           { await handleSync(bot, chatId, messageId); return; }

  // ── Balance ──────────────────────────────────────────────────────────────────
  if (data === 'admin_orkut_balance')  { await showOrkutBalance(bot, chatId, messageId); return; }
  if (data === 'admin_pakasir_balance') { await showPakasirBalance(bot, chatId, messageId); return; }
  if (data === 'admin_midtrans_balance') { await showMidtransBalance(bot, chatId, messageId); return; }
  
  if (data === 'admin_orkut_withdraw') { 
    await bot.answerCallbackQuery(query.id); 
    menuHandler.setUserState(userId, { flow: 'admin', step: 'orkut_wd_provider', msgId: messageId }); 
    await bot.sendMessage(chatId, 
      '💸 *Withdraw Saldo Admin*\n\nPilih sumber saldo yang ingin ditarik:',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📸 OrderKuota (Orkut)', callback_data: 'admin_wd_src_orkut' }],
            [{ text: '🏦 Pakasir', callback_data: 'admin_wd_src_pakasir' }],
            [{ text: '💳 Midtrans', callback_data: 'admin_wd_src_midtrans' }],
            [{ text: '❌ Batal', callback_data: 'admin_main' }]
          ]
        }
      }
    ); 
    return; 
  }
  
  if (data === 'admin_bot_identity')   { await showBotIdentitySettings(bot, chatId, messageId); return; }
  if (data === 'admin_set_bot_name')    { await bot.answerCallbackQuery(query.id); menuHandler.setUserState(userId, { flow: 'admin', step: 'set_bot_name', msgId: messageId }); await bot.sendMessage(chatId, '📝 Masukkan *Nama Bot* baru:'); return; }
  if (data === 'admin_set_bot_thumb')   { await bot.answerCallbackQuery(query.id); menuHandler.setUserState(userId, { flow: 'admin', step: 'set_bot_thumb', msgId: messageId }); await bot.sendMessage(chatId, '🖼️ Masukkan *URL Thumbnail* baru (Link Gambar):'); return; }

  // ── Stats & Users ─────────────────────────────────────────────────────────────
  if (data === 'admin_stats')          { await showStats(bot, chatId, messageId); return; }
  if (data === 'admin_users')          { await showUserList(bot, chatId, 0, messageId); return; }
  if (data === 'admin_withdrawals')    { await showWithdrawRequests(bot, chatId, messageId); return; }
  if (data.startsWith('admin_wd_approve_')) {
    const wdId = data.replace('admin_wd_approve_', '');
    await handleWithdrawAction(bot, chatId, userId, wdId, 'success');
    return;
  }
  if (data.startsWith('admin_wd_reject_')) {
    const wdId = data.replace('admin_wd_reject_', '');
    await handleWithdrawAction(bot, chatId, userId, wdId, 'failed');
    return;
  }
  if (data.startsWith('admin_users_page_')) {
    const page = parseInt(data.replace('admin_users_page_', ''));
    await showUserList(bot, chatId, page, messageId);
    return;
  }

  // ── Broadcast ─────────────────────────────────────────────────────────────────
  if (data === 'admin_broadcast')      { await handleBroadcastInit(bot, chatId, userId, messageId); return; }

  // ── Settings ──────────────────────────────────────────────────────────────────
  if (data === 'admin_settings')       { await showSettings(bot, chatId, messageId); return; }
  if (data === 'admin_markup')         { await showMarkupSettings(bot, chatId, messageId); return; }
  if (data === 'admin_apikeys')        { await showAPISettings(bot, chatId, messageId); return; }
  if (data === 'admin_orkut_settings') { await showOrkutSettings(bot, chatId, messageId); return; }
  if (data === 'admin_set_orkut_user') { await bot.answerCallbackQuery(query.id); menuHandler.setUserState(userId, { flow: 'admin', step: 'set_orkut_user', msgId: messageId }); await bot.sendMessage(chatId, '📝 Masukkan *Username Orkut*:'); return; }
  if (data === 'admin_set_orkut_token'){ await bot.answerCallbackQuery(query.id); menuHandler.setUserState(userId, { flow: 'admin', step: 'set_orkut_token', msgId: messageId }); await bot.sendMessage(chatId, '📝 Masukkan *Token Orkut*:'); return; }
  if (data === 'admin_set_orkut_key')  { await bot.answerCallbackQuery(query.id); menuHandler.setUserState(userId, { flow: 'admin', step: 'set_orkut_key', msgId: messageId }); await bot.sendMessage(chatId, '📝 Masukkan *TokenKey Orkut*:'); return; }
  
  if (data.startsWith('admin_wd_src_')) {
    const src = data.replace('admin_wd_src_', '');
    const state = menuHandler.getUserState(userId);
    menuHandler.setUserState(userId, { ...state, source: src, step: 'orkut_wd_amount' });
    await bot.sendMessage(chatId, `💸 *Withdraw via ${src.toUpperCase()}*\n\nMasukkan jumlah yang ingin ditarik:`);
    return;
  }

  if (data === 'admin_orkut_wd_confirm') { await handleOrkutWithdrawConfirm(bot, chatId, userId); return; }

  // ── Sync ─────────────────────────────────────────────────────────────────────
  if (data === 'admin_set_markup_user')     { menuHandler.setUserState(userId, { flow: 'admin', step: 'set_markup_user',     msgId: messageId }); await bot.editMessageText('✏️ Masukkan markup user baru (angka %, contoh: 10):', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'admin_markup' }]] } }); return; }
  if (data === 'admin_set_markup_reseller') { menuHandler.setUserState(userId, { flow: 'admin', step: 'set_markup_reseller', msgId: messageId }); await bot.editMessageText('✏️ Masukkan markup reseller baru (angka %, contoh: 5):', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'admin_markup' }]] } }); return; }
  if (data === 'admin_set_reseller_fee')    { menuHandler.setUserState(userId, { flow: 'admin', step: 'set_reseller_fee',    msgId: messageId }); await bot.editMessageText('✏️ Masukkan biaya upgrade reseller baru (Rp, contoh: 50000):', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'admin_settings' }]] } }); return; }

  // ── API Key Edit ──────────────────────────────────────────────────────────────
  if (data === 'admin_set_tg_token')        { menuHandler.setUserState(userId, { flow: 'admin', step: 'set_tg_token',        msgId: messageId }); await bot.editMessageText('✏️ Masukkan Telegram Bot Token baru:', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'admin_apikeys' }]] } }); return; }
  if (data === 'admin_set_midtrans_key')    { menuHandler.setUserState(userId, { flow: 'admin', step: 'set_midtrans_key',    msgId: messageId }); await bot.editMessageText('✏️ Masukkan Midtrans Server Key baru:', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'admin_apikeys' }]] } }); return; }
  if (data === 'admin_set_pakasir_key')     { menuHandler.setUserState(userId, { flow: 'admin', step: 'set_pakasir_key',     msgId: messageId }); await bot.editMessageText('✏️ Masukkan Pakasir API Key baru:', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'admin_apikeys' }]] } }); return; }
  if (data === 'admin_set_pakasir_project') { menuHandler.setUserState(userId, { flow: 'admin', step: 'set_pakasir_project', msgId: messageId }); await bot.editMessageText('✏️ Masukkan Pakasir Project Slug baru:', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'admin_apikeys' }]] } }); return; }
  if (data === 'admin_set_vip_key')         { menuHandler.setUserState(userId, { flow: 'admin', step: 'set_vip_key',         msgId: messageId }); await bot.editMessageText('✏️ Masukkan VIP Reseller API Key baru:', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'admin_apikeys' }]] } }); return; }
  if (data === 'admin_set_vip_member')      { menuHandler.setUserState(userId, { flow: 'admin', step: 'set_vip_member',      msgId: messageId }); await bot.editMessageText('✏️ Masukkan VIP Reseller Member ID baru:', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'admin_apikeys' }]] } }); return; }
  if (data === 'admin_set_apigames_key')    { menuHandler.setUserState(userId, { flow: 'admin', step: 'set_apigames_key',    msgId: messageId }); await bot.editMessageText('✏️ Masukkan API Games Merchant ID baru:', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'admin_apikeys' }]] } }); return; }
  if (data === 'admin_set_apigames_secret') { menuHandler.setUserState(userId, { flow: 'admin', step: 'set_apigames_secret', msgId: messageId }); await bot.editMessageText('✏️ Masukkan API Games Secret Key baru:', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'admin_apikeys' }]] } }); return; }
  if (data === 'admin_set_webhook_url')     { menuHandler.setUserState(userId, { flow: 'admin', step: 'set_webhook_url',     msgId: messageId }); await bot.editMessageText('✏️ Masukkan Base URL webhook baru (contoh: https://yourdomain.com):', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'admin_settings' }]] } }); return; }

  // ── Saldo User ────────────────────────────────────────────────────────────────
  if (data === 'admin_add_saldo')      { menuHandler.setUserState(userId, { flow: 'admin', step: 'add_saldo_id',  msgId: messageId }); await bot.editMessageText('✏️ Masukkan Telegram ID user yang ingin ditambah saldo:', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'admin_users' }]] } }); return; }

  // ── Navigation ────────────────────────────────────────────────────────────────
  if (data === 'admin_main')           { await sendAdminPanel(bot, chatId, messageId); return; }
  if (data === 'admin_close')          { await bot.deleteMessage(chatId, messageId).catch(() => {}); return; }

  await bot.answerCallbackQuery(query.id, { text: 'Tidak dikenali' });
}

/**
 * Menu WhatsApp
 */
async function showWAMenu(bot, chatId, messageId) {
  const connected = whatsapp.isWAConnected();
  const number = config.whatsapp._connected_number || '-';

  const text =
    `📱 *KONEKSI WHATSAPP*\n\n` +
    `Status: *${connected ? 'Terhubung ✅' : 'Terputus ❌'}*\n` +
    `${connected ? `Nomor: *+${number}*\n` : 'Silakan klik Connect untuk memunculkan QR Code.'}\n\n` +
    `WhatsApp digunakan untuk mengirim notifikasi transaksi ke admin.`;

  const keyboard = {
    inline_keyboard: [
      connected
        ? [{ text: '❌ Disconnect WA', callback_data: 'admin_wa_disconnect' }]
        : [{ text: '🔌 Connect WA (Scan QR)', callback_data: 'admin_wa_connect' }],
      [{ text: '🔙 Kembali', callback_data: 'admin_main' }]
    ]
  };

  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: keyboard
  }).catch(() => {});
}

/**
 * Handle Sinkronisasi Produk
 */
async function handleSync(bot, chatId, messageId) {
  try {
    const total = await syncProducts();
    await bot.sendMessage(chatId, `✅ Sinkronisasi berhasil! *${total}* produk diupdate.`, { parse_mode: 'Markdown' });
    await sendAdminPanel(bot, chatId, messageId);
  } catch (err) {
    await bot.sendMessage(chatId, `❌ Sinkronisasi gagal: ${err.message}`);
  }
}

/**
 * Tampilkan Statistik Singkat
 */
async function showStats(bot, chatId, messageId) {
  const transactions = transactionsDB.read();
  const allTrx = Object.values(transactions).filter(t => typeof t === 'object');

  const pending = allTrx.filter(t => t.status === 'pending').length;
  const success = allTrx.filter(t => t.status === 'success').length;
  const failed  = allTrx.filter(t => t.status === 'failed').length;

  const totalRevenue = allTrx
    .filter(t => t.status === 'success')
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  const text =
    `📈 *STATISTIK BOT*\n\n` +
    `✅ Sukses: *${success}*\n` +
    `⏳ Pending: *${pending}*\n` +
    `❌ Gagal: *${failed}*\n\n` +
    `💰 Total Omset: *${formatCurrency(totalRevenue)}*`;

  const keyboard = {
    inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'admin_main' }]]
  };

  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: keyboard
  }).catch(() => {});
}

// ─── Daftar User dengan Pagination ────────────────────────────────────────────
async function showUserList(bot, chatId, page = 0, messageId = null) {
  const PAGE = 8;
  const users = usersDB.read();
  const userList = Object.values(users).filter(u => u && u.id);
  userList.sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt));

  const total = userList.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const slice = userList.slice(page * PAGE, (page + 1) * PAGE);

  let text = `👥 *DAFTAR USER*\nTotal: ${total} | Hal ${page + 1}/${totalPages}\n\n`;
  slice.forEach((u, i) => {
    const idx = page * PAGE + i + 1;
    text += `${idx}. *${u.name}*\n`;
    text += `   📱 ${u.phone} | 💰 ${formatCurrency(u.balance || 0)}\n`;
    text += `   ${u.isReseller ? '🏪 Reseller' : '👤 Member'} | ID: \`${u.id}\`\n\n`;
  });
  if (total === 0) text += 'Belum ada user.';

  const nav = [];
  if (page > 0) nav.push({ text: '◀️', callback_data: `admin_users_page_${page - 1}` });
  if (page < totalPages - 1) nav.push({ text: '▶️', callback_data: `admin_users_page_${page + 1}` });

  const keyboard = { inline_keyboard: [] };
  if (nav.length) keyboard.inline_keyboard.push(nav);
  keyboard.inline_keyboard.push([
    { text: '➕ Tambah Saldo', callback_data: 'admin_add_saldo' },
    { text: '🔙 Kembali',      callback_data: 'admin_main'      }
  ]);

  if (messageId) {
    await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => {});
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

// ─── Broadcast Init ────────────────────────────────────────────────────────────
async function handleBroadcastInit(bot, chatId, userId, messageId) {
  menuHandler.setUserState(userId, { flow: 'admin', step: 'broadcast_msg', msgId: messageId });
  await bot.editMessageText(
    `📢 *BROADCAST PESAN*\n\nKetik pesan yang ingin dikirim ke semua user.\nBisa pakai *bold*, _italic_, \`code\`.`,
    {
      chat_id: chatId, message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'admin_main' }]] }
    }
  ).catch(() => {});
}

// ─── Handle semua input admin ──────────────────────────────────────────────────
async function handleAdminInput(bot, msg, state) {
  const userId = String(msg.from.id);
  if (!isAdmin(userId)) return;

  const text = msg.text?.trim();
  if (!text) return;

  const chatId   = msg.chat.id;
  const msgId    = state.msgId;
  const cfg      = getConfig();

  menuHandler.clearUserState(userId);

  // ── Broadcast ────────────────────────────────────────────────────────────────
  if (state.step === 'broadcast_msg') {
    await bot.sendMessage(chatId, `⏳ Mengirim broadcast...`);
    const users = usersDB.read();
    const ids = Object.values(users).filter(u => u && u.id).map(u => u.id);
    let ok = 0, fail = 0;
    for (const id of ids) {
      try { await bot.sendMessage(id, text, { parse_mode: 'Markdown' }); ok++; }
      catch { fail++; }
      await new Promise(r => setTimeout(r, 50));
    }
    await bot.sendMessage(chatId, `✅ Broadcast selesai!\n✅ Berhasil: *${ok}*\n❌ Gagal: *${fail}*`, { parse_mode: 'Markdown' });
    await sendAdminPanel(bot, chatId);
    return;
  }

  // ── Markup User ───────────────────────────────────────────────────────────────
  if (state.step === 'set_markup_user') {
    const val = parseFloat(text);
    if (isNaN(val) || val < 0 || val > 100) { await bot.sendMessage(chatId, '❌ Nilai tidak valid (0-100).'); await showMarkupSettings(bot, chatId, msgId); return; }
    cfg.markup.markup_user = val;
    saveConfig(cfg);
    await bot.sendMessage(chatId, `✅ Markup user diubah ke *${val}%*`, { parse_mode: 'Markdown' });
    await showMarkupSettings(bot, chatId, msgId);
    return;
  }

  // ── Markup Reseller ───────────────────────────────────────────────────────────
  if (state.step === 'set_markup_reseller') {
    const val = parseFloat(text);
    if (isNaN(val) || val < 0 || val > 100) { await bot.sendMessage(chatId, '❌ Nilai tidak valid (0-100).'); await showMarkupSettings(bot, chatId, msgId); return; }
    cfg.markup.markup_reseller = val;
    saveConfig(cfg);
    await bot.sendMessage(chatId, `✅ Markup reseller diubah ke *${val}%*`, { parse_mode: 'Markdown' });
    await showMarkupSettings(bot, chatId, msgId);
    return;
  }

  // ── Biaya Reseller ────────────────────────────────────────────────────────────
  if (state.step === 'set_reseller_fee') {
    const val = parseInt(text.replace(/\D/g, ''));
    if (isNaN(val) || val < 0) { await bot.sendMessage(chatId, '❌ Nilai tidak valid.'); return; }
    cfg.reseller.upgrade_fee = val;
    saveConfig(cfg);
    await bot.sendMessage(chatId, `✅ Biaya upgrade reseller diubah ke *${formatCurrency(val)}*`, { parse_mode: 'Markdown' });
    await showSettings(bot, chatId, msgId);
    return;
  }

  // ── Webhook URL ───────────────────────────────────────────────────────────────
  if (state.step === 'set_webhook_url') {
    if (!text.startsWith('http')) { await bot.sendMessage(chatId, '❌ URL harus diawali http/https.'); return; }
    cfg.webhook.base_url = text.replace(/\/$/, '');
    saveConfig(cfg);
    await bot.sendMessage(chatId, `✅ Webhook URL diubah ke:\n\`${cfg.webhook.base_url}\``, { parse_mode: 'Markdown' });
    await showSettings(bot, chatId, msgId);
    return;
  }

  // ── Telegram Token ────────────────────────────────────────────────────────────
  if (state.step === 'set_tg_token') {
    cfg.telegram.token = text;
    saveConfig(cfg);
    await bot.sendMessage(chatId, `✅ Telegram Token disimpan.\n⚠️ Restart bot agar perubahan berlaku.`);
    await showAPISettings(bot, chatId, msgId);
    return;
  }

  // ── Midtrans Key ──────────────────────────────────────────────────────────────
  if (state.step === 'set_midtrans_key') {
    cfg.midtrans.server_key = text;
    saveConfig(cfg);
    await bot.sendMessage(chatId, `✅ Midtrans Server Key disimpan.`);
    await showAPISettings(bot, chatId, msgId);
    return;
  }

  // ── Pakasir Key ───────────────────────────────────────────────────────────────
  if (state.step === 'set_pakasir_key') {
    cfg.pakasir.api_key = text;
    saveConfig(cfg);
    await bot.sendMessage(chatId, `✅ Pakasir API Key disimpan.`);
    await showAPISettings(bot, chatId, msgId);
    return;
  }

  if (state.step === 'set_pakasir_project') {
    cfg.pakasir.project = text;
    saveConfig(cfg);
    await bot.sendMessage(chatId, `✅ Pakasir Project Slug disimpan.`);
    await showAPISettings(bot, chatId, msgId);
    return;
  }

  // ── VIP Reseller Key ──────────────────────────────────────────────────────────
  if (state.step === 'set_vip_key') {
    cfg.vip_reseller.api_key = text;
    saveConfig(cfg);
    await bot.sendMessage(chatId, `✅ VIP Reseller API Key disimpan.`);
    await showAPISettings(bot, chatId, msgId);
    return;
  }

  // ── VIP Member ID ─────────────────────────────────────────────────────────────
  if (state.step === 'set_vip_member') {
    cfg.vip_reseller.member_id = text;
    saveConfig(cfg);
    await bot.sendMessage(chatId, `✅ VIP Reseller Member ID disimpan.`);
    await showAPISettings(bot, chatId, msgId);
    return;
  }

  // ── API Games Key ─────────────────────────────────────────────────────────────
  if (state.step === 'set_apigames_key') {
    cfg.api_games.merchant_id = text;
    saveConfig(cfg);
    await bot.sendMessage(chatId, `✅ API Games Merchant ID disimpan.`);
    await showAPISettings(bot, chatId, msgId);
    return;
  }

  // ── API Games Secret Key ──────────────────────────────────────────────────────
  if (state.step === 'set_apigames_secret') {
    cfg.api_games.secret_key = text;
    saveConfig(cfg);
    await bot.sendMessage(chatId, `✅ API Games Secret Key disimpan.`);
    await showAPISettings(bot, chatId, msgId);
    return;
  }

  // ── Orkut Settings ──────────────────────────────────────────────────────────
  if (state.step === 'set_orkut_user') {
    const pay = getPayment();
    pay.auth_username = text;
    savePayment(pay);
    await bot.sendMessage(chatId, `✅ Orkut Username disimpan.`);
    await showOrkutSettings(bot, chatId, msgId);
    return;
  }

  if (state.step === 'set_orkut_token') {
    const pay = getPayment();
    pay.auth_token = text;
    savePayment(pay);
    await bot.sendMessage(chatId, `✅ Orkut Token disimpan.`);
    await showOrkutSettings(bot, chatId, msgId);
    return;
  }

  if (state.step === 'set_orkut_key') {
    const pay = getPayment();
    pay.tokenKey = text;
    savePayment(pay);
    await bot.sendMessage(chatId, `✅ Orkut TokenKey disimpan.`);
    await showOrkutSettings(bot, chatId, msgId);
    return;
  }

  // ── Bot Identity ────────────────────────────────────────────────────────────
  if (state.step === 'set_bot_name') {
    const c = getConfig();
    c.app.bot_name = text;
    saveConfig(c);
    await bot.sendMessage(chatId, `✅ Nama Bot berhasil diubah menjadi: *${text}*`, { parse_mode: 'Markdown' });
    await showBotIdentitySettings(bot, chatId, msgId);
    return;
  }

  if (state.step === 'set_bot_thumb') {
    const c = getConfig();
    c.app.bot_thumbnail = text;
    saveConfig(c);
    await bot.sendMessage(chatId, `✅ Thumbnail Bot berhasil diperbarui.`);
    await showBotIdentitySettings(bot, chatId, msgId);
    return;
  }

  // ── Orkut Withdrawal Flow ───────────────────────────────────────────────────
  if (state.step === 'orkut_wd_amount') {
    const amount = parseInt(text.replace(/\D/g, ''));
    if (isNaN(amount) || amount <= 0) { await bot.sendMessage(chatId, '❌ Nominal tidak valid.'); return; }
    menuHandler.setUserState(userId, { ...state, step: 'orkut_wd_bank', amount });
    await bot.sendMessage(chatId, '🏦 Masukkan *Nama Bank / E-Wallet* (contoh: DANA, BCA, GOPAY):');
    return;
  }

  if (state.step === 'orkut_wd_bank') {
    menuHandler.setUserState(userId, { ...state, step: 'orkut_wd_acc_num', bankCode: text });
    await bot.sendMessage(chatId, '🔢 Masukkan *Nomor Rekening / No HP*:');
    return;
  }

  if (state.step === 'orkut_wd_acc_num') {
    menuHandler.setUserState(userId, { ...state, step: 'orkut_wd_acc_name', accountNum: text });
    await bot.sendMessage(chatId, '👤 Masukkan *Nama Pemilik Rekening*:');
    return;
  }

  if (state.step === 'orkut_wd_acc_name') {
    const { amount, bankCode, accountNum } = state;
    const accountName = text;
    
    await bot.sendMessage(chatId, 
      `📋 *KONFIRMASI WITHDRAW ORKUT*\n\n` +
      `💰 Nominal: *${formatCurrency(amount)}*\n` +
      `🏦 Bank/Wallet: *${bankCode}*\n` +
      `🔢 Nomor: \`${accountNum}\`\n` +
      `👤 Nama: *${accountName}*\n\n` +
      `Apakah data sudah benar?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Ya, Tarik Sekarang', callback_data: `admin_orkut_wd_confirm` }],
            [{ text: '❌ Batal', callback_data: 'admin_main' }]
          ]
        }
      }
    );
    // Simpan data ke state sementara untuk dikonfirmasi di callback
    menuHandler.setUserState(userId, { ...state, accountName, step: 'orkut_wd_confirm' });
    return;
  }

  // ── Tambah Saldo — Step 1: input ID ──────────────────────────────────────────
  if (state.step === 'add_saldo_id') {
    const targetUser = usersDB.get(text);
    if (!targetUser) { await bot.sendMessage(chatId, `❌ User dengan ID \`${text}\` tidak ditemukan.`, { parse_mode: 'Markdown' }); return; }
    menuHandler.setUserState(userId, { flow: 'admin', step: 'add_saldo_amount', targetId: text, msgId });
    await bot.sendMessage(chatId,
      `👤 User: *${targetUser.name}*\nSaldo saat ini: *${formatCurrency(targetUser.balance || 0)}*\n\n✏️ Masukkan jumlah saldo yang ingin ditambahkan (Rp):`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ── Tambah Saldo — Step 2: input nominal ─────────────────────────────────────
  if (state.step === 'add_saldo_amount') {
    const amount = parseInt(text.replace(/\D/g, ''));
    if (isNaN(amount) || amount <= 0) { await bot.sendMessage(chatId, '❌ Nominal tidak valid.'); return; }
    const targetUser = usersDB.get(state.targetId);
    if (!targetUser) { await bot.sendMessage(chatId, '❌ User tidak ditemukan.'); return; }
    const newBalance = (targetUser.balance || 0) + amount;
    usersDB.update(state.targetId, { balance: newBalance });
    await bot.sendMessage(chatId,
      `✅ *Saldo berhasil ditambahkan!*\n\n👤 User: *${targetUser.name}*\n➕ Ditambah: *${formatCurrency(amount)}*\n💰 Saldo baru: *${formatCurrency(newBalance)}*`,
      { parse_mode: 'Markdown' }
    );
    // Notif ke user
    try {
      await bot.sendMessage(state.targetId,
        `💰 *Saldo Anda ditambahkan!*\n\n➕ *+${formatCurrency(amount)}*\n💰 Saldo baru: *${formatCurrency(newBalance)}*`,
        { parse_mode: 'Markdown' }
      );
    } catch { /* user mungkin belum start bot */ }
    await sendAdminPanel(bot, chatId);
    return;
  }
}

/**
 * Handle Sinkronisasi Produk Manual
 */
async function handleSync(bot, chatId, messageId) {
  try {
    await bot.editMessageText(`⏳ *SINKRONISASI PRODUK*\n\nSedang mengambil data terbaru dari API provider...\nMohon tunggu sebentar.`, {
      chat_id: chatId, message_id: messageId,
      parse_mode: 'Markdown'
    }).catch(() => {});

    const total = await syncProducts();

    await bot.editMessageText(
      `✅ *SINKRONISASI SELESAI!*\n\n` +
      `Total produk tersimpan: *${total}*\n` +
      `Semua harga telah diperbarui ke harga modal terbaru.\n\n` +
      `_Markup saat ini:_\n` +
      `- User: *${getConfig().markup.markup_user}%*\n` +
      `- Reseller: *${getConfig().markup.markup_reseller}%*`,
      {
        chat_id: chatId, message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'admin_main' }]] }
      }
    ).catch(() => {});
  } catch (err) {
    logger.error('AdminHandler', 'Sync manual gagal', { msg: err.message });
    await bot.sendMessage(chatId, `❌ Sinkronisasi gagal: ${err.message}`);
    await sendAdminPanel(bot, chatId, messageId);
  }
}

// ─── Settings Panel ─────────────────────────────────────────────────────────────
async function showSettings(bot, chatId, messageId) {
  const cfg = getConfig();
  const text =
    `⚙️ *PENGATURAN BOT*\n\n` +
    `🌐 Webhook URL: \`${cfg.webhook.base_url}\`\n` +
    `🔌 Port: *${cfg.webhook.port}*\n` +
    `💸 Biaya Upgrade Reseller: *${formatCurrency(cfg.reseller.upgrade_fee)}*\n` +
    `💰 Komisi Reseller: *${cfg.commission?.rate_reseller || 0}%*\n\n` +
    `Pilih yang ingin diubah:`;

  await bot.editMessageText(text, {
    chat_id: chatId, message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🌐 Ganti Webhook URL',      callback_data: 'admin_set_webhook_url'  }],
        [{ text: '💸 Biaya Upgrade Reseller', callback_data: 'admin_set_reseller_fee' }],
        [{ text: '🔙 Kembali',                callback_data: 'admin_main'             }]
      ]
    }
  }).catch(() => {});
}

// ─── Settings Markup ───────────────────────────────────────────────────────────
async function showMarkupSettings(bot, chatId, messageId) {
  const cfg = getConfig();
  const text =
    `💰 *PENGATURAN MARKUP HARGA*\n\n` +
    `👤 Markup User: *${cfg.markup.markup_user}%*\n` +
    `🏪 Markup Reseller: *${cfg.markup.markup_reseller}%*\n\n` +
    `_Markup = keuntungan di atas harga modal API._\n` +
    `_Contoh: modal 10.000 + markup 10% = jual 11.000_`;

  await bot.editMessageText(text, {
    chat_id: chatId, message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: `✏️ Markup User (${cfg.markup.markup_user}%)`,       callback_data: 'admin_set_markup_user'     }],
        [{ text: `✏️ Markup Reseller (${cfg.markup.markup_reseller}%)`, callback_data: 'admin_set_markup_reseller' }],
        [{ text: '🔙 Kembali', callback_data: 'admin_main' }]
      ]
    }
  }).catch(() => {});
}

/**
 * Tampilkan Daftar Request Withdraw
 */
async function showWithdrawRequests(bot, chatId, messageId) {
  const transactions = transactionsDB.read();
  const requests = Object.values(transactions).filter(t => t.type === 'withdraw' && t.status === 'pending');

  let text = `💸 *REQUEST PENARIKAN (PENDING)*\n\n`;
  const keyboard = { inline_keyboard: [] };

  if (requests.length === 0) {
    text += `Tidak ada request pending.`;
  } else {
    requests.forEach(req => {
      text += `🆔 ID: \`${req.id}\`\n`;
      text += `👤 User: ${req.userId}\n`;
      text += `💰 Nominal: *${formatCurrency(req.amount)}*\n`;
      text += `🎯 Tujuan: \`${req.account}\` (${req.method})\n\n`;
      
      keyboard.inline_keyboard.push([
        { text: `✅ Approve ${req.id.slice(-4)}`, callback_data: `admin_wd_approve_${req.id}` },
        { text: `❌ Reject ${req.id.slice(-4)}`, callback_data: `admin_wd_reject_${req.id}` }
      ]);
    });
  }

  keyboard.inline_keyboard.push([{ text: '🔙 Kembali', callback_data: 'admin_main' }]);

  await bot.editMessageText(text, {
    chat_id: chatId, message_id: messageId,
    parse_mode: 'Markdown', reply_markup: keyboard
  }).catch(() => {});
}

async function handleWithdrawAction(bot, chatId, adminId, wdId, status) {
  const transactions = transactionsDB.read();
  const req = transactions[wdId];
  if (!req) return;

  transactionsDB.update(wdId, {
    status,
    processedAt: new Date().toISOString()
  });

  const user = usersDB.get(req.userId);

  if (status === 'success') {
    await bot.sendMessage(chatId, `✅ Berhasil menyetujui penarikan \`${wdId}\``);
    if (user) {
      await bot.sendMessage(req.userId, 
        `✅ *PENARIKAN BERHASIL!*\n\n` +
        `ID: \`${wdId}\`\n` +
        `Nominal: *${formatCurrency(req.amount)}*\n` +
        `Tujuan: \`${req.account}\` (${req.method})\n\n` +
        `Dana telah dikirim ke rekening/e-wallet Anda.`,
        { parse_mode: 'Markdown' }
      );
    }
  } else {
    // Kembalikan saldo jika reject
    if (user) {
      usersDB.update(req.userId, { balance: (user.balance || 0) + req.amount });
      await bot.sendMessage(chatId, `❌ Berhasil menolak penarikan \`${wdId}\`. Saldo user dikembalikan.`);
      await bot.sendMessage(req.userId, 
        `❌ *PENARIKAN DITOLAK*\n\n` +
        `ID: \`${wdId}\`\n` +
        `Nominal: *${formatCurrency(req.amount)}*\n\n` +
        `Saldo telah dikembalikan ke akun Anda.`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  await sendAdminPanel(bot, chatId); // Refresh list
}

// ─── Settings API Keys ─────────────────────────────────────────────────────────
async function showAPISettings(bot, chatId, messageId) {
  const cfg = getConfig();

  function mask(str) {
    if (!str || str.startsWith('YOUR_')) return '❌ Belum diisi';
    return str.substring(0, 6) + '••••••' + str.slice(-4);
  }

  const text =
    `🔑 *PENGATURAN API KEYS*\n\n` +
    `🤖 Telegram Token: \`${mask(cfg.telegram.token)}\`\n` +
    `💳 Midtrans Key: \`${mask(cfg.midtrans.server_key)}\`\n` +
    `🏦 Pakasir API Key: \`${mask(cfg.pakasir.api_key)}\`\n` +
    `🏦 Pakasir Project: \`${cfg.pakasir.project || '❌ Belum diisi'}\`\n` +
    `🛒 VIP Reseller Key: \`${mask(cfg.vip_reseller.api_key)}\`\n` +
    `🛒 VIP Member ID: \`${mask(cfg.vip_reseller.member_id)}\`\n` +
    `🎮 API Games Merchant ID: \`${mask(cfg.api_games.merchant_id)}\`\n` +
    `🎮 API Games Secret Key: \`${mask(cfg.api_games.secret_key)}\`\n\n` +
    `Pilih yang ingin diubah:`;

  await bot.editMessageText(text, {
    chat_id: chatId, message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🤖 Telegram Token',    callback_data: 'admin_set_tg_token'     }],
        [{ text: '💳 Midtrans Key',      callback_data: 'admin_set_midtrans_key'  }],
        [{ text: '🏦 Pakasir API Key',   callback_data: 'admin_set_pakasir_key'   }],
        [{ text: '🏦 Pakasir Project',   callback_data: 'admin_set_pakasir_project'}],
        [{ text: '🛒 VIP Reseller Key',  callback_data: 'admin_set_vip_key'      }],
        [{ text: '🛒 VIP Member ID',     callback_data: 'admin_set_vip_member'   }],
        [{ text: '🎮 API Games Merchant ID', callback_data: 'admin_set_apigames_key'    }],
        [{ text: '🎮 API Games Secret Key',  callback_data: 'admin_set_apigames_secret'  }],
        [{ text: '📸 OrderKuota (Orkut) Settings', callback_data: 'admin_orkut_settings' }],
        [{ text: '🔙 Kembali',           callback_data: 'admin_main'             }]
      ]
    }
  }).catch(() => {});
}

/**
 * Tampilkan Pengaturan OrderKuota (Orkut)
 */
async function showOrkutSettings(bot, chatId, messageId) {
  const pay = getPayment();

  function mask(str) {
    if (!str || str.startsWith('YOUR_') || str === '') return '❌ Belum diisi';
    return str.substring(0, 6) + '••••••' + str.slice(-4);
  }

  const text =
    `📸 *PENGATURAN ORDERKUOTA (ORKUT)*\n\n` +
    `👤 Username Orkut: \`${pay.auth_username || '❌ Belum diisi'}\`\n` +
    `🔑 Token Orkut: \`${mask(pay.auth_token)}\`\n` +
    `🗝️ TokenKey Orkut: \`${mask(pay.tokenKey)}\`\n\n` +
    `_Pengaturan ini digunakan untuk cek saldo dan withdraw._`;

  await bot.editMessageText(text, {
    chat_id: chatId, message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '👤 Ganti Username', callback_data: 'admin_set_orkut_user'  }],
        [{ text: '🔑 Ganti Token',    callback_data: 'admin_set_orkut_token' }],
        [{ text: '🗝️ Ganti TokenKey', callback_data: 'admin_set_orkut_key'   }],
        [{ text: '🔙 Kembali',        callback_data: 'admin_apikeys'         }]
      ]
    }
  }).catch(() => {});
}

async function handleOrkutWithdrawConfirm(bot, chatId, userId) {
  const state = menuHandler.getUserState(userId);
  if (!state || state.step !== 'orkut_wd_confirm') return;

  const { getEngine } = require('../services/paymentEngine');
  const engine = getEngine();
  const source = state.source || 'orkut';

  try {
    await bot.sendMessage(chatId, `⏳ Sedang memproses penarikan saldo dari ${source.toUpperCase()}...`);
    
    // Untuk saat ini kita gunakan engine.withdrawBalance yang sama, 
    // tapi kita kirim source-nya sebagai info tambahan
    const res = await engine.withdrawBalance(state.amount, state.accountNum, state.accountName, state.bankCode, source);

    if (res.status || res.success) {
      await bot.sendMessage(chatId, 
        `✅ *PENARIKAN BERHASIL!*\n\n` +
        `� Sumber: *${source.toUpperCase()}*\n` +
        `�💰 Nominal: *${formatCurrency(state.amount)}*\n` +
        `🏦 Tujuan: *${state.bankCode}* (${state.accountNum})\n` +
        `👤 Nama: *${state.accountName}*\n\n` +
        `Pesan: _${res.message || 'Sukses'}_`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await bot.sendMessage(chatId, `❌ Gagal menarik saldo: ${res.message || 'Unknown error'}`);
    }
  } catch (err) {
    await bot.sendMessage(chatId, `❌ Kesalahan sistem: ${err.message}\n\n_Catatan: Jika fitur ini belum didukung API, silakan lakukan penarikan manual di dashboard ${source.toUpperCase()}._`, { parse_mode: 'Markdown' });
  }

  menuHandler.clearUserState(userId);
  await sendAdminPanel(bot, chatId);
}

/**
 * Tampilkan Saldo Pakasir
 */
async function showPakasirBalance(bot, chatId, messageId) {
  // Pakasir biasanya tidak punya API cek saldo, harus via dashboard
  const text = 
    `💰 *SALDO PAKASIR*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `Maaf, API Pakasir saat ini tidak mendukung pengecekan saldo secara real-time.\n\n` +
    `Silakan cek saldo Anda langsung di dashboard:\n` +
    `🌐 https://app.pakasir.com\n` +
    `━━━━━━━━━━━━━━━━━━━━━━`;

  await bot.editMessageText(text, {
    chat_id: chatId, message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '💸 Tarik Saldo (Request)', callback_data: 'admin_wd_src_pakasir' }],
        [{ text: '🔙 Kembali', callback_data: 'admin_orkut_balance' }]
      ]
    }
  }).catch(() => {});
}

/**
 * Tampilkan Saldo Midtrans
 */
async function showMidtransBalance(bot, chatId, messageId) {
  // Midtrans Iris API bisa cek saldo, tapi harus ada key khusus Iris
  const text = 
    `💰 *SALDO MIDTRANS*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `Untuk mengecek saldo Midtrans secara otomatis, Anda memerlukan API Key Midtrans Iris (Payouts).\n\n` +
    `Silakan cek saldo Anda di dashboard Midtrans:\n` +
    `🌐 https://dashboard.midtrans.com\n` +
    `━━━━━━━━━━━━━━━━━━━━━━`;

  await bot.editMessageText(text, {
    chat_id: chatId, message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '💸 Tarik Saldo (Request)', callback_data: 'admin_wd_src_midtrans' }],
        [{ text: '🔙 Kembali', callback_data: 'admin_orkut_balance' }]
      ]
    }
  }).catch(() => {});
}

/**
 * Pengaturan Identitas Bot (Nama & Thumbnail)
 */
async function showBotIdentitySettings(bot, chatId, messageId) {
  const cfg = getConfig();
  
  const text = 
    `🤖 *BOT IDENTITY SETTINGS*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📝 *Nama Bot:* ${cfg.app.bot_name}\n` +
    `🖼️ *Thumbnail:* ${cfg.app.bot_thumbnail ? 'Sudah diset ✅' : 'Belum diset ❌'}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `Silakan pilih yang ingin diubah:`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '📝 Ganti Nama Bot', callback_data: 'admin_set_bot_name' }],
      [{ text: '🖼️ Ganti Thumbnail', callback_data: 'admin_set_bot_thumb' }],
      [{ text: '🔙 Kembali', callback_data: 'admin_main' }]
    ]
  };

  if (cfg.app.bot_thumbnail) {
    await bot.sendPhoto(chatId, cfg.app.bot_thumbnail, {
      caption: text,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    }).then(() => {
      if (messageId) bot.deleteMessage(chatId, messageId).catch(() => {});
    }).catch(async () => {
      // Fallback if photo fails
      await bot.editMessageText(text, {
        chat_id: chatId, message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }).catch(() => {});
    });
  } else {
    await bot.editMessageText(text, {
      chat_id: chatId, message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    }).catch(() => {});
  }
}

/**
 * Tampilkan Saldo OrderKuota (Orkut)
 */
async function showOrkutBalance(bot, chatId, messageId) {
  const { getEngine } = require('../services/paymentEngine');
  const engine = getEngine();

  try {
    const res = await engine.checkBalance();
    const balance = res.balance || 0;

    const text =
      `💰 *SALDO PAYMENT GATEWAY*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📸 *OrderKuota:* ${formatCurrency(balance)}\n` +
      `🏦 *Status:* ${res.status ? 'Aktif ✅' : 'Bermasalah ❌'}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Saldo ini adalah dana yang terkumpul dari pembayaran QRIS. Anda dapat menarik dana ini ke Bank/E-Wallet.`;

    await bot.editMessageText(text, {
      chat_id: chatId, message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💸 Tarik Saldo (Withdraw)', callback_data: 'admin_orkut_withdraw' }],
          [{ text: '🔄 Cek Saldo Pakasir', callback_data: 'admin_pakasir_balance' }],
          [{ text: '🔄 Cek Saldo Midtrans', callback_data: 'admin_midtrans_balance' }],
          [{ text: '🔙 Kembali', callback_data: 'admin_main' }]
        ]
      }
    }).catch(() => {});
  } catch (err) {
    await bot.sendMessage(chatId, `❌ Gagal cek saldo Orkut: ${err.message}`);
  }
}

module.exports = {
  isAdmin,
  handleAdmin,
  sendAdminPanel,
  handleAdminCallback,
  handleAdminInput
};
