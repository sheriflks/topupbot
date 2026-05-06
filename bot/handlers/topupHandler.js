/**
 * topupHandler.js - Handler Topup Game lengkap
 * Mendukung semua game, server ID, markup, komisi reseller
 */

const { usersDB, transactionsDB } = require('../utils/jsonDB');
const { generateOrderId, formatCurrency, chunkArray } = require('../utils/validator');
const { setUserState, clearUserState, getUserState } = require('./menuHandler');
const { getGameProducts, getProductByCode } = require('../services/productSync');
const vipReseller = require('../services/vipReseller');
const apiGames = require('../services/apiGames');
const { sendNotification, sendAdminAlert } = require('../services/whatsapp');
const logger = require('../utils/logger');
const config = require('../config/config.json');

// ─── Daftar Game (fallback jika API belum sync) ────────────────────────────────

const GAMES = [
  { name: '🔥 Free Fire',        code: 'FF',   needServer: false, icon: '🔥' },
  { name: '⚔️ Mobile Legends',   code: 'ML',   needServer: true,  icon: '⚔️' },
  { name: '🎯 PUBG Mobile',      code: 'PUBG', needServer: false, icon: '🎯' },
  { name: '🌟 Genshin Impact',   code: 'GI',   needServer: false, icon: '🌟' },
  { name: '🎮 Valorant',         code: 'VL',   needServer: false, icon: '🎮' },
  { name: '💥 Call of Duty',     code: 'CODM', needServer: false, icon: '💥' },
  { name: '🏆 Arena of Valor',   code: 'AOV',  needServer: false, icon: '🏆' },
  { name: '⚡ Honkai Star Rail', code: 'HSR',  needServer: false, icon: '⚡' },
  { name: '🗡️ Clash of Clans',  code: 'COC',  needServer: false, icon: '🗡️' },
  { name: '👑 Clash Royale',     code: 'CR',   needServer: false, icon: '👑' }
];

// ─── Markup — baca config fresh setiap call ────────────────────────────────────
function applyMarkup(price, isReseller) {
  const fs   = require('fs');
  const path = require('path');
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/config.json'), 'utf8')); }
  catch { cfg = config; }
  const pct = isReseller ? (cfg.markup.markup_reseller || 0) : (cfg.markup.markup_user || 0);
  if (pct === 0) return parseInt(price); // harga real, tanpa markup
  return Math.ceil(price * (1 + pct / 100));
}

// ─── Tampilkan Daftar Game ─────────────────────────────────────────────────────

async function showGameList(bot, chatId) {
  const rows = chunkArray(GAMES, 2).map(pair =>
    pair.map(g => ({ text: g.name, callback_data: `game_${g.code}` }))
  );
  rows.push([{ text: '🔙 Kembali', callback_data: 'back_main' }]);

  await bot.sendMessage(chatId,
    `🎮 *TOPUP GAME*\n\nPilih game:`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } }
  );
}

// ─── Tampilkan Produk Game ─────────────────────────────────────────────────────

async function showGameProducts(bot, chatId, userId, gameCode) {
  const game = GAMES.find(g => g.code === gameCode);
  if (!game) return;

  const user = usersDB.get(userId);
  const isReseller = user?.isReseller || false;

  // Ambil dari DB (sudah sync dari API)
  let products = getGameProducts(gameCode);

  // Fallback ke produk default jika belum sync
  if (products.length === 0) {
    products = getDefaultProducts(gameCode);
  }

  if (products.length === 0) {
    await bot.sendMessage(chatId,
      `⚠️ Produk *${game.name}* belum tersedia.\nCoba lagi nanti.`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'menu_topup' }]] }
      }
    );
    return;
  }

  const rows = chunkArray(products.slice(0, 30), 2).map(pair =>
    pair.map(p => {
      const price = applyMarkup(p.price, isReseller);
      return { text: `${p.name} - ${formatCurrency(price)}`, callback_data: `product_${p.code}` };
    })
  );
  rows.push([{ text: '🔙 Kembali', callback_data: 'menu_topup' }]);

  await bot.sendMessage(chatId,
    `${game.icon} *${game.name}*\n\n` +
    `${isReseller ? '🏪 Harga Reseller' : '👤 Harga Member'}\n\n` +
    `Pilih nominal:`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } }
  );
}

// ─── Pilih Produk ──────────────────────────────────────────────────────────────

