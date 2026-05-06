/**
 * adminHandler.js - Panel Kendali Admin
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config/config.json');
const { usersDB, transactionsDB, productsDB } = require('../utils/jsonDB');
const { formatCurrency, formatDate } = require('../utils/validator');
const { syncProducts } = require('../services/productSync');
const menuHandler = require('./menuHandler');

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
  const admins = Array.isArray(cfg.telegram.admin_ids) ? cfg.telegram.admin_ids : [cfg.telegram.admin_id];
  return admins.map(id => String(id)).includes(String(userId));
}

/**
 * Handle Command /admin
 */
async function handleAdmin(bot, msg) {
  const userId = String(msg.from.id);
  if (!isAdmin(userId)) return;

  await sendAdminPanel(bot, msg.chat.id);
}

/**
 * Kirim Panel Admin Utama
 */
async function sendAdminPanel(bot, chatId, messageId = null) {
  const cfg = getConfig();
  const users = usersDB.read();
  const transactions = transactionsDB.read();
  
  const totalUsers = Object.keys(users).length;
  const totalTrx   = Object.keys(transactions).length;
  const successTrx = Object.values(transactions).filter(t => t.status === 'success' || t.status === 'paid').length;
  
  const { isWAConnected } = require('../services/whatsapp');
  const waStatus = isWAConnected() ? 'Terhubung ✅' : 'Terputus ❌';

  const products = productsDB.read();
  const lastSync = products._meta?.last_sync ? new Date(products._meta.last_sync).toLocaleString('id-ID') : 'Belum pernah';

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
        { text: '🖼️ Menu Thumbs', callback_data: 'admin_menu_thumbs' }
      ],
      [
        { text: '⚙️ Bot Identity', callback_data: 'admin_bot_identity' },
        { text: '💸 Withdrawals',  callback_data: 'admin_withdrawals' }
      ],
      [
        { text: '🛡️ Kelola Admin',  callback_data: 'admin_manage_list' },
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
    await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown', reply_markup: keyboard
    });
  }
}

/**
 * Handle Admin Callback
 */
