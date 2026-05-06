/**
 * resellerHandler.js - Handler Sistem Reseller
 * Upgrade member → reseller, harga khusus, komisi per transaksi
 */

const { usersDB, resellerDB, transactionsDB } = require('../utils/jsonDB');
const { generateOrderId, formatCurrency } = require('../utils/validator');
const { clearUserState } = require('./menuHandler');
const midtrans = require('../services/midtrans');
const pakasir = require('../services/pakasir');
const { sendAdminAlert } = require('../services/whatsapp');
const logger = require('../utils/logger');
const config = require('../config/config.json');

// ─── Info Reseller ─────────────────────────────────────────────────────────────

async function showResellerInfo(bot, chatId, userId) {
  const user = usersDB.get(userId);
  const fee = config.reseller.upgrade_fee;
  const markupUser = config.markup.markup_user;
  const markupReseller = config.markup.markup_reseller;
  const commissionRate = config.commission?.rate_reseller || 0;

  if (user?.isReseller) {
    // Sudah reseller
    const resellerData = resellerDB.get(userId) || {};
    await bot.sendMessage(chatId,
      `🏪 *STATUS RESELLER AKTIF*\n\n` +
      `✅ Anda sudah terdaftar sebagai Reseller!\n\n` +
      `📊 *Keuntungan Anda:*\n` +
      `• Markup lebih kecil: *${markupReseller}%* (user biasa: ${markupUser}%)\n` +
      `• Komisi per transaksi: *${commissionRate}%*\n` +
      `• Harga lebih kompetitif\n\n` +
      `💰 *Statistik:*\n` +
      `• Total Komisi: *${formatCurrency(user.totalCommission || 0)}*\n` +
      `• Total Transaksi: *${user.totalTransactions || 0}*\n` +
      `• Bergabung: ${resellerData.joinedAt ? new Date(resellerData.joinedAt).toLocaleDateString('id-ID') : '-'}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Menu Utama', callback_data: 'back_main' }]
          ]
        }
      }
    );
    return;
  }

  // Belum reseller
  await bot.sendMessage(chatId,
    `🏪 *PROGRAM RESELLER*\n\n` +
    `Upgrade ke Reseller dan nikmati keuntungan lebih!\n\n` +
    `✨ *Keuntungan Reseller:*\n` +
    `• Markup lebih kecil: *${markupReseller}%* (vs ${markupUser}% member biasa)\n` +
    `• Komisi *${commissionRate}%* per transaksi sukses\n` +
    `• Harga lebih murah untuk semua produk\n` +
    `• Bisa jual ulang ke pelanggan\n\n` +
    `💰 *Biaya Aktivasi:*\n` +
    `*${formatCurrency(fee)}* (sekali bayar, selamanya)\n\n` +
    `Pilih metode pembayaran:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: `💰 Bayar Saldo (${formatCurrency(user?.balance || 0)})`, callback_data: 'reseller_pay_balance' }],
          [{ text: '📸 QRIS (Otomatis)', callback_data: 'reseller_pay_orkut' }],
          [{ text: '🔙 Kembali', callback_data: 'back_main' }]
        ]
      }
    }
  );
}

// ─── Proses Upgrade Reseller ───────────────────────────────────────────────────

