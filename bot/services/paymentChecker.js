/**
 * paymentChecker.js - Background service untuk cek mutasi otomatis
 */

'use strict';

const { getEngine, loadPaymentDb, savePaymentDb } = require('./paymentEngine');
const { transactionsDB } = require('../utils/jsonDB');
const logger = require('../utils/logger');

let isChecking = false;

async function startAutoCheck(bot) {
  // Cek setiap 1 menit
  setInterval(async () => {
    if (isChecking) return;
    isChecking = true;

    try {
      const dbPay = loadPaymentDb();
      const payments = dbPay.payments || {};
      const pendingRefs = Object.keys(payments).filter(ref => payments[ref].status === 'pending');

      if (pendingRefs.length === 0) {
        isChecking = false;
        return;
      }

      logger.info('PaymentChecker', `Mengecek ${pendingRefs.length} transaksi pending...`);

      const engine = getEngine();
      
      // Karena kita cek mutasi sekaligus, kita bisa panggil checkPayment satu per satu
      // API mutasi biasanya mengembalikan list mutasi terbaru, jadi panggil sekali saja sebenarnya cukup
      // Tapi engine.checkPayment memanggil API mutasi di dalamnya.
      
      for (const ref of pendingRefs) {
        try {
          const result = await engine.checkPayment(ref);
          if (result.success && result.paid) {
            const tx = result.tx;
            logger.info('PaymentChecker', `Transaksi ${ref} BERHASIL terdeteksi otomatis!`);
            
            // Proses sesuai tipe
            if (tx.type === 'deposit') {
              const depositHandler = require('../handlers/depositHandler');
              await depositHandler.confirmDepositSuccess(bot, ref, tx.base_amount, tx.user_id);
            } else if (tx.type === 'order' || tx.type === 'topup') {
              const topupHandler = require('../handlers/topupHandler');
              transactionsDB.update(ref, { status: 'processing', paidAt: new Date().toISOString() });
              await bot.sendMessage(tx.user_id, `✅ *Pembayaran Terdeteksi Otomatis!*\n\nOrder \`${ref}\` sedang diproses...`, { parse_mode: 'Markdown' });
              await topupHandler.executeTopupOrder(bot, null, tx.user_id, ref, {
                product: { code: tx.product_code, name: tx.product_name },
                finalPrice: tx.base_amount,
                gameUserId: tx.game_user_id,
                server: tx.server,
                game: { icon: '🎮' }
              });
            } else if (tx.type === 'ppob') {
              const ppobHandler = require('../handlers/ppobHandler');
              transactionsDB.update(ref, { status: 'processing', paidAt: new Date().toISOString() });
              await bot.sendMessage(tx.user_id, `✅ *Pembayaran Terdeteksi Otomatis!*\n\nOrder \`${ref}\` sedang diproses...`, { parse_mode: 'Markdown' });
              await ppobHandler.executePPOBOrder(bot, null, tx.user_id, ref, {
                selectedProduct: { code: tx.product_code, name: tx.product_name },
                target: tx.target,
                finalPrice: tx.amount,
                cat: { icon: '⚡', name: tx.categoryName || 'PPOB' }
              });
            } else if (tx.type === 'reseller_upgrade') {
              const resellerHandler = require('../handlers/resellerHandler');
              transactionsDB.update(ref, { status: 'processing', paidAt: new Date().toISOString() });
              await bot.sendMessage(tx.user_id, `✅ *Pembayaran Terdeteksi Otomatis!*\n\nAktivasi Reseller sedang diproses...`, { parse_mode: 'Markdown' });
              await resellerHandler.confirmResellerUpgrade(bot, ref, tx.user_id);
            }
          }
        } catch (err) {
          logger.error('PaymentChecker', `Gagal cek ${ref}`, { msg: err.message });
        }
        // Kasih jeda sedikit antar pengecekan jika perlu, tapi mutasi API biasanya sama
        await new Promise(r => setTimeout(r, 1000));
      }

    } catch (err) {
      logger.error('PaymentChecker', 'Auto check error', { msg: err.message });
    } finally {
      isChecking = false;
    }
  }, 60 * 1000); // 1 menit sekali
}

module.exports = { startAutoCheck };