async function handleAdminCallback(bot, query) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;
  const userId = String(query.from.id);

  if (!isAdmin(userId)) return;

  if (data === 'admin_main')           { await sendAdminPanel(bot, chatId, messageId); return; }
  if (data === 'admin_close')          { await bot.deleteMessage(chatId, messageId).catch(() => {}); return; }
  
  // ── WA ───────────────────────────────────────────────────────────────────────
  if (data === 'admin_wa')             {
    const { isWAConnected, connectWhatsApp } = require('../services/whatsapp');
    if (isWAConnected()) {
      await bot.sendMessage(chatId, '✅ WhatsApp sudah terhubung.');
    } else {
      await connectWhatsApp(bot);
      await bot.sendMessage(chatId, '⏳ Memulai sesi WhatsApp, silakan cek terminal/log untuk scan QR.');
    }
    return;
  }

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

  if (data.startsWith('admin_wd_src_')) {
    const src = data.replace('admin_wd_src_', '');
    const state = menuHandler.getUserState(userId);
    menuHandler.setUserState(userId, { ...state, source: src, step: 'orkut_wd_amount' });
    await bot.sendMessage(chatId, `💸 *Withdraw via ${src.toUpperCase()}*\n\nMasukkan jumlah yang ingin ditarik:`);
    return;
  }

  if (data === 'admin_orkut_wd_confirm') { await handleOrkutWithdrawConfirm(bot, chatId, userId); return; }

  // ── Settings ─────────────────────────────────────────────────────────────────
  if (data === 'admin_settings')       { await showGeneralSettings(bot, chatId, messageId); return; }
  if (data === 'admin_apikeys')        { await showAPISettings(bot, chatId, messageId); return; }
  if (data === 'admin_orkut_settings') { await showOrkutSettings(bot, chatId, messageId); return; }
  if (data === 'admin_set_orkut_user') { await bot.answerCallbackQuery(query.id); menuHandler.setUserState(userId, { flow: 'admin', step: 'set_orkut_user', msgId: messageId }); await bot.sendMessage(chatId, '📝 Masukkan *Username Orkut*:'); return; }
  if (data === 'admin_set_orkut_token'){ await bot.answerCallbackQuery(query.id); menuHandler.setUserState(userId, { flow: 'admin', step: 'set_orkut_token', msgId: messageId }); await bot.sendMessage(chatId, '📝 Masukkan *Token Orkut*:'); return; }
  if (data === 'admin_set_orkut_key')  { await bot.answerCallbackQuery(query.id); menuHandler.setUserState(userId, { flow: 'admin', step: 'set_orkut_key', msgId: messageId }); await bot.sendMessage(chatId, '📝 Masukkan *TokenKey Orkut*:'); return; }

  // ── Bot Identity ────────────────────────────────────────────────────────────
  if (data === 'admin_bot_identity')   { await showBotIdentitySettings(bot, chatId, messageId); return; }
  if (data === 'admin_set_bot_name')    { await bot.answerCallbackQuery(query.id); menuHandler.setUserState(userId, { flow: 'admin', step: 'set_bot_name', msgId: messageId }); await bot.sendMessage(chatId, '📝 Masukkan *Nama Bot* baru:'); return; }
  if (data === 'admin_set_bot_thumb')   { await bot.answerCallbackQuery(query.id); menuHandler.setUserState(userId, { flow: 'admin', step: 'set_bot_thumb', msgId: messageId }); await bot.sendMessage(chatId, '🖼️ Masukkan *URL Thumbnail* baru (Link Gambar):'); return; }

  // ── Thumbnail Management ───────────────────────────────────────────────────
  if (data === 'admin_menu_thumbs')    { await showThumbMenuSettings(bot, chatId, messageId); return; }
  if (data === 'admin_set_game_thumb_list') { await showGameThumbList(bot, chatId, messageId); return; }
  if (data === 'admin_set_ppob_thumb_list') { await showPPOBThumbList(bot, chatId, messageId); return; }
  if (data.startsWith('admin_set_game_thumb_')) {
    const gameCode = data.replace('admin_set_game_thumb_', '');
    await bot.answerCallbackQuery(query.id);
    menuHandler.setUserState(userId, { flow: 'admin', step: 'set_game_thumb', gameCode, msgId: messageId });
    await bot.sendMessage(chatId, `🖼️ Masukkan URL Thumbnail baru untuk Game *${gameCode}*:`);
    return;
  }
  if (data.startsWith('admin_set_ppob_thumb_')) {
    const catCode = data.replace('admin_set_ppob_thumb_', '');
    await bot.answerCallbackQuery(query.id);
    menuHandler.setUserState(userId, { flow: 'admin', step: 'set_ppob_thumb', catCode, msgId: messageId });
    await bot.sendMessage(chatId, `🖼️ Masukkan URL Thumbnail baru untuk PPOB *${catCode.toUpperCase()}*:`);
    return;
  }

  // ── Admin Management ─────────────────────────────────────────────────────────
  if (data === 'admin_manage_list')     { await showAdminList(bot, chatId, messageId); return; }
  if (data === 'admin_add_new')         { await bot.answerCallbackQuery(query.id); menuHandler.setUserState(userId, { flow: 'admin', step: 'add_admin_id', msgId: messageId }); await bot.sendMessage(chatId, '📝 Masukkan *Telegram User ID* yang ingin dijadikan admin:'); return; }
  if (data.startsWith('admin_del_')) {
    const targetId = data.replace('admin_del_', '');
    await handleDeleteAdmin(bot, chatId, userId, targetId, messageId);
    return;
  }

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
  
  if (data.startsWith('admin_user_')) {
    const targetId = data.replace('admin_user_', '');
    await showUserDetails(bot, chatId, targetId, messageId);
    return;
  }

  if (data.startsWith('admin_user_action_')) {
    const parts = data.split('_');
    const action = parts[3]; // addbal, subbal, setbal, status
    const targetId = parts[4];
    await handleUserAction(bot, chatId, targetId, action, messageId);
    return;
  }
}