async function handleProductSelect(bot, chatId, userId, productCode) {
  const user = usersDB.get(userId);
  if (!user) return;

  // Cari produk dari DB atau default
  let product = getProductByCode(productCode);
  if (!product) {
    for (const g of GAMES) {
      product = getDefaultProducts(g.code).find(p => p.code === productCode);
      if (product) break;
    }
  }

  if (!product) {
    await bot.sendMessage(chatId, '❌ Produk tidak ditemukan.');
    return;
  }

  const game = GAMES.find(g =>
    product.gameCode === g.code ||
    product.game?.toLowerCase().includes(g.code.toLowerCase()) ||
    product.code?.toUpperCase().startsWith(g.code)
  );

  const needServer = product.needServer || game?.needServer || false;
  const finalPrice = applyMarkup(product.price, user.isReseller);

  setUserState(userId, {
    flow: 'topup',
    step: 'topup_userid',
    product,
    finalPrice,
    needServer,
    game
  });

  await bot.sendMessage(chatId,
    `${game?.icon || '🎮'} *${product.name}*\n` +
    `💰 Harga: *${formatCurrency(finalPrice)}*\n\n` +
    `📝 Masukkan *User ID* akun game Anda:`,
    { parse_mode: 'Markdown' }
  );
}

// ─── Handle Input User ID / Server ────────────────────────────────────────────

async function handleTopupInput(bot, msg, state) {
  const userId = String(msg.from.id);
  const text = msg.text?.trim();
  if (!text) return;

  if (state.step === 'topup_userid') {
    const newState = { ...state, gameUserId: text };

    if (state.needServer) {
      setUserState(userId, { ...newState, step: 'topup_server' });
      await bot.sendMessage(msg.chat.id,
        `✅ User ID: \`${text}\`\n\n📝 Masukkan *Server ID* (contoh: 1234):`,
        { parse_mode: 'Markdown' }
      );
    } else {
      setUserState(userId, { ...newState, step: 'topup_confirm' });
      await showTopupConfirmation(bot, msg.chat.id, userId, newState);
    }

  } else if (state.step === 'topup_server') {
    const newState = { ...state, server: text, step: 'topup_confirm' };
    setUserState(userId, newState);
    await showTopupConfirmation(bot, msg.chat.id, userId, newState);
  }
}

// ─── Konfirmasi Topup ──────────────────────────────────────────────────────────

async function showTopupConfirmation(bot, chatId, userId, state) {
  const user = usersDB.get(userId);
  const { product, finalPrice, gameUserId, server, game } = state;

  await bot.sendMessage(chatId,
    `📋 *KONFIRMASI TOPUP*\n\n` +
    `${game?.icon || '🎮'} Produk: *${product.name}*\n` +
    `🎯 User ID: \`${gameUserId}\`\n` +
    `${server ? `🖥️ Server: \`${server}\`\n` : ''}` +
    `💰 Harga: *${formatCurrency(finalPrice)}*\n` +
    `💳 Saldo Anda: *${formatCurrency(user?.balance || 0)}*\n\n` +
    `Pilih metode pembayaran:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: `💰 Bayar Saldo (${formatCurrency(user?.balance || 0)})`, callback_data: 'pay_balance' }],
          [{ text: '💳 Midtrans (Transfer/QRIS/dll)', callback_data: 'pay_midtrans' }],
          [{ text: '🏦 Pakasir', callback_data: 'pay_pakasir' }],
          [{ text: '❌ Batal', callback_data: 'back_main' }]
        ]
      }
    }
  );
}

// ─── Proses Pembayaran ─────────────────────────────────────────────────────────

