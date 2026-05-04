/**
 * telegram.js - Telegram Bot utama
 * Semua callback_data dan message handler terpusat di sini
 */

const TelegramBot = require('node-telegram-bot-api');
const config = require('../config/config.json');
const logger = require('../utils/logger');
const { usersDB } = require('../utils/jsonDB');
const { rateLimit } = require('../utils/validator');

// ─── Handlers ──────────────────────────────────────────────────────────────────
const menuHandler       = require('../handlers/menuHandler');
const topupHandler      = require('../handlers/topupHandler');
const ppobHandler       = require('../handlers/ppobHandler');
const depositHandler    = require('../handlers/depositHandler');
const resellerHandler   = require('../handlers/resellerHandler');
const transactionHandler = require('../handlers/transactionHandler');

let botInstance = null;

// ─── Init Bot ──────────────────────────────────────────────────────────────────

function initBot() {
  const bot = new TelegramBot(config.telegram.token, { polling: true });
  botInstance = bot;

  logger.info('Telegram', '✅ Bot Telegram aktif (polling)');

  // ─── /start ──────────────────────────────────────────────────────────────────
  bot.onText(/\/start/, async (msg) => {
    await safeHandle('start', msg.from.id, async () => {
      await menuHandler.handleStart(bot, msg);
    });
  });

  // ─── /menu ───────────────────────────────────────────────────────────────────
  bot.onText(/\/menu/, async (msg) => {
    const userId = String(msg.from.id);
    const user = usersDB.get(userId);
    if (user) await menuHandler.sendMainMenu(bot, msg.chat.id, user);
    else await menuHandler.handleStart(bot, msg);
  });

  // ─── /saldo ──────────────────────────────────────────────────────────────────
  bot.onText(/\/saldo/, async (msg) => {
    const userId = String(msg.from.id);
    const user = usersDB.get(userId);
    if (!user) { await bot.sendMessage(msg.chat.id, 'Ketik /start untuk daftar.'); return; }
    const { formatCurrency } = require('../utils/validator');
    await bot.sendMessage(msg.chat.id,
      `💰 Saldo Anda: *${formatCurrency(user.balance || 0)}*`,
      { parse_mode: 'Markdown' }
    );
  });

  // ─── Text Messages ────────────────────────────────────────────────────────────
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const userId = String(msg.from.id);

    // Rate limit
    const rl = rateLimit(userId, 'message', 20, 60000);
    if (!rl.allowed) {
      await bot.sendMessage(msg.chat.id, `⏳ Terlalu banyak pesan. Tunggu ${rl.retryAfter} detik.`);
      return;
    }

    const state = menuHandler.getUserState(userId);
    if (!state) return;

    await safeHandle('message', userId, async () => {
      // Registrasi
      if (state.flow === 'register') {
        await menuHandler.handleRegistration(bot, msg, state);
        return;
      }

      // Topup input
      if (state.flow === 'topup' && (state.step === 'topup_userid' || state.step === 'topup_server')) {
        await topupHandler.handleTopupInput(bot, msg, state);
        return;
      }

      // PPOB input target
      if (state.flow === 'ppob' && state.step === 'ppob_input_target') {
        await ppobHandler.handleTargetInput(bot, msg, state);
        return;
      }

      // Deposit custom amount
      if (state.flow === 'deposit' && state.step === 'deposit_custom_amount') {
        await depositHandler.handleCustomAmountInput(bot, msg, state);
        return;
      }
    });
  });

  // ─── Callback Query ───────────────────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const userId = String(query.from.id);
    const chatId = query.message.chat.id;
    const data   = query.data;

    // Selalu answer callback agar loading hilang
    await bot.answerCallbackQuery(query.id).catch(() => {});

    // Rate limit
    const rl = rateLimit(userId, 'callback', 15, 60000);
    if (!rl.allowed) {
      await bot.sendMessage(chatId, `⏳ Terlalu cepat. Tunggu ${rl.retryAfter} detik.`);
      return;
    }

    // Cek registrasi (kecuali back_main)
    const user = usersDB.get(userId);
    if (!user && data !== 'back_main') {
      await bot.sendMessage(chatId, '❌ Silakan ketik /start untuk mendaftar.');
      return;
    }

    await safeHandle('callback', userId, async () => {
      await routeCallback(bot, chatId, userId, data, query);
    });
  });

  // ─── Error Handler ────────────────────────────────────────────────────────────
  bot.on('polling_error', (err) => {
    logger.error('Telegram', 'Polling error', { msg: err.message });
  });

  bot.on('error', (err) => {
    logger.error('Telegram', 'Bot error', { msg: err.message });
  });

  return bot;
}

// ─── Route Callback ────────────────────────────────────────────────────────────