async function processResellerUpgrade(bot, chatId, userId, paymentMethod) {
  const user = usersDB.get(userId);
  if (!user) return;

  if (user.isReseller) {
    await bot.sendMessage(chatId, '✅ Anda sudah menjadi Reseller!');
    return;
  }

  const fee = config.reseller.upgrade_fee;
  const orderId = generateOrderId('RSL');

  if (paymentMethod === 'balance') {
    if ((user.balance || 0) < fee) {
      await bot.sendMessage(chatId,
        `❌ *Saldo tidak cukup!*\n\n` +
        `Saldo: ${formatCurrency(user.balance || 0)}\n` +
        `Dibutuhkan: ${formatCurrency(fee)}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '💰 Deposit Dulu', callback_data: 'menu_deposit' }],
              [{ text: '🔙 Kembali', callback_data: 'back_main' }]
            ]
          }
        }
      );
      return;
    }

    // Kurangi saldo dan upgrade
    usersDB.update(userId, {
      balance: user.balance - fee,
      isReseller: true
    });

    resellerDB.set(userId, {
      userId,
      name: user.name,
      phone: user.phone,
      joinedAt: new Date().toISOString(),
      activationOrderId: orderId,
      activationFee: fee
    });

    transactionsDB.set(orderId, {
      id: orderId, userId,
      type: 'reseller_upgrade',
      amount: fee,
      paymentMethod: 'balance',
      status: 'success',
      createdAt: new Date().toISOString()
    });

    await bot.sendMessage(chatId,
      `🎉 *SELAMAT! Anda Kini Reseller!*\n\n` +
      `✅ Akun Anda telah diupgrade ke Reseller.\n\n` +
      `🏪 *Keuntungan aktif:*\n` +
      `• Markup: ${config.markup.markup_reseller}%\n` +
      `• Komisi: ${config.commission?.rate_reseller || 0}% per transaksi\n\n` +
      `Mulai berjualan sekarang! 🚀`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎮 Mulai Topup', callback_data: 'menu_topup' }],
            [{ text: '🏠 Menu Utama', callback_data: 'back_main' }]
          ]
        }
      }
    );

    await sendAdminAlert(`🏪 RESELLER BARU\nUser: ${user.name} (${userId})\nHP: ${user.phone}`);
    logger.info('ResellerHandler', `Upgrade reseller sukses: ${userId}`);

  } else if (paymentMethod === 'orkut') {
    const { getEngine } = require('../services/paymentEngine');
    const engine = getEngine();
    
    try {
      await bot.sendMessage(chatId, '⏳ Sedang menggenerate QRIS, mohon tunggu...');
      
      const { reference, totalPay, qrBuffer, timeoutMs } = await engine.createOrder({
        userId,
        username: user.name,
        baseAmount: fee,
        meta: {
          order_type: 'reseller_upgrade'
        }
      });

      const expiresAt = new Date(Date.now() + timeoutMs).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

      transactionsDB.set(reference, {
        id: reference,
        userId,
        type: 'reseller_upgrade',
        amount: fee,
        totalPay,
        paymentMethod: 'orkut_qris',
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + timeoutMs).toISOString()
      });

      await bot.sendPhoto(chatId, qrBuffer, {
        caption:
          `📸 *AKTIVASI RESELLER (QRIS)*\n\n` +
          `💰 Biaya: *${formatCurrency(fee)}*\n` +
          `💸 Total Bayar: *${formatCurrency(totalPay)}*\n\n` +
          `⚠️ *PENTING:* Bayar sesuai nominal hingga 3 digit terakhir!\n\n` +
          `⏰ Expired: *${expiresAt}*\n\n` +
          `Setelah bayar, klik tombol *Cek Status* di bawah.`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Cek Status Pembayaran', callback_data: `check_pay_${reference}` }],
            [{ text: '❌ Batalkan', callback_data: `cancel_pay_${reference}` }]
          ]
        }
      });
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Gagal: ${err.message}`);
    }
  }
}

// ─── Konfirmasi Upgrade dari Webhook ──────────────────────────────────────────

async function confirmResellerUpgrade(bot, orderId, userId) {
  try {
    const user = usersDB.get(userId);
    if (!user || user.isReseller) return;

    usersDB.update(userId, { isReseller: true });

    resellerDB.set(userId, {
      userId,
      name: user.name,
      phone: user.phone,
      joinedAt: new Date().toISOString(),
      activationOrderId: orderId,
      activationFee: config.reseller.upgrade_fee
    });

    transactionsDB.update(orderId, {
      status: 'success',
      completedAt: new Date().toISOString()
    });

    await bot.sendMessage(userId,
      `🎉 *SELAMAT! Anda Kini Reseller!*\n\n` +
      `Pembayaran dikonfirmasi. Akun Anda telah diupgrade!\n\n` +
      `Markup Anda: ${config.markup.markup_reseller}%\n` +
      `Komisi: ${config.commission?.rate_reseller || 0}% per transaksi`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'back_main' }]] }
      }
    );

    await sendAdminAlert(`🏪 RESELLER BARU (via payment)\nUser: ${user.name} (${userId})`);
  } catch (err) {
    logger.error('ResellerHandler', 'confirmResellerUpgrade error', { msg: err.message });
  }
}

module.exports = {
  showResellerInfo,
  processResellerUpgrade,
  confirmResellerUpgrade
};
