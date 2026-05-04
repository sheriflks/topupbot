/**
 * depositHandler.js - Handler Deposit Saldo
 * Mendukung Midtrans (Snap) dan Pakasir
 */

const { usersDB, transactionsDB } = require('../utils/jsonDB');
const { generateOrderId, formatCurrency } = require('../utils/validator');
const { clearUserState, setUserState, getUserState } = require('./menuHandler');
const midtrans = require('../services/midtrans');
const pakasir = require('../services/pakasir');
const { sendNotification } = require('../services/whatsapp');
const logger = require('../utils/logger');

const DEPOSIT_AMOUNTS = [10000, 20000, 50000, 100000, 200000, 500000];

// ─── Menu Deposit ──────────────────────────────────────────────────────────────

async function showDepositMenu(bot, chatId, userId) {
  const user = usersDB.get(userId);

  await bot.sendMessage(chatId,
    `💰 *DEPOSIT SALDO*\n\n` +
    `Saldo saat ini: *${formatCurrency(user?.balance || 0)}*\n\n` +
    `Pilih metode deposit:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💳 Midtrans (Transfer/QRIS/GoPay/dll)', callback_data: 'deposit_midtrans' }],
          [{ text: '🏦 Pakasir', callback_data: 'deposit_pakasir' }],
          [{ text: '🔙 Kembali', callback_data: 'back_main' }]
        ]
      }
    }
  );
}

// ─── Pilih Nominal ─────────────────────────────────────────────────────────────

async function showDepositAmounts(bot, chatId, userId, method) {
  const rows = [];
  for (let i = 0; i < DEPOSIT_AMOUNTS.length; i += 2) {
    const row = [
      { text: formatCurrency(DEPOSIT_AMOUNTS[i]), callback_data: `dep_amount_${method}_${DEPOSIT_AMOUNTS[i]}` }
    ];
    if (DEPOSIT_AMOUNTS[i + 1]) {
      row.push({ text: formatCurrency(DEPOSIT_AMOUNTS[i + 1]), callback_data: `dep_amount_${method}_${DEPOSIT_AMOUNTS[i + 1]}` });
    }
    rows.push(row);
  }
  rows.push([{ text: '✏️ Nominal Lain', callback_data: `dep_custom_${method}` }]);
  rows.push([{ text: '🔙 Kembali', callback_data: 'menu_deposit' }]);

  const methodName = method === 'midtrans' ? 'Midtrans' : 'Pakasir';

  await bot.sendMessage(chatId,
    `💰 *Deposit via ${methodName}*\n\nPilih nominal deposit:`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } }
  );
}

// ─── Input Nominal Custom ──────────────────────────────────────────────────────

async function handleCustomAmount(bot, chatId, userId, method) {
  setUserState(userId, { flow: 'deposit', step: 'deposit_custom_amount', method });
  await bot.sendMessage(chatId,
    `✏️ Masukkan nominal deposit (minimal Rp 10.000):\n\nContoh: 75000`,
    { parse_mode: 'Markdown' }
  );
}

async function handleCustomAmountInput(bot, msg, state) {
  const userId = String(msg.from.id);
  const text = msg.text?.trim().replace(/\D/g, '');
  const amount = parseInt(text);

  if (!amount || amount < 10000) {
    await bot.sendMessage(msg.chat.id, '❌ Nominal minimal Rp 10.000. Masukkan ulang:');
    return;
  }

  clearUserState(userId);
  await processDeposit(bot, msg.chat.id, userId, state.method, amount);
}

// ─── Proses Deposit ────────────────────────────────────────────────────────────

async function processDeposit(bot, chatId, userId, method, amount) {
  const user = usersDB.get(userId);
  if (!user) return;

  const orderId = generateOrderId('DEP');

  if (method === 'midtrans') {
    try {
      const result = await midtrans.createSnapTransaction({
        orderId,
        amount,
        customerName: user.name,
        customerPhone: user.phone,
        itemDetails: [{
          id: 'DEPOSIT',
          price: amount,
          quantity: 1,
          name: `Deposit Saldo ${formatCurrency(amount)}`
        }]
      });

      transactionsDB.set(orderId, {
        id: orderId,
        userId,
        type: 'deposit',
        amount,
        paymentMethod: 'midtrans',
        paymentUrl: result.redirect_url,
        paymentToken: result.token,
        status: 'pending',
        createdAt: new Date().toISOString()
      });

      await bot.sendMessage(chatId,
        `💳 *Deposit via Midtrans*\n\n` +
        `Order ID: \`${orderId}\`\n` +
        `Nominal: *${formatCurrency(amount)}*\n\n` +
        `Metode tersedia:\n` +
        `• Transfer Bank (BCA, BNI, BRI, Mandiri)\n` +
        `• QRIS\n` +
        `• GoPay / ShopeePay\n` +
        `• Kartu Kredit\n\n` +
        `Klik tombol di bawah untuk bayar:`,
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

      logger.info('DepositHandler', `Deposit Midtrans dibuat: ${orderId} - ${amount}`);

    } catch (err) {
      logger.error('DepositHandler', 'Gagal buat Midtrans', { msg: err.message });
      await bot.sendMessage(chatId,
        `❌ Gagal membuat pembayaran Midtrans.\n\n${err.message}`,
        { reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'menu_deposit' }]] } }
      );
    }

  } else if (method === 'pakasir') {
    try {
      const result = await pakasir.createInvoice({
        orderId,
        amount,
        customerName: user.name,
        customerPhone: user.phone,
        description: `Deposit Saldo ${formatCurrency(amount)}`
      });

      transactionsDB.set(orderId, {
        id: orderId,
        userId,
        type: 'deposit',
        amount,
        paymentMethod: 'pakasir',
        invoiceId: result.invoiceId,
        paymentUrl: result.paymentUrl,
        status: 'pending',
        createdAt: new Date().toISOString()
      });

      await bot.sendMessage(chatId,
        `🏦 *Deposit via Pakasir*\n\n` +
        `Order ID: \`${orderId}\`\n` +
        `Nominal: *${formatCurrency(amount)}*\n\n` +
        `Klik tombol di bawah untuk bayar:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🏦 Bayar Sekarang', url: result.paymentUrl }],
              [{ text: '🏠 Menu Utama', callback_data: 'back_main' }]
            ]
          }
        }
      );

      logger.info('DepositHandler', `Deposit Pakasir dibuat: ${orderId} - ${amount}`);

    } catch (err) {
      logger.error('DepositHandler', 'Gagal buat Pakasir', { msg: err.message });
      await bot.sendMessage(chatId,
        `❌ Gagal membuat invoice Pakasir.\n\n${err.message}`,
        { reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'menu_deposit' }]] } }
      );
    }
  }
}

// ─── Konfirmasi Deposit Berhasil (dipanggil dari webhook) ─────────────────────

async function confirmDepositSuccess(bot, orderId, amount, userId) {
  try {
    const user = usersDB.get(userId);
    if (!user) return;

    const newBalance = (user.balance || 0) + amount;
    usersDB.update(userId, { balance: newBalance });

    transactionsDB.update(orderId, {
      status: 'success',
      completedAt: new Date().toISOString()
    });

    // Kirim notifikasi Telegram
    await bot.sendMessage(userId,
      `✅ *DEPOSIT BERHASIL!*\n\n` +
      `Order ID: \`${orderId}\`\n` +
      `Nominal: *${formatCurrency(amount)}*\n` +
      `Saldo Baru: *${formatCurrency(newBalance)}*\n\n` +
      `Saldo siap digunakan! 🎉`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎮 Topup Game', callback_data: 'menu_topup' }],
            [{ text: '🏠 Menu Utama', callback_data: 'back_main' }]
          ]
        }
      }
    );

    // Kirim notifikasi WA
    if (user.phone) {
      await sendNotification(user.phone,
        `✅ DEPOSIT BERHASIL\nNominal: ${formatCurrency(amount)}\nSaldo: ${formatCurrency(newBalance)}\nOrder: ${orderId}`
      );
    }

    logger.info('DepositHandler', `Deposit sukses: ${orderId} +${amount} user ${userId}`);
  } catch (err) {
    logger.error('DepositHandler', 'confirmDepositSuccess error', { msg: err.message, orderId });
  }
}

module.exports = {
  showDepositMenu,
  showDepositAmounts,
  handleCustomAmount,
  handleCustomAmountInput,
  processDeposit,
  confirmDepositSuccess
};