/**
 * Handle Admin Input (Text)
 */
async function handleAdminInput(bot, msg, state) {
  const chatId = msg.chat.id;
  const text = msg.text;
  const userId = String(msg.from.id);
  const msgId = state.msgId;

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

  if (state.step === 'set_game_thumb') {
    const c = getConfig();
    if (!c.app.thumbnails) c.app.thumbnails = { games: {}, ppob: {} };
    c.app.thumbnails.games[state.gameCode] = text;
    saveConfig(c);
    await bot.sendMessage(chatId, `✅ Thumbnail Game *${state.gameCode}* berhasil diperbarui.`);
    await showGameThumbList(bot, chatId, msgId);
    return;
  }

  if (state.step === 'set_ppob_thumb') {
    const c = getConfig();
    if (!c.app.thumbnails) c.app.thumbnails = { games: {}, ppob: {} };
    c.app.thumbnails.ppob[state.catCode] = text;
    saveConfig(c);
    await bot.sendMessage(chatId, `✅ Thumbnail PPOB *${state.catCode.toUpperCase()}* berhasil diperbarui.`);
    await showPPOBThumbList(bot, chatId, msgId);
    return;
  }

  if (state.step === 'add_admin_id') {
    const targetId = text.trim();
    if (!/^\d+$/.test(targetId)) {
      await bot.sendMessage(chatId, '❌ ID harus berupa angka.');
      return;
    }
    const c = getConfig();
    if (!c.telegram.admin_ids) c.telegram.admin_ids = [c.telegram.admin_id];
    if (c.telegram.admin_ids.includes(targetId)) {
      await bot.sendMessage(chatId, '❌ User tersebut sudah menjadi admin.');
    } else {
      c.telegram.admin_ids.push(targetId);
      saveConfig(c);
      await bot.sendMessage(chatId, `✅ Berhasil menambah admin baru: \`${targetId}\``, { parse_mode: 'Markdown' });
    }
    menuHandler.clearUserState(userId);
    await showAdminList(bot, chatId, msgId);
    return;
  }

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
    menuHandler.setUserState(userId, { ...state, accountName, step: 'orkut_wd_confirm' });
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

/**
 * Tampilkan Pengaturan API
 */
async function showAPISettings(bot, chatId, messageId) {
  const text = `🔑 *API SETTINGS*\n` +
               `━━━━━━━━━━━━━━━━━━━━━━\n` +
               `Kelola semua kredensial API provider di sini:`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '📸 OrderKuota (Orkut) Settings', callback_data: 'admin_orkut_settings' }],
      [{ text: '🔙 Kembali', callback_data: 'admin_main' }]
    ]
  };

  await bot.editMessageText(text, {
    chat_id: chatId, message_id: messageId,
    parse_mode: 'Markdown', reply_markup: keyboard
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
    `📸 *PENGATURAN ORDERKUOTA (ORKUT)*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
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
    
    const res = await engine.withdrawBalance(state.amount, state.accountNum, state.accountName, state.bankCode, source);

    if (res.status || res.success) {
      await bot.sendMessage(chatId, 
        `✅ *PENARIKAN BERHASIL!*\n\n` +
        `📂 Sumber: *${source.toUpperCase()}*\n` +
        `💰 Nominal: *${formatCurrency(state.amount)}*\n` +
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
 * Manajemen List Admin
 */
async function showAdminList(bot, chatId, messageId) {
  const cfg = getConfig();
  const admins = Array.isArray(cfg.telegram.admin_ids) ? cfg.telegram.admin_ids : [cfg.telegram.admin_id];
  
  let text = `🛡️ *MANAJEMEN ADMIN*\n` +
             `━━━━━━━━━━━━━━━━━━━━━━\n` +
             `Daftar Admin saat ini:\n\n`;
  
  const keyboard = { inline_keyboard: [] };
  
  admins.forEach((id, index) => {
    text += `${index + 1}. \`${id}\`\n`;
    if (admins.length > 1) {
      keyboard.inline_keyboard.push([{ text: `❌ Hapus Admin ${id}`, callback_data: `admin_del_${id}` }]);
    }
  });

  text += `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `Klik tombol di bawah untuk menambah admin baru.`;

  keyboard.inline_keyboard.push([{ text: '➕ Tambah Admin Baru', callback_data: 'admin_add_new' }]);
  keyboard.inline_keyboard.push([{ text: '🔙 Kembali', callback_data: 'admin_main' }]);

  await bot.editMessageText(text, {
    chat_id: chatId, message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: keyboard
  }).catch(async () => {
    await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  });
}

async function handleDeleteAdmin(bot, chatId, requesterId, targetId, messageId) {
  if (String(requesterId) === String(targetId)) {
    return bot.sendMessage(chatId, '❌ Anda tidak bisa menghapus diri sendiri dari daftar admin.');
  }

  const c = getConfig();
  const admins = Array.isArray(c.telegram.admin_ids) ? c.telegram.admin_ids : [c.telegram.admin_id];
  
  const newAdmins = admins.filter(id => String(id) !== String(targetId));
  if (newAdmins.length === admins.length) return;

  c.telegram.admin_ids = newAdmins;
  saveConfig(c);

  await bot.sendMessage(chatId, `✅ Berhasil menghapus admin \`${targetId}\`.`, { parse_mode: 'Markdown' });
  await showAdminList(bot, chatId, messageId);
}