async function processTopupPayment(bot, chatId, userId, paymentMethod) {
  const state = getUserState(userId);
  if (!state || !state.product) {
    await bot.sendMessage(chatId, '❌ Sesi habis. Silakan mulai ulang.');
    return;
  }

  const user = usersDB.get(userId);
  const orderId = generateOrderId('TOP');
  const { product, finalPrice, gameUserId, server, game } = state;

  clearUserState(userId);

  if (paymentMethod === 'balance') {
    if ((user?.balance || 0) < finalPrice) {
      await bot.sendMessage(chatId,
        `❌ *Saldo tidak cukup!*\n\n` +
        `Saldo: ${formatCurrency(user?.balance || 0)}\n` +
        `Dibutuhkan: ${formatCurrency(finalPrice)}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '💰 Deposit Sekarang', callback_data: 'menu_deposit' }],
              [{ text: '🔙 Kembali', callback_data: 'back_main' }]
            ]
          }
        }
      );
      return;
    }

    usersDB.update(userId, {
      balance: user.balance - finalPrice,
      totalTransactions: (user.totalTransactions || 0) + 1
    });

    transactionsDB.set(orderId, {
      id: orderId, userId, type: 'topup',
      product: { code: product.code, name: product.name },
      gameUserId, server: server || '',
      amount: finalPrice, paymentMethod: 'balance',
      status: 'processing', createdAt: new Date().toISOString()
    });

    await bot.sendMessage(chatId,
      `⏳ *Memproses Topup...*\n\nOrder: \`${orderId}\`\nMohon tunggu...`,
      { parse_mode: 'Markdown' }
    );

    await executeTopupOrder(bot, chatId, userId, orderId, state);

  } else if (paymentMethod === 'midtrans') {
    const midtrans = require('../services/midtrans');
    try {
      const result = await midtrans.createSnapTransaction({
        orderId, amount: finalPrice,
        customerName: user.name, customerPhone: user.phone,
        itemDetails: [{ id: product.code, price: finalPrice, quantity: 1, name: product.name }]
      });

      transactionsDB.set(orderId, {
        id: orderId, userId, type: 'topup',
        product: { code: product.code, name: product.name },
        gameUserId, server: server || '',
        amount: finalPrice, paymentMethod: 'midtrans',
        paymentUrl: result.redirect_url, paymentToken: result.token,
        status: 'pending', createdAt: new Date().toISOString()
      });

      await bot.sendMessage(chatId,
        `💳 *Pembayaran Midtrans*\n\n` +
        `${game?.icon || '🎮'} ${product.name}\n` +
        `💰 Total: *${formatCurrency(finalPrice)}*\n\n` +
        `Selesaikan pembayaran:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '💳 Bayar Sekarang', url: result.redirect_url }],
              [{ text: '🏠 Menu Utama', callback_data: 'back_main' }]
            ]
          }
        }
      );
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Gagal buat pembayaran: ${err.message}`);
    }

  } else if (paymentMethod === 'pakasir') {
    const pakasir = require('../services/pakasir');
    try {
      const paymentUrl = pakasir.generatePaymentUrl(orderId, finalPrice);

      transactionsDB.set(orderId, {
        id: orderId, userId, type: 'topup',
        product: { code: product.code, name: product.name },
        gameUserId, server: server || '',
        amount: finalPrice, paymentMethod: 'pakasir',
        paymentUrl,
        status: 'pending', createdAt: new Date().toISOString()
      });

      await bot.sendMessage(chatId,
        `🏦 *Pembayaran Pakasir*\n\n` +
        `${game?.icon || '🎮'} ${product.name}\n` +
        `💰 Total: *${formatCurrency(finalPrice)}*\n\n` +
        `Selesaikan pembayaran:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🏦 Bayar Sekarang', url: paymentUrl }],
              [{ text: '🏠 Menu Utama', callback_data: 'back_main' }]
            ]
          }
        }
      );
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Gagal buat pembayaran: ${err.message}`);
    }
  }
}

// ─── Eksekusi Order ke API ─────────────────────────────────────────────────────

async function executeTopupOrder(bot, chatId, userId, orderId, state) {
  const { product, finalPrice, gameUserId, server, game } = state;

  try {
    let result;
    try {
      result = await vipReseller.createOrder({
        orderId,
        productCode: product.originalCode || product.code,
        target: gameUserId,
        server: server || ''
      });
    } catch {
      result = await apiGames.createOrder({
        orderId,
        productCode: product.originalCode || product.code,
        target: gameUserId,
        server: server || ''
      });
    }

    // APIGames v2: response awal selalu Pending (status === 1)
    // status === 0 = error langsung (signature salah, produk tidak ada)
    const accepted = result?.status === 1;
    const directFail = result?.status === 0;

    if (accepted) {
      const trxId = result?.data?.trx_id || '-';
      const sn    = result?.data?.sn || '';

      // Simpan trx_id APIGames untuk cek status nanti
      transactionsDB.update(orderId, {
        status: 'pending',
        apiTrxId: trxId,
        apiResponse: result,
        processedAt: new Date().toISOString()
      });

      await bot.sendMessage(chatId,
        `⏳ *Topup Diproses!*\n\n` +
        `${game?.icon || '🎮'} Produk: *${product.name}*\n` +
        `🎯 User ID: \`${gameUserId}\`\n` +
        `${server ? `🖥️ Server: \`${server}\`\n` : ''}` +
        `Order ID: \`${orderId}\`\n` +
        `Status: ⏳ Pending\n\n` +
        `Anda akan mendapat notifikasi saat transaksi selesai.`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'back_main' }]] }
        }
      );

      const user = usersDB.get(userId);
      if (user?.phone) {
        await sendNotification(user.phone,
          `⏳ Topup diproses\n${game?.icon || '🎮'} ${product.name}\nUser ID: ${gameUserId}\nOrder: ${orderId}`
        );
      }

      await processCommission(userId, finalPrice);

    } else {
      // status === 0 → error langsung
      const user = usersDB.get(userId);
      usersDB.update(userId, {
        balance: (user?.balance || 0) + finalPrice,
        totalTransactions: Math.max(0, (user?.totalTransactions || 1) - 1)
      });

      transactionsDB.update(orderId, {
        status: 'failed',
        apiResponse: result,
        processedAt: new Date().toISOString()
      });

      await bot.sendMessage(chatId,
        `❌ *TOPUP GAGAL*\n\nOrder: \`${orderId}\`\nSaldo dikembalikan.\n\n` +
        `Pesan: ${result?.error_msg || result?.message || 'Transaksi ditolak'}`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'back_main' }]] }
        }
      );

      await sendAdminAlert(`❌ TOPUP DITOLAK\nOrder: ${orderId}\nUser: ${userId}\nProduk: ${product.name}\nError: ${result?.error_msg || '-'}`);
    }
  } catch (err) {
    logger.error('TopupHandler', 'executeTopupOrder error', { msg: err.message, orderId });
    const user = usersDB.get(userId);
    usersDB.update(userId, { balance: (user?.balance || 0) + finalPrice });
    transactionsDB.update(orderId, { status: 'failed', error: err.message });
    await bot.sendMessage(chatId,
      `❌ *Kesalahan sistem*\n\nSaldo dikembalikan. Hubungi admin jika masalah berlanjut.`,
      { parse_mode: 'Markdown' }
    );
  }
}

