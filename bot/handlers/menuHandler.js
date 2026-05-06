/**
 * menuHandler.js - Menu utama, registrasi, state management
 */

const { usersDB } = require('../utils/jsonDB');
const { formatCurrency, formatDate, validatePhone, normalizePhone, validateName } = require('../utils/validator');
const logger = require('../utils/logger');

// ─── State Management (in-memory) ─────────────────────────────────────────────

const userStates = new Map();

function getUserState(userId) {
  return userStates.get(String(userId)) || null;
}

function setUserState(userId, state) {
  userStates.set(String(userId), state);
}

function clearUserState(userId) {
  userStates.delete(String(userId));
}

// ─── Keyboard Utama ────────────────────────────────────────────────────────────

function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🎮 Topup Game', callback_data: 'menu_topup' },
        { text: '⚡ PPOB',       callback_data: 'menu_ppob'  }
      ],
      [
        { text: '💰 Deposit',         callback_data: 'menu_deposit'      },
        { text: '📊 Transaksi',        callback_data: 'menu_transactions' }
      ],
      [
        { text: '👤 Profile',  callback_data: 'menu_profile'  },
        { text: '🏪 Reseller', callback_data: 'menu_reseller' }
      ],
      [
        { text: '❓ Bantuan', callback_data: 'menu_help' }
      ]
    ]
  };
}

// ─── /start ────────────────────────────────────────────────────────────────────

async function handleStart(bot, msg) {
  const userId = String(msg.from.id);
  const user = usersDB.get(userId);

  if (!user) {
    setUserState(userId, { flow: 'register', step: 'register_name' });
    await bot.sendMessage(msg.chat.id,
      `👋 *Selamat datang di TopupBot!*\n\n` +
      `🎮 Topup Game & PPOB terpercaya.\n\n` +
      `Untuk memulai, daftar dulu ya.\n\n` +
      `📝 Masukkan *nama lengkap* Anda:`,
      { parse_mode: 'Markdown' }
    );
  } else {
    await sendMainMenu(bot, msg.chat.id, user);
  }
}

// ─── Registrasi ────────────────────────────────────────────────────────────────

async function handleRegistration(bot, msg, state) {
  const userId = String(msg.from.id);
  const text = msg.text?.trim();
  if (!text) return;

  if (state.step === 'register_name') {
    if (!validateName(text)) {
      await bot.sendMessage(msg.chat.id, '❌ Nama harus 2-60 karakter. Coba lagi:');
      return;
    }
    setUserState(userId, { ...state, step: 'register_phone', name: text });
    await bot.sendMessage(msg.chat.id,
      `✅ Nama: *${text}*\n\n📱 Masukkan *nomor HP* Anda:\nContoh: 08123456789`,
      { parse_mode: 'Markdown' }
    );

  } else if (state.step === 'register_phone') {
    if (!validatePhone(text)) {
      await bot.sendMessage(msg.chat.id, '❌ Nomor HP tidak valid. Contoh: 08123456789');
      return;
    }

    const phone = normalizePhone(text);
    const newUser = {
      id: userId,
      name: state.name,
      phone,
      balance: 0,
      totalTransactions: 0,
      totalCommission: 0,
      isReseller: false,
      registeredAt: new Date().toISOString(),
      telegramUsername: msg.from.username || '',
      telegramFirstName: msg.from.first_name || ''
    };

    usersDB.set(userId, newUser);
    clearUserState(userId);

    logger.info('MenuHandler', 'User baru terdaftar', { userId, name: state.name });

    await bot.sendMessage(msg.chat.id,
      `🎉 *Registrasi Berhasil!*\n\n` +
      `👤 Nama: *${state.name}*\n` +
      `📱 HP: *${text}*\n\n` +
      `Selamat datang di TopupBot! 🚀`,
      { parse_mode: 'Markdown' }
    );

    await sendMainMenu(bot, msg.chat.id, newUser);
  }
}

// ─── Kirim Menu Utama ──────────────────────────────────────────────────────────

async function sendMainMenu(bot, chatId, user) {
  const cfg = require('../config/config.json');
  const text =
    `👋 *Halo, ${user.name}!*\n` +
    `Selamat datang di *${cfg.app.bot_name}*\n\n` +
    `💰 Saldo: *${formatCurrency(user.balance || 0)}*\n` +
    `🏪 Status: *${user.isReseller ? 'Reseller' : 'Member'}*\n\n` +
    `Silakan pilih layanan kami:`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '🎮 Direct Topup Game', callback_data: 'menu_topup' }],
      [{ text: '⚡ PPOB & Tagihan',    callback_data: 'menu_ppob'  }],
      [{ text: '👤 Profil & Saldo',   callback_data: 'menu_profile' }, { text: '📜 Riwayat', callback_data: 'menu_history' }],
      [{ text: 'ℹ️ Bantuan',          callback_data: 'menu_help'    }]
    ]
  };

  if (cfg.app.bot_thumbnail) {
    try {
      await bot.sendPhoto(chatId, cfg.app.bot_thumbnail, {
        caption: text,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } catch (err) {
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

// ─── Profile ───────────────────────────────────────────────────────────────────

async function handleProfile(bot, chatId, userId) {
  const user = usersDB.get(userId);
  if (!user) return;

  await bot.sendMessage(chatId,
    `👤 *PROFIL ANDA*\n\n` +
    `📛 Nama: *${user.name}*\n` +
    `📱 HP: ${user.phone}\n` +
    `💰 Saldo: *${formatCurrency(user.balance || 0)}*\n` +
    `📊 Total Transaksi: *${user.totalTransactions || 0}*\n` +
    `${user.isReseller ? `💸 Total Komisi: *${formatCurrency(user.totalCommission || 0)}*\n` : ''}` +
    `🏪 Status: *${user.isReseller ? 'Reseller ✅' : 'Member'}*\n` +
    `📅 Bergabung: ${formatDate(user.registeredAt)}`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💰 Deposit Saldo', callback_data: 'menu_deposit' }],
          [{ text: '💸 Tarik Saldo', callback_data: 'menu_withdraw' }],
          [{ text: '🔙 Menu Utama', callback_data: 'back_main' }]
        ]
      }
    }
  );
}

// ─── Bantuan ───────────────────────────────────────────────────────────────────

async function handleHelp(bot, chatId) {
  await bot.sendMessage(chatId,
    `❓ *BANTUAN*\n\n` +
    `🎮 *Topup Game*\n` +
    `Isi diamond, UC, VP, dan item game lainnya.\n\n` +
    `⚡ *PPOB*\n` +
    `Pulsa, data, listrik, PDAM, internet, TV, e-wallet, BPJS, dll.\n\n` +
    `💰 *Deposit*\n` +
    `Isi saldo via Midtrans (transfer/QRIS/GoPay) atau Pakasir.\n\n` +
    `📊 *Transaksi*\n` +
    `Lihat riwayat dan status transaksi Anda.\n\n` +
    `🏪 *Reseller*\n` +
    `Upgrade ke reseller untuk harga lebih murah + komisi.\n\n` +
    `📞 *Hubungi Admin*\n` +
    `Jika ada masalah, hubungi admin via WhatsApp.`,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'back_main' }]] }
    }
  );
}

module.exports = {
  getUserState,
  setUserState,
  clearUserState,
  getMainMenuKeyboard,
  handleStart,
  handleRegistration,
  sendMainMenu,
  handleProfile,
  handleHelp
};
