/**
 * depositHandler.js - Handler Deposit Saldo
 * Mendukung Midtrans (Snap) dan Pakasir
 */

const { usersDB, transactionsDB } = require('../utils/jsonDB');
const { generateOrderId, formatCurrency } = require('../utils/validator');
const { clearUserState, setUserState, getUserState } = require('./menuHandler');
const { getEngine } = require('../services/paymentEngine');
const { sendNotification } = require('../services/whatsapp');
const logger = require('../utils/logger');

const DEPOSIT_AMOUNTS = [5000, 10000, 20000, 50000, 100000, 200000, 500000];

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
          [{ text: '� QRIS (Otomatis)', callback_data: 'deposit_orkut' }],
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

  const methodName = 'QRIS (OrderKuota)';

  await bot.sendMessage(chatId,
    `💰 *Deposit via ${methodName}*\n\nPilih nominal deposit:`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } }
  );
}

// ─── Input Nominal Custom ──────────────────────────────────────────────────────

async function handleCustomAmount(bot, chatId, userId, method) {
  setUserState(userId, { flow: 'deposit', step: 'deposit_custom_amount', method });
  await bot.sendMessage(chatId,
    `✏️ Masukkan nominal deposit (Rp 1 - Rp 1.000.000):\n\nContoh: 75000`,
    { parse_mode: 'Markdown' }
  );
}

async function handleCustomAmountInput(bot, msg, state) {
  const userId = String(msg.from.id);
  const text = msg.text?.trim().replace(/\D/g, '');
  const amount = parseInt(text);

  if (isNaN(amount) || amount < 1) {
    await bot.sendMessage(msg.chat.id, '❌ Nominal minimal Rp 1. Masukkan ulang:');
    return;
  }
  
  if (amount > 1000000) {
    await bot.sendMessage(msg.chat.id, '❌ Nominal maksimal Rp 1.000.000. Masukkan ulang:');
    return;
  }

  clearUserState(userId);
  await processDeposit(bot, msg.chat.id, userId, state.method, amount);
}

// ─── Proses Deposit ────────────────────────────────────────────────────────────

async function processDeposit(bot, chatId, userId, method, amount) {
  const user = usersDB.get(userId);
  if (!user) return;

  const engine = getEngine();
  
  try {
    await bot.sendMessage(chatId, '⏳ Sedang menggenerate QRIS, mohon tunggu...');
    
    const { reference, totalPay, qrBuffer, timeoutMs } = await engine.createDeposit(userId, user.name, amount);
    const expiresAt = new Date(Date.now() + timeoutMs).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

    transactionsDB.set(reference, {
      id: reference,
      userId,
      type: 'deposit',
      amount,
      totalPay,
      paymentMethod: 'orkut_qris',
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + timeoutMs).toISOString()
    });

    await bot.sendPhoto(chatId, qrBuffer, {
      caption: 
        `� *QRIS DEPOSIT (OTOMATIS)*\n\n` +
        `Order ID: \`${reference}\`\n` +
        `Nominal: *${formatCurrency(amount)}*\n` +
        `Biaya Admin: *${formatCurrency(totalPay - amount)}*\n` +
        `Total Bayar: *${formatCurrency(totalPay)}*\n\n` +
        `⚠️ *PENTING:* Bayar sesuai nominal hingga 3 digit terakhir agar terdeteksi otomatis!\n\n` +
        `⏰ Expired: *${expiresAt}*\n\n` +
        `Setelah bayar, klik tombol *Cek Status* di bawah.`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '� Cek Status Pembayaran', callback_data: `check_pay_${reference}` }],
          [{ text: '❌ Batalkan', callback_data: `cancel_pay_${reference}` }]
        ]
      }
    });

    logger.info('DepositHandler', `Deposit Orkut dibuat: ${reference} - ${totalPay}`);

  } catch (err) {
    logger.error('DepositHandler', 'Gagal buat Orkut QRIS', { msg: err.message });
    await bot.sendMessage(chatId,
      `❌ Gagal membuat pembayaran QRIS.\n\n${err.message}`,
      { reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'menu_deposit' }]] } }
    );
  }
}

