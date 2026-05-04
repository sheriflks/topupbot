/**
 * transactionHandler.js - Riwayat & detail transaksi user
 */

const { usersDB, transactionsDB } = require('../utils/jsonDB');
const { formatCurrency, formatDate } = require('../utils/validator');
const logger = require('../utils/logger');

const PAGE_SIZE = 5;

// ─── Daftar Transaksi ──────────────────────────────────────────────────────────

async function showTransactions(bot, chatId, userId, page = 0) {
  const allTrx = transactionsDB.find(t => t.userId === userId);

  if (allTrx.length === 0) {
    await bot.sendMessage(chatId,
      `📊 *RIWAYAT TRANSAKSI*\n\nBelum ada transaksi.`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'back_main' }]] }
      }
    );
    return;
  }

  // Sort terbaru dulu
  allTrx.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const totalPages = Math.ceil(allTrx.length / PAGE_SIZE);
  const pageTrx = allTrx.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  let text = `📊 *RIWAYAT TRANSAKSI*\n`;
  text += `Halaman ${page + 1}/${totalPages} | Total: ${allTrx.length}\n\n`;

  for (const trx of pageTrx) {
    const statusIcon = trx.status === 'success' ? '✅' :
                       trx.status === 'failed'  ? '❌' :
                       trx.status === 'processing' ? '⏳' : '🕐';
    const typeIcon = trx.type === 'topup' ? '🎮' :
                     trx.type === 'ppob'  ? '⚡' :
                     trx.type === 'deposit' ? '💰' : '🏪';

    text += `${typeIcon} *${trx.product?.name || trx.type?.toUpperCase()}*\n`;
    text += `   ${statusIcon} ${trx.status?.toUpperCase()} | ${formatCurrency(trx.amount)}\n`;
    text += `   🕐 ${formatDate(trx.createdAt)}\n`;
    text += `   ID: \`${trx.id}\`\n\n`;
  }

  const navButtons = [];
  if (page > 0) navButtons.push({ text: '◀️ Sebelumnya', callback_data: `trx_page_${page - 1}` });
  if (page < totalPages - 1) navButtons.push({ text: 'Berikutnya ▶️', callback_data: `trx_page_${page + 1}` });

  const keyboard = [];
  if (navButtons.length > 0) keyboard.push(navButtons);
  keyboard.push([{ text: '🔙 Menu Utama', callback_data: 'back_main' }]);

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}

// ─── Detail Transaksi ──────────────────────────────────────────────────────────

async function showTransactionDetail(bot, chatId, orderId) {
  const trx = transactionsDB.get(orderId);
  if (!trx) {
    await bot.sendMessage(chatId, '❌ Transaksi tidak ditemukan.');
    return;
  }

  const statusIcon = trx.status === 'success' ? '✅' :
                     trx.status === 'failed'  ? '❌' :
                     trx.status === 'processing' ? '⏳' : '🕐';

  let text = `📋 *DETAIL TRANSAKSI*\n\n`;
  text += `Order ID: \`${trx.id}\`\n`;
  text += `Tipe: ${trx.type?.toUpperCase()}\n`;
  text += `Status: ${statusIcon} *${trx.status?.toUpperCase()}*\n`;
  text += `Nominal: *${formatCurrency(trx.amount)}*\n`;
  text += `Metode: ${trx.paymentMethod?.toUpperCase()}\n`;
  text += `Tanggal: ${formatDate(trx.createdAt)}\n`;

  if (trx.type === 'topup') {
    text += `\n🎮 *Detail Topup:*\n`;
    text += `Produk: ${trx.product?.name}\n`;
    text += `User ID: \`${trx.gameUserId}\`\n`;
    if (trx.server) text += `Server: \`${trx.server}\`\n`;
  } else if (trx.type === 'ppob') {
    text += `\n⚡ *Detail PPOB:*\n`;
    text += `Produk: ${trx.product?.name}\n`;
    text += `Tujuan: \`${trx.target}\`\n`;
    if (trx.inquiryData?.name) text += `Nama: ${trx.inquiryData.name}\n`;
  }

  if (trx.paymentUrl && trx.status === 'pending') {
    text += `\n🔗 Belum dibayar. Klik tombol untuk bayar.`;
  }

  const keyboard = [];
  if (trx.paymentUrl && trx.status === 'pending') {
    keyboard.push([{ text: '💳 Bayar Sekarang', url: trx.paymentUrl }]);
  }
  keyboard.push([{ text: '🔙 Kembali', callback_data: 'menu_transactions' }]);

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}

module.exports = {
  showTransactions,
  showTransactionDetail
};