/**
 * Menu Pengaturan Thumbnail
 */
async function showThumbMenuSettings(bot, chatId, messageId) {
  const text = `🖼️ *PENGATURAN THUMBNAIL MENU*\n` +
               `━━━━━━━━━━━━━━━━━━━━━━\n` +
               `Silakan pilih kategori menu yang ingin diubah thumbnailnya:`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '🎮 Thumbnail Game', callback_data: 'admin_set_game_thumb_list' }],
      [{ text: '⚡ Thumbnail PPOB', callback_data: 'admin_set_ppob_thumb_list' }],
      [{ text: '🔙 Kembali', callback_data: 'admin_main' }]
    ]
  };

  await bot.editMessageText(text, {
    chat_id: chatId, message_id: messageId,
    parse_mode: 'Markdown', reply_markup: keyboard
  }).catch(() => {});
}

async function showGameThumbList(bot, chatId, messageId) {
  const { GAMES } = require('./topupHandler');
  const cfg = getConfig();
  
  let text = `🎮 *SET THUMBNAIL GAME*\n` +
             `━━━━━━━━━━━━━━━━━━━━━━\n` +
             `Pilih game untuk mengubah thumbnailnya:\n\n`;

  const keyboard = { inline_keyboard: [] };
  
  for (let i = 0; i < GAMES.length; i += 2) {
    const row = [];
    const g1 = GAMES[i];
    const isCustom1 = cfg.app.thumbnails?.games?.[g1.code] ? '✅' : '';
    row.push({ text: `${g1.icon} ${g1.name} ${isCustom1}`, callback_data: `admin_set_game_thumb_${g1.code}` });
    
    if (GAMES[i+1]) {
      const g2 = GAMES[i+1];
      const isCustom2 = cfg.app.thumbnails?.games?.[g2.code] ? '✅' : '';
      row.push({ text: `${g2.icon} ${g2.name} ${isCustom2}`, callback_data: `admin_set_game_thumb_${g2.code}` });
    }
    keyboard.inline_keyboard.push(row);
  }

  keyboard.inline_keyboard.push([{ text: '🔙 Kembali', callback_data: 'admin_menu_thumbs' }]);

  await bot.editMessageText(text, {
    chat_id: chatId, message_id: messageId,
    parse_mode: 'Markdown', reply_markup: keyboard
  }).catch(() => {});
}

