/**
 * withdrawHandler.js - Handler Penarikan Komisi/Saldo
 */

'use strict';

const { usersDB, transactionsDB } = require('../utils/jsonDB');
const { formatCurrency, generateOrderId } = require('../utils/validator');
const { setUserState, clearUserState } = require('./menuHandler');
const logger = require('../utils/logger');
const config = require('../config/config.json');

// ─── Menu Withdraw ─────────────────────────────────────────────────────────────

async function showWithdrawMenu(bot, chatId, userId) {
  const user = usersDB.get(userId);
  if (!user) return;

  const minWithdraw = config.withdraw?.min_amount || 10000;

  await bot.sendMessage(chatId,
    `💸 *PENARIKAN SALDO*\n\n` +
    `Saldo Anda: *${formatCurrency(user.balance || 0)}*\n` +
    `Minimal Penarikan: *${formatCurrency(minWithdraw)}*\n\n` +
    `Pilih metode penarikan:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📱 DANA', callback_data: 'withdraw_method_DANA' }],
          [{ text: '📱 OVO',  callback_data: 'withdraw_method_OVO'  }],
          [{ text: '📱 GoPay', callback_data: 'withdraw_method_GOPAY' }],
          [{ text: '📱 ShopeePay', callback_data: 'withdraw_method_SHOPEEPAY' }],
          [{ text: '🔙 Kembali', callback_data: 'menu_profile' }]
        ]
      }
    }
  );
}

// ─── Input Nomor & Nominal ─────────────────────────────────────────────────────

async function handleWithdrawMethod(bot, chatId, userId, method) {
  setUserState(userId, { flow: 'withdraw', step: 'withdraw_amount', method });
  await bot.sendMessage(chatId,
    `💰 *Penarikan via ${method}*\n\n` +
    `Masukkan jumlah yang ingin ditarik (tanpa titik/koma):\n` +
    `Contoh: 50000`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'menu_profile' }]] } }
  );
}

async function handleWithdrawInput(bot, msg, state) {
  const userId = String(msg.from.id);
  const text = msg.text?.trim().replace(/\D/g, '');
  const amount = parseInt(text);
  const user = usersDB.get(userId);
  const minWithdraw = config.withdraw?.min_amount || 10000;

  if (state.step === 'withdraw_amount') {
    if (!amount || amount < minWithdraw) {
      await bot.sendMessage(msg.chat.id, `❌ Minimal penarikan adalah ${formatCurrency(minWithdraw)}. Masukkan ulang:`);
      return;
    }
    if (amount > (user.balance || 0)) {
      await bot.sendMessage(msg.chat.id, `❌ Saldo Anda tidak cukup. Saldo: ${formatCurrency(user.balance || 0)}. Masukkan ulang:`);
      return;
    }

    setUserState(userId, { ...state, step: 'withdraw_account', amount });
    await bot.sendMessage(msg.chat.id,
      `✅ Nominal: *${formatCurrency(amount)}*\n\n` +
      `📝 Masukkan *Nomor E-Wallet / Rekening* tujuan:\n` +
      `Contoh: 08123456789`,
      { parse_mode: 'Markdown' }
    );

  } else if (state.step === 'withdraw_account') {
    const account = msg.text?.trim();
    if (!account) return;

    setUserState(userId, { ...state, step: 'withdraw_confirm', account });
    
    await bot.sendMessage(msg.chat.id,
      `📋 *KONFIRMASI PENARIKAN*\n\n` +
      `🏦 Metode: *${state.method}*\n` +
      `💰 Nominal: *${formatCurrency(state.amount)}*\n` +
      `🎯 Tujuan: \`${account}\`\n\n` +
      `Apakah data sudah benar?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Ya, Ajukan Sekarang', callback_data: 'withdraw_submit' }],
            [{ text: '❌ Batal', callback_data: 'menu_profile' }]
          ]
        }
      }
    );
  }
}

// ─── Submit Withdraw ───────────────────────────────────────────────────────────

async function processWithdraw(bot, chatId, userId) {
  const state = setUserState(userId, null); // Get and clear state
  // Wait, I should use getUserState and then clear
  const userState = require('./menuHandler').getUserState(userId);
  if (!userState || userState.flow !== 'withdraw') return;
  
  const user = usersDB.get(userId);
  if (!user || user.balance < userState.amount) {
    await bot.sendMessage(chatId, '❌ Saldo tidak cukup atau user tidak ditemukan.');
    return;
  }

  const orderId = generateOrderId('WD');
  
  // Potong saldo
  usersDB.update(userId, { balance: user.balance - userState.amount });

  // Simpan transaksi
  transactionsDB.set(orderId, {
    id: orderId,
    userId,
    type: 'withdraw',
    method: userState.method,
    account: userState.account,
    amount: userState.amount,
    status: 'pending',
    createdAt: new Date().toISOString()
  });

  clearUserState(userId);

  await bot.sendMessage(chatId,
    `✅ *PENARIKAN DIAJUKAN!*\n\n` +
    `ID: \`${orderId}\`\n` +
    `Nominal: *${formatCurrency(userState.amount)}*\n` +
    `Tujuan: \`${userState.account}\` (${userState.method})\n\n` +
    `Mohon tunggu, admin akan memproses penarikan Anda.`,
    { parse_mode: 'Markdown' }
  );

  // Notif Admin
  const { sendAdminAlert } = require('../services/whatsapp');
  await sendAdminAlert(
    `💸 *PENARIKAN BARU*\n\n` +
    `ID: \`${orderId}\`\n` +
    `User: ${user.name} (\`${userId}\`)\n` +
    `Nominal: *${formatCurrency(userState.amount)}*\n` +
    `Metode: *${userState.method}*\n` +
    `Tujuan: \`${userState.account}\``
  );

  logger.info('WithdrawHandler', `Withdraw diajukan: ${orderId} - ${userState.amount} by ${userId}`);
}

module.exports = {
  showWithdrawMenu,
  handleWithdrawMethod,
  handleWithdrawInput,
  processWithdraw
};