// ─── Cek Status Pembayaran ───────────────────────────────────────────────────

async function handleCheckPayment(bot, chatId, userId, reference) {
  const engine = getEngine();
  
  try {
    const result = await engine.checkPayment(reference);
    
    if (result.success && result.paid) {
      const tx = result.tx;
      
      if (tx.type === 'deposit') {
        await confirmDepositSuccess(bot, reference, tx.base_amount, tx.user_id);
      } else if (tx.type === 'order' || tx.type === 'topup') {
        // Handle direct order payment
        const topupHandler = require('./topupHandler');
        
        transactionsDB.update(reference, {
          status: 'processing',
          paidAt: new Date().toISOString()
        });

        await bot.sendMessage(chatId, `✅ *Pembayaran Terdeteksi!*\n\nOrder \`${reference}\` sedang diproses...`, { parse_mode: 'Markdown' });
        
        // Execute the topup
        await topupHandler.executeTopupOrder(bot, chatId, tx.user_id, reference, {
          product: { code: tx.product_code, name: tx.product_name },
          finalPrice: tx.base_amount,
          gameUserId: tx.game_user_id,
          server: tx.server,
          game: { icon: '🎮' } // fallback icon
        });
      } else if (tx.type === 'ppob') {
        const ppobHandler = require('./ppobHandler');
        
        transactionsDB.update(reference, {
          status: 'processing',
          paidAt: new Date().toISOString()
        });

        await bot.sendMessage(chatId, `✅ *Pembayaran Terdeteksi!*\n\nOrder \`${reference}\` sedang diproses...`, { parse_mode: 'Markdown' });
        
        // Execute the ppob
        await ppobHandler.executePPOBOrder(bot, chatId, tx.user_id, reference, {
          selectedProduct: { code: tx.product?.code || tx.product_code, name: tx.product?.name || tx.product_name },
          target: tx.target,
          finalPrice: tx.amount,
          cat: { icon: '⚡', name: tx.categoryName || 'PPOB' }
        });
      } else if (tx.type === 'reseller_upgrade') {
        const resellerHandler = require('./resellerHandler');
        
        transactionsDB.update(reference, {
          status: 'processing',
          paidAt: new Date().toISOString()
        });

        await bot.sendMessage(chatId, `✅ *Pembayaran Terdeteksi!*\n\nAktivasi Reseller sedang diproses...`, { parse_mode: 'Markdown' });
        
        await resellerHandler.confirmResellerUpgrade(bot, reference, tx.user_id);
      }
    } else if (result.success && !result.paid) {
      await bot.sendMessage(chatId, '❌ Pembayaran belum terdeteksi. Pastikan Anda sudah membayar sesuai nominal yang tertera.', {
        reply_markup: {
          inline_keyboard: [[{ text: '🔄 Cek Lagi', callback_data: `check_pay_${reference}` }]]
        }
      });
    } else {
      await bot.sendMessage(chatId, `❌ Gagal cek status: ${result.reason || 'Unknown error'}`);
    }
  } catch (err) {
    await bot.sendMessage(chatId, `❌ Kesalahan sistem: ${err.message}`);
  }
}

async function handleCancelPayment(bot, chatId, userId, reference) {
  const engine = getEngine();
  const result = await engine.cancel(reference, userId);
  
  if (result.ok) {
    transactionsDB.update(reference, { status: 'canceled', canceledAt: new Date().toISOString() });
    await bot.sendMessage(chatId, `✅ Pembayaran \`${reference}\` telah dibatalkan.`, { parse_mode: 'Markdown' });
  } else {
    await bot.sendMessage(chatId, `❌ Gagal membatalkan: ${result.reason}`);
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
  handleCheckPayment,
  handleCancelPayment,
  confirmDepositSuccess
};