async function routeCallback(bot, chatId, userId, data, query) {

  // ── Back / Menu Navigasi ────────────────────────────────────────────────────
  if (data === 'back_main') {
    menuHandler.clearUserState(userId);
    const user = usersDB.get(userId);
    if (user) await menuHandler.sendMainMenu(bot, chatId, user);
    return;
  }

  // ── Menu Utama ──────────────────────────────────────────────────────────────
  if (data === 'menu_topup')        { await topupHandler.showGameList(bot, chatId); return; }
  if (data === 'menu_ppob')         { await ppobHandler.showPPOBMenu(bot, chatId); return; }
  if (data === 'menu_deposit')      { await depositHandler.showDepositMenu(bot, chatId, userId); return; }
  if (data === 'menu_transactions') { await transactionHandler.showTransactions(bot, chatId, userId); return; }
  if (data === 'menu_profile')      { await menuHandler.handleProfile(bot, chatId, userId); return; }
  if (data === 'menu_reseller')     { await resellerHandler.showResellerInfo(bot, chatId, userId); return; }
  if (data === 'menu_help')         { await menuHandler.handleHelp(bot, chatId); return; }

  // ── Topup Game ──────────────────────────────────────────────────────────────
  if (data.startsWith('game_')) {
    const gameCode = data.replace('game_', '');
    await topupHandler.showGameProducts(bot, chatId, userId, gameCode);
    return;
  }

  if (data.startsWith('product_')) {
    const productCode = data.replace('product_', '');
    await topupHandler.handleProductSelect(bot, chatId, userId, productCode);
    return;
  }

  if (data === 'pay_balance')   { await topupHandler.processTopupPayment(bot, chatId, userId, 'balance'); return; }
  if (data === 'pay_midtrans')  { await topupHandler.processTopupPayment(bot, chatId, userId, 'midtrans'); return; }
  if (data === 'pay_pakasir')   { await topupHandler.processTopupPayment(bot, chatId, userId, 'pakasir'); return; }

  // ── PPOB ────────────────────────────────────────────────────────────────────
  if (data.startsWith('ppob_cat_')) {
    const catCode = data.replace('ppob_cat_', '');
    await ppobHandler.handleCategorySelect(bot, chatId, userId, catCode);
    return;
  }

  if (data.startsWith('ppob_prod_')) {
    const productCode = data.replace('ppob_prod_', '');
    await ppobHandler.handleProductSelect(bot, chatId, userId, productCode);
    return;
  }

  if (data === 'ppob_pay_balance')  { await ppobHandler.processPPOBPayment(bot, chatId, userId, 'balance'); return; }
  if (data === 'ppob_pay_midtrans') { await ppobHandler.processPPOBPayment(bot, chatId, userId, 'midtrans'); return; }
  if (data === 'ppob_pay_pakasir')  { await ppobHandler.processPPOBPayment(bot, chatId, userId, 'pakasir'); return; }

  // ── Deposit ─────────────────────────────────────────────────────────────────
  if (data === 'deposit_midtrans') { await depositHandler.showDepositAmounts(bot, chatId, userId, 'midtrans'); return; }
  if (data === 'deposit_pakasir')  { await depositHandler.showDepositAmounts(bot, chatId, userId, 'pakasir'); return; }

  if (data.startsWith('dep_amount_')) {
    // dep_amount_midtrans_50000
    const parts = data.split('_');
    const method = parts[2];
    const amount = parseInt(parts[3]);
    await depositHandler.processDeposit(bot, chatId, userId, method, amount);
    return;
  }

  if (data.startsWith('dep_custom_')) {
    const method = data.replace('dep_custom_', '');
    await depositHandler.handleCustomAmount(bot, chatId, userId, method);
    return;
  }

  // ── Reseller ────────────────────────────────────────────────────────────────
  if (data === 'reseller_pay_balance')  { await resellerHandler.processResellerUpgrade(bot, chatId, userId, 'balance'); return; }
  if (data === 'reseller_pay_midtrans') { await resellerHandler.processResellerUpgrade(bot, chatId, userId, 'midtrans'); return; }
  if (data === 'reseller_pay_pakasir')  { await resellerHandler.processResellerUpgrade(bot, chatId, userId, 'pakasir'); return; }

  // ── Transaksi Pagination ────────────────────────────────────────────────────
  if (data.startsWith('trx_page_')) {
    const page = parseInt(data.replace('trx_page_', ''));
    await transactionHandler.showTransactions(bot, chatId, userId, page);
    return;
  }

  // ── Unknown ─────────────────────────────────────────────────────────────────
  logger.warn('Telegram', 'Callback tidak dikenali', { data, userId });
}

// ─── Safe Handle (anti crash) ──────────────────────────────────────────────────

async function safeHandle(context, userId, fn) {
  try {
    await fn();
  } catch (err) {
    logger.error('Telegram', `Error di ${context}`, { userId, msg: err.message, stack: err.stack });
  }
}

// ─── Getter ────────────────────────────────────────────────────────────────────

function getBot() {
  return botInstance;
}

module.exports = { initBot, getBot };
