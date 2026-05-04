/**
 * webhookServer.js - Express server untuk webhook Midtrans & Pakasir
 */

const express = require('express');
const config  = require('../config/config.json');
const logger  = require('../utils/logger');
const midtrans = require('./midtrans');
const pakasir  = require('./pakasir');
const { transactionsDB, usersDB } = require('../utils/jsonDB');

let app = null;

function startWebhookServer(bot) {
  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // ─── Health Check ───────────────────────────────────────────────────────────
  app.get('/', (req, res) => {
    res.json({ status: 'ok', app: config.app.name, version: config.app.version });
  });

  // ─── Midtrans Webhook ───────────────────────────────────────────────────────
  app.post(config.webhook.path_midtrans || '/webhook/midtrans', async (req, res) => {
    logger.info('Webhook', 'Midtrans notification diterima', { body: req.body });

    try {
      const result = midtrans.processWebhookNotification(req.body);

      if (!result.valid) {
        logger.warn('Webhook', 'Midtrans signature tidak valid');
        return res.status(400).json({ status: 'invalid signature' });
      }

      const { orderId, status, amount } = result;
      const trx = transactionsDB.get(orderId);

      if (!trx) {
        logger.warn('Webhook', 'Transaksi tidak ditemukan', { orderId });
        return res.status(404).json({ status: 'not found' });
      }

      if (trx.status === 'success') {
        return res.json({ status: 'already processed' });
      }

      if (status === 'success') {
        await handlePaymentSuccess(bot, orderId, trx, amount);
      } else if (status === 'failed') {
        transactionsDB.update(orderId, { status: 'failed', updatedAt: new Date().toISOString() });
        logger.info('Webhook', `Midtrans payment failed: ${orderId}`);
      }

      res.json({ status: 'ok' });
    } catch (err) {
      logger.error('Webhook', 'Midtrans webhook error', { msg: err.message });
      res.status(500).json({ status: 'error' });
    }
  });

  // ─── Pakasir Webhook ────────────────────────────────────────────────────────
  // Pakasir kirim: { amount, order_id, project, status:"completed", payment_method, completed_at }
  app.post(config.webhook.path_pakasir || '/webhook/pakasir', async (req, res) => {
    logger.info('Webhook', 'Pakasir notification diterima', { body: req.body });

    try {
      const { order_id, amount, status } = req.body;
      const trx = transactionsDB.get(order_id);

      // Validasi amount & order_id dengan data di DB
      const result = pakasir.processWebhook(req.body, trx);

      if (!result.valid) {
        logger.warn('Webhook', 'Pakasir webhook tidak valid', { reason: result.reason });
        return res.status(400).json({ status: 'invalid' });
      }

      if (!trx) return res.status(404).json({ status: 'not found' });
      if (trx.status === 'success') return res.json({ status: 'already processed' });

      if (result.status === 'success') {
        await handlePaymentSuccess(bot, order_id, trx, result.amount);
      }

      res.json({ status: 'ok' });
    } catch (err) {
      logger.error('Webhook', 'Pakasir webhook error', { msg: err.message });
      res.status(500).json({ status: 'error' });
    }
  });

  // ─── APIGames Webhook ───────────────────────────────────────────────────────
  app.post('/webhook/apigames', async (req, res) => {
    logger.info('Webhook', 'APIGames notification diterima', { body: req.body });

    try {
      const apiGames = require('./apiGames');
      const { ref_id, status, sn } = req.body;

      // Verifikasi header signature
      if (!apiGames.verifyWebhook(req.headers, ref_id)) {
        logger.warn('Webhook', 'APIGames signature tidak valid');
        return res.status(400).json({ status: 'invalid signature' });
      }

      const trx = transactionsDB.get(ref_id);
      if (!trx) return res.status(404).json({ status: 'not found' });
      if (trx.status === 'success') return res.json({ status: 'already processed' });

      const parsedStatus = apiGames.parseStatus(status);

      transactionsDB.update(ref_id, {
        status: parsedStatus,
        sn: sn || '',
        apiStatus: status,
        updatedAt: new Date().toISOString()
      });

      if (parsedStatus === 'success') {
        // Notif ke user via Telegram
        try {
          await bot.sendMessage(trx.userId,
            `✅ *Transaksi Berhasil!*\n\n` +
            `Order: \`${ref_id}\`\n` +
            `Produk: ${trx.product?.name || '-'}\n` +
            `${sn && sn !== '-' ? `SN: \`${sn}\`` : ''}`,
            { parse_mode: 'Markdown' }
          );
        } catch { /* user mungkin block bot */ }
      } else if (parsedStatus === 'failed') {
        // Refund jika bayar pakai saldo
        if (trx.paymentMethod === 'balance') {
          const user = usersDB.get(trx.userId);
          if (user) usersDB.update(trx.userId, { balance: (user.balance || 0) + trx.amount });
        }
        try {
          await bot.sendMessage(trx.userId,
            `❌ *Transaksi Gagal*\n\nOrder: \`${ref_id}\`\n${trx.paymentMethod === 'balance' ? 'Saldo telah dikembalikan.' : ''}`,
            { parse_mode: 'Markdown' }
          );
        } catch { /* ignore */ }
      }

      res.json({ status: 'ok' });
    } catch (err) {
      logger.error('Webhook', 'APIGames webhook error', { msg: err.message });
      res.status(500).json({ status: 'error' });
    }
  });
  app.get('/payment/finish', (req, res) => {
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:50px">
        <h2>✅ Pembayaran Diterima</h2>
        <p>Saldo Anda akan diperbarui otomatis.</p>
        <p>Kembali ke bot Telegram untuk melanjutkan.</p>
      </body></html>
    `);
  });

  app.get('/payment/error', (req, res) => {
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:50px">
        <h2>❌ Pembayaran Gagal</h2>
        <p>Silakan coba lagi melalui bot Telegram.</p>
      </body></html>
    `);
  });

  const port = config.webhook.port || 3000;
  app.listen(port, () => {
    logger.info('Webhook', `Server berjalan di port ${port}`);
  });

  return app;
}

// ─── Handle Payment Success ────────────────────────────────────────────────────

async function handlePaymentSuccess(bot, orderId, trx, amount) {
  const { userId, type } = trx;

  if (type === 'deposit') {
    const depositHandler = require('../handlers/depositHandler');
    await depositHandler.confirmDepositSuccess(bot, orderId, amount, userId);

  } else if (type === 'topup') {
    // Topup via payment gateway: proses ke API setelah bayar
    transactionsDB.update(orderId, { status: 'processing', paidAt: new Date().toISOString() });

    const topupHandler = require('../handlers/topupHandler');
    const state = {
      product: trx.product,
      finalPrice: trx.amount,
      gameUserId: trx.gameUserId,
      server: trx.server || '',
      game: null
    };
    await topupHandler.executeTopupOrder(bot, userId, userId, orderId, state);

  } else if (type === 'ppob') {
    transactionsDB.update(orderId, { status: 'processing', paidAt: new Date().toISOString() });

    const ppobHandler = require('../handlers/ppobHandler');
    const state = {
      selectedProduct: trx.product,
      finalPrice: trx.amount,
      target: trx.target,
      cat: { code: trx.category, name: trx.categoryName, icon: '⚡' },
      inquiryData: trx.inquiryData
    };
    await ppobHandler.executePPOBOrder(bot, userId, userId, orderId, state);

  } else if (type === 'reseller_upgrade') {
    const resellerHandler = require('../handlers/resellerHandler');
    await resellerHandler.confirmResellerUpgrade(bot, orderId, userId);
  }
}

module.exports = { startWebhookServer };