async function showPPOBThumbList(bot, chatId, messageId) {
  const { PPOB_CATEGORIES } = require('./ppobHandler');
  const cfg = getConfig();
  
  let text = `⚡ *SET THUMBNAIL PPOB*\n` +
             `━━━━━━━━━━━━━━━━━━━━━━\n` +
             `Pilih kategori PPOB untuk mengubah thumbnailnya:\n\n`;

  const keyboard = { inline_keyboard: [] };
  
  for (let i = 0; i < PPOB_CATEGORIES.length; i += 2) {
    const row = [];
    const c1 = PPOB_CATEGORIES[i];
    const isCustom1 = cfg.app.thumbnails?.ppob?.[c1.code] ? '✅' : '';
    row.push({ text: `${c1.icon} ${c1.name} ${isCustom1}`, callback_data: `admin_set_ppob_thumb_${c1.code}` });
    
    if (PPOB_CATEGORIES[i+1]) {
      const c2 = PPOB_CATEGORIES[i+1];
      const isCustom2 = cfg.app.thumbnails?.ppob?.[c2.code] ? '✅' : '';
      row.push({ text: `${c2.icon} ${c2.name} ${isCustom2}`, callback_data: `admin_set_ppob_thumb_${c2.code}` });
    }
    keyboard.inline_keyboard.push(row);
  }

  keyboard.inline_keyboard.push([{ text: '🔙 Kembali', callback_data: 'admin_menu_thumbs' }]);

  await bot.editMessageText(text, {
    chat_id: chatId, message_id: messageId,
    parse_mode: 'Markdown', reply_markup: keyboard
  }).catch(() => {});
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

async function showPakasirBalance(bot, chatId, messageId) {
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

async function showMidtransBalance(bot, chatId, messageId) {
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

  await showWithdrawRequests(bot, chatId, null);
}

// ─── User Management & Stats ───────────────────────────────────────────────────

async function showStats(bot, chatId, messageId) {
  const transactions = transactionsDB.read();
  const txList = Object.values(transactions);
  
  const total = txList.length;
  const success = txList.filter(t => t.status === 'success' || t.status === 'paid').length;
  const pending = txList.filter(t => t.status === 'pending').length;
  const failed = txList.filter(t => t.status === 'failed' || t.status === 'canceled').length;
  
  const income = txList
    .filter(t => (t.status === 'success' || t.status === 'paid') && t.type !== 'withdraw')
    .reduce((acc, t) => acc + (t.amount || 0), 0);

  const text = 
    `📊 *STATISTIK BOT*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ Sukses: *${success}*\n` +
    `⏳ Pending: *${pending}*\n` +
    `❌ Gagal: *${failed}*\n` +
    `📝 Total: *${total}*\n\n` +
    `💰 Total Omset: *${formatCurrency(income)}*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━`;

  await bot.editMessageText(text, {
    chat_id: chatId, message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'admin_main' }]] }
  }).catch(() => {});
}