// ─── Komisi Reseller ───────────────────────────────────────────────────────────

async function processCommission(userId, amount) {
  if (!config.commission?.enabled) return;
  const user = usersDB.get(userId);
  if (!user?.isReseller) return;

  const rate = config.commission.rate_reseller || 0;
  if (rate <= 0) return;

  const commission = Math.floor(amount * rate / 100);
  if (commission <= 0) return;

  usersDB.update(userId, {
    totalCommission: (user.totalCommission || 0) + commission,
    balance: (user.balance || 0) + commission
  });

  logger.info('TopupHandler', `Komisi reseller: ${userId} +${commission}`);
}

// ─── Default Products (Fallback) ───────────────────────────────────────────────

function getDefaultProducts(gameCode) {
  const defaults = {
    FF: [
      { code: 'FF_70',   name: '70 Diamond FF',   price: 15000,  category: 'game', game: 'Free Fire', gameCode: 'FF', status: 'active', needServer: false },
      { code: 'FF_140',  name: '140 Diamond FF',  price: 29000,  category: 'game', game: 'Free Fire', gameCode: 'FF', status: 'active', needServer: false },
      { code: 'FF_355',  name: '355 Diamond FF',  price: 70000,  category: 'game', game: 'Free Fire', gameCode: 'FF', status: 'active', needServer: false },
      { code: 'FF_720',  name: '720 Diamond FF',  price: 135000, category: 'game', game: 'Free Fire', gameCode: 'FF', status: 'active', needServer: false },
      { code: 'FF_1450', name: '1450 Diamond FF', price: 265000, category: 'game', game: 'Free Fire', gameCode: 'FF', status: 'active', needServer: false },
      { code: 'FF_2180', name: '2180 Diamond FF', price: 395000, category: 'game', game: 'Free Fire', gameCode: 'FF', status: 'active', needServer: false }
    ],
    ML: [
      { code: 'ML_86',   name: '86 Diamond',   price: 19000,  category: 'game', game: 'Mobile Legends', gameCode: 'ML', status: 'active', needServer: true },
      { code: 'ML_172',  name: '172 Diamond',  price: 37000,  category: 'game', game: 'Mobile Legends', gameCode: 'ML', status: 'active', needServer: true },
      { code: 'ML_257',  name: '257 Diamond',  price: 55000,  category: 'game', game: 'Mobile Legends', gameCode: 'ML', status: 'active', needServer: true },
      { code: 'ML_514',  name: '514 Diamond',  price: 108000, category: 'game', game: 'Mobile Legends', gameCode: 'ML', status: 'active', needServer: true },
      { code: 'ML_1070', name: '1070 Diamond', price: 215000, category: 'game', game: 'Mobile Legends', gameCode: 'ML', status: 'active', needServer: true },
      { code: 'ML_2195', name: '2195 Diamond', price: 430000, category: 'game', game: 'Mobile Legends', gameCode: 'ML', status: 'active', needServer: true }
    ],
    PUBG: [
      { code: 'PUBG_60',   name: '60 UC',   price: 14000,  category: 'game', game: 'PUBG Mobile', gameCode: 'PUBG', status: 'active', needServer: false },
      { code: 'PUBG_325',  name: '325 UC',  price: 72000,  category: 'game', game: 'PUBG Mobile', gameCode: 'PUBG', status: 'active', needServer: false },
      { code: 'PUBG_660',  name: '660 UC',  price: 140000, category: 'game', game: 'PUBG Mobile', gameCode: 'PUBG', status: 'active', needServer: false },
      { code: 'PUBG_1800', name: '1800 UC', price: 370000, category: 'game', game: 'PUBG Mobile', gameCode: 'PUBG', status: 'active', needServer: false }
    ],
    GI: [
      { code: 'GI_60',   name: '60 Genesis Crystal',   price: 15000,  category: 'game', game: 'Genshin Impact', gameCode: 'GI', status: 'active', needServer: false },
      { code: 'GI_300',  name: '300 Genesis Crystal',  price: 75000,  category: 'game', game: 'Genshin Impact', gameCode: 'GI', status: 'active', needServer: false },
      { code: 'GI_980',  name: '980 Genesis Crystal',  price: 240000, category: 'game', game: 'Genshin Impact', gameCode: 'GI', status: 'active', needServer: false },
      { code: 'GI_1980', name: '1980 Genesis Crystal', price: 480000, category: 'game', game: 'Genshin Impact', gameCode: 'GI', status: 'active', needServer: false }
    ],
    VL: [
      { code: 'VL_420',  name: '420 VP',  price: 55000,  category: 'game', game: 'Valorant', gameCode: 'VL', status: 'active', needServer: false },
      { code: 'VL_1000', name: '1000 VP', price: 130000, category: 'game', game: 'Valorant', gameCode: 'VL', status: 'active', needServer: false },
      { code: 'VL_2050', name: '2050 VP', price: 260000, category: 'game', game: 'Valorant', gameCode: 'VL', status: 'active', needServer: false }
    ],
    CODM: [
      { code: 'CODM_80',   name: '80 CP',   price: 15000,  category: 'game', game: 'Call of Duty Mobile', gameCode: 'CODM', status: 'active', needServer: false },
      { code: 'CODM_400',  name: '400 CP',  price: 70000,  category: 'game', game: 'Call of Duty Mobile', gameCode: 'CODM', status: 'active', needServer: false },
      { code: 'CODM_800',  name: '800 CP',  price: 135000, category: 'game', game: 'Call of Duty Mobile', gameCode: 'CODM', status: 'active', needServer: false },
      { code: 'CODM_2000', name: '2000 CP', price: 330000, category: 'game', game: 'Call of Duty Mobile', gameCode: 'CODM', status: 'active', needServer: false }
    ],
    HSR: [
      { code: 'HSR_60',   name: '60 Oneiric Shard',   price: 15000,  category: 'game', game: 'Honkai Star Rail', gameCode: 'HSR', status: 'active', needServer: false },
      { code: 'HSR_300',  name: '300 Oneiric Shard',  price: 75000,  category: 'game', game: 'Honkai Star Rail', gameCode: 'HSR', status: 'active', needServer: false },
      { code: 'HSR_980',  name: '980 Oneiric Shard',  price: 240000, category: 'game', game: 'Honkai Star Rail', gameCode: 'HSR', status: 'active', needServer: false }
    ]
  };
  return defaults[gameCode] || [];
}

module.exports = {
  showGameList,
  showGameProducts,
  handleProductSelect,
  handleTopupInput,
  showTopupConfirmation,
  processTopupPayment,
  executeTopupOrder,
  GAMES
};