async function showUserList(bot, chatId, page = 0, messageId = null) {
  const users = usersDB.read();
  const userIds = Object.keys(users);
  const perPage = 10;
  const totalPages = Math.ceil(userIds.length / perPage);
  
  const start = page * perPage;
  const end = start + perPage;
  const pageUsers = userIds.slice(start, end);

  let text = `👥 *DAFTAR USER (${userIds.length})*\n` +
             `Halaman ${page + 1} dari ${totalPages}\n\n`;

  const keyboard = { inline_keyboard: [] };

  pageUsers.forEach(uid => {
    const u = users[uid];
    text += `👤 ${u.name || 'No Name'} (\`${uid}\`)\n` +
            `💰 Bal: ${formatCurrency(u.balance || 0)} | ${u.isReseller ? '🏪' : '👤'}\n\n`;
    keyboard.inline_keyboard.push([{ text: `Manage ${u.name || uid}`, callback_data: `admin_user_${uid}` }]);
  });

  const navRow = [];
  if (page > 0) navRow.push({ text: '⬅️ Prev', callback_data: `admin_users_page_${page - 1}` });
  if (page < totalPages - 1) navRow.push({ text: 'Next ➡️', callback_data: `admin_users_page_${page + 1}` });
  if (navRow.length > 0) keyboard.inline_keyboard.push(navRow);

  keyboard.inline_keyboard.push([{ text: '🔙 Kembali', callback_data: 'admin_main' }]);

  if (messageId) {
    await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => {});
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

async function showUserDetails(bot, chatId, targetId, messageId) {
  const u = usersDB.get(targetId);
  if (!u) return;

  const text = `👤 *DETAIL USER*\n` +
               `━━━━━━━━━━━━━━━━━━━━━━\n` +
               `Nama: *${u.name}*\n` +
               `ID: \`${targetId}\`\n` +
               `HP: \`${u.phone || '-'}\`\n` +
               `Saldo: *${formatCurrency(u.balance || 0)}*\n` +
               `Status: *${u.isReseller ? 'Reseller 🏪' : 'Member 👤'}*\n` +
               `Join: ${formatDate(u.createdAt)}\n` +
               `━━━━━━━━━━━━━━━━━━━━━━`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '➕ Tambah Saldo', callback_data: `admin_user_action_addbal_${targetId}` },
        { text: '➖ Kurang Saldo', callback_data: `admin_user_action_subbal_${targetId}` }
      ],
      [
        { text: '💰 Set Saldo', callback_data: `admin_user_action_setbal_${targetId}` },
        { text: '🔄 Ganti Status', callback_data: `admin_user_action_status_${targetId}` }
      ],
      [{ text: '🔙 Kembali', callback_data: 'admin_users' }]
    ]
  };

  await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => {});
}

async function handleUserAction(bot, chatId, targetId, action, messageId) {
  const u = usersDB.get(targetId);
  if (!u) return;

  if (action === 'status') {
    const newStatus = !u.isReseller;
    usersDB.update(targetId, { isReseller: newStatus });
    await bot.sendMessage(chatId, `✅ Status user *${u.name}* diubah menjadi *${newStatus ? 'Reseller' : 'Member'}*`);
    await showUserDetails(bot, chatId, targetId, messageId);
  } else {
    const label = action === 'addbal' ? 'menambah' : (action === 'subbal' ? 'mengurangi' : 'mengatur');
    menuHandler.setUserState(String(chatId), { flow: 'admin', step: `input_bal_${action}`, targetId, msgId: messageId });
    await bot.sendMessage(chatId, `📝 Masukkan nominal untuk *${label}* saldo *${u.name}*:`);
  }
}

async function showGeneralSettings(bot, chatId, messageId) {
  const cfg = getConfig();
  const text = `⚙️ *GENERAL SETTINGS*\n` +
               `━━━━━━━━━━━━━━━━━━━━━━\n` +
               `Markup User: *${cfg.markup.markup_user}%*\n` +
               `Markup Reseller: *${cfg.markup.markup_reseller}%*\n` +
               `Min Withdraw: *${formatCurrency(cfg.withdraw.min_amount)}*\n` +
               `━━━━━━━━━━━━━━━━━━━━━━`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '🔙 Kembali', callback_data: 'admin_main' }]
    ]
  };

  await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => {});
}

module.exports = {
  isAdmin,
  handleAdmin,
  sendAdminPanel,
  handleAdminCallback,
  handleAdminInput,
  showAdminList,
  handleDeleteAdmin,
  showThumbMenuSettings,
  showGameThumbList,
  showPPOBThumbList
};
