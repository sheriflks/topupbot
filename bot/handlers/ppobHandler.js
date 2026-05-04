/**
 * ppobHandler.js - Handler PPOB lengkap dengan inquiry postpaid
 * Kategori: Pulsa, Data, PLN, PDAM, Internet, TV, E-Wallet, Voucher, E-Toll, BPJS, Pendidikan
 */

const { usersDB, transactionsDB } = require('../utils/jsonDB');
const { generateOrderId, formatCurrency, chunkArray } = require('../utils/validator');
const { setUserState, clearUserState, getUserState } = require('./menuHandler');
const { getPPOBProducts, getAllPPOBCategories } = require('../services/productSync');
const vipReseller = require('../services/vipReseller');
const apiGames = require('../services/apiGames');
const { sendNotification, sendAdminAlert } = require('../services/whatsapp');
const logger = require('../utils/logger');
const config = require('../config/config.json');

// ─── Definisi Kategori PPOB ────────────────────────────────────────────────────

const PPOB_CATEGORIES = [
  { code: 'pulsa',        name: '📱 Pulsa',           icon: '📱', inputLabel: 'Nomor HP Tujuan',          isPostpaid: false },
  { code: 'data',         name: '📶 Paket Data',       icon: '📶', inputLabel: 'Nomor HP Tujuan',          isPostpaid: false },
  { code: 'pln_prepaid',  name: '⚡ Token Listrik',    icon: '⚡', inputLabel: 'Nomor Meter / ID Pelanggan', isPostpaid: false },
  { code: 'pln_postpaid', name: '💡 Tagihan Listrik',  icon: '💡', inputLabel: 'ID Pelanggan PLN',         isPostpaid: true  },
  { code: 'pdam',         name: '💧 PDAM',             icon: '💧', inputLabel: 'ID Pelanggan PDAM',        isPostpaid: true  },
  { code: 'internet',     name: '📡 Internet',         icon: '📡', inputLabel: 'ID Pelanggan / Nomor HP',  isPostpaid: true  },
  { code: 'tv',           name: '📺 TV Kabel',         icon: '📺', inputLabel: 'ID Pelanggan',             isPostpaid: true  },
  { code: 'ewallet',      name: '💳 E-Wallet',         icon: '💳', inputLabel: 'Nomor HP / Akun',          isPostpaid: false },
  { code: 'voucher',      name: '🎮 Voucher Digital',  icon: '🎮', inputLabel: 'Email / Nomor HP',         isPostpaid: false },
  { code: 'etoll',        name: '🚗 E-Toll',           icon: '🚗', inputLabel: 'Nomor Kartu E-Toll',       isPostpaid: false },
  { code: 'bpjs',         name: '🏥 BPJS',             icon: '🏥', inputLabel: 'Nomor BPJS',               isPostpaid: true  },
  { code: 'pendidikan',   name: '🎓 Pendidikan',       icon: '🎓', inputLabel: 'Nomor VA / ID Siswa',      isPostpaid: true  },
  { code: 'lainnya',      name: '🔧 Lainnya',          icon: '🔧', inputLabel: 'ID Pelanggan',             isPostpaid: false }
];

// ─── Markup ────────────────────────────────────────────────────────────────────

function applyMarkup(price, isReseller) {
  const pct = isReseller ? config.markup.markup_reseller : config.markup.markup_user;
  return Math.ceil(price * (1 + pct / 100));
}

// ─── Menu Utama PPOB ───────────────────────────────────────────────────────────

async function showPPOBMenu(bot, chatId) {
  // Cek kategori yang punya produk aktif
  const activeCats = getAllPPOBCategories();

  // Tampilkan semua kategori (aktif atau tidak, user bisa coba)
  const rows = chunkArray(PPOB_CATEGORIES, 2).map(pair =>
    pair.map(cat => ({
      text: `${cat.icon} ${cat.name.replace(/^[^\s]+\s/, '')}${activeCats[cat.code] ? '' : ''}`,
      callback_data: `ppob_cat_${cat.code}`
    }))
  );
  rows.push([{ text: '🔙 Menu Utama', callback_data: 'back_main' }]);

  await bot.sendMessage(chatId,
    `⚡ *PPOB - Bayar & Beli*\n\n` +
    `Pilih kategori layanan:`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } }
  );
}

// ─── Pilih Kategori → Input Target ────────────────────────────────────────────

async function handleCategorySelect(bot, chatId, userId, catCode) {
  const cat = PPOB_CATEGORIES.find(c => c.code === catCode);
  if (!cat) return;

  const products = getPPOBProducts(catCode);

  if (products.length === 0) {
    await bot.sendMessage(chatId,
      `⚠️ Produk *${cat.name}* belum tersedia saat ini.\n\nCoba lagi nanti atau hubungi admin.`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'menu_ppob' }]] }
      }
    );
    return;
  }

  setUserState(userId, {
    flow: 'ppob',
    step: 'ppob_input_target',
    catCode,
    cat,
    products
  });

  await bot.sendMessage(chatId,
    `${cat.icon} *${cat.name}*\n\n` +
    `📝 Masukkan *${cat.inputLabel}*:`,
    { parse_mode: 'Markdown' }
  );
}

// ─── Input Target → Pilih Produk / Inquiry ────────────────────────────────────

async function handleTargetInput(bot, msg, state) {
  const userId = String(msg.from.id);
  const target = msg.text?.trim();
  if (!target) return;

  const { cat, products } = state;

  // Update state dengan target
  setUserState(userId, { ...state, step: 'ppob_select_product', target });

  if (cat.isPostpaid) {
    // Postpaid: perlu inquiry dulu
    await handlePostpaidInquiry(bot, msg.chat.id, userId, { ...state, target });
  } else {
    // Prepaid: langsung tampilkan produk
    await showProductList(bot, msg.chat.id, userId, { ...state, target, products });
  }
}

// ─── Inquiry Postpaid ──────────────────────────────────────────────────────────

async function handlePostpaidInquiry(bot, chatId, userId, state) {
  const { cat, target, products } = state;

  // Jika ada banyak produk (misal PDAM beda kota), tampilkan pilihan dulu
  if (products.length > 1 && !state.selectedProduct) {
    await showProductList(bot, chatId, userId, state);
    return;
  }

  const product = state.selectedProduct || products[0];
  if (!product) {
    await bot.sendMessage(chatId, '❌ Produk tidak ditemukan.');
    return;
  }

  const loadingMsg = await bot.sendMessage(chatId,
    `🔍 *Mengecek tagihan...*\n\n` +
    `${cat.icon} ${cat.name}\n` +
    `🎯 ID: \`${target}\`\n\n` +
    `Mohon tunggu...`,
    { parse_mode: 'Markdown' }
  );

  try {
    let inquiryResult;

    // Coba VIP Reseller dulu
    try {
      inquiryResult = await vipReseller.inquiry(product.code, target);
    } catch {
      inquiryResult = await apiGames.inquiry(product.code, target);
    }

    const isSuccess = inquiryResult?.status === 'success' ||
                      inquiryResult?.rc === '00' ||
                      inquiryResult?.code === '00';

    if (!isSuccess) {
      await bot.editMessageText(
        `❌ *Gagal cek tagihan*\n\n` +
        `ID: \`${target}\`\n` +
        `Pesan: ${inquiryResult?.message || 'ID tidak ditemukan'}\n\n` +
        `Pastikan ID pelanggan benar.`,
        {
          chat_id: chatId,
          message_id: loadingMsg.message_id,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'menu_ppob' }]] }
        }
      );
      return;
    }

    // Inquiry berhasil
    const user = usersDB.get(userId);
    const isReseller = user?.isReseller || false;
    const basePrice = parseInt(inquiryResult.amount || inquiryResult.tagihan || product.price || 0);
    const finalPrice = applyMarkup(basePrice, isReseller);

    const inquiryData = {
      name: inquiryResult.customer_name || inquiryResult.nama || '-',
      period: inquiryResult.period || inquiryResult.periode || '-',
      amount: basePrice,
      details: inquiryResult.details || inquiryResult.detail || ''
    };

    setUserState(userId, {
      ...state,
      step: 'ppob_confirm',
      selectedProduct: product,
      finalPrice,
      inquiryData
    });

    await bot.editMessageText(
      `📋 *DETAIL TAGIHAN*\n\n` +
      `${cat.icon} Layanan: *${cat.name}*\n` +
      `🎯 ID: \`${target}\`\n` +
      `👤 Nama: *${inquiryData.name}*\n` +
      `${inquiryData.period !== '-' ? `📅 Periode: *${inquiryData.period}*\n` : ''}` +
      `💰 Tagihan: *${formatCurrency(basePrice)}*\n` +
      `💳 Total Bayar: *${formatCurrency(finalPrice)}*\n\n` +
      `Pilih metode pembayaran:`,
      {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: buildPaymentKeyboard(user?.balance || 0, finalPrice)
      }
    );

  } catch (err) {
    logger.error('PPOBHandler', 'Inquiry error', { msg: err.message });
    await bot.editMessageText(
      `❌ *Gagal terhubung ke server*\n\nCoba lagi beberapa saat.`,
      {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'menu_ppob' }]] }
      }
    );
  }
}

// ─── Tampilkan Daftar Produk (Prepaid) ────────────────────────────────────────

async function showProductList(bot, chatId, userId, state) {
  const { cat, products, target } = state;
  const user = usersDB.get(userId);
  const isReseller = user?.isReseller || false;

  const rows = chunkArray(products.slice(0, 30), 2).map(pair =>
    pair.map(p => {
      const price = applyMarkup(p.price, isReseller);
      return {
        text: `${p.name} - ${formatCurrency(price)}`,
        callback_data: `ppob_prod_${p.code}`
      };
    })
  );
  rows.push([{ text: '🔙 Kembali', callback_data: 'menu_ppob' }]);

  await bot.sendMessage(chatId,
    `${cat.icon} *${cat.name}*\n` +
    `🎯 Tujuan: \`${target}\`\n\n` +
    `${isReseller ? '🏪 Harga Reseller' : '👤 Harga Member'}\n` +
    `Pilih produk:`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } }
  );
}

// ─── Pilih Produk (Prepaid) ────────────────────────────────────────────────────

async function handleProductSelect(bot, chatId, userId, productCode) {
  const state = getUserState(userId);
  if (!state) {
    await bot.sendMessage(chatId, '❌ Sesi habis. Mulai ulang dari menu PPOB.');
    return;
  }

  const { productsDB } = require('../utils/jsonDB');
  const { getProductByCode } = require('../services/productSync');

  let product = getProductByCode(productCode);
  if (!product) {
    product = state.products?.find(p => p.code === productCode);
  }

  if (!product) {
    await bot.sendMessage(chatId, '❌ Produk tidak ditemukan.');
    return;
  }

  const user = usersDB.get(userId);
  const isReseller = user?.isReseller || false;
  const finalPrice = applyMarkup(product.price, isReseller);

  if (state.cat?.isPostpaid) {
    // Postpaid: lakukan inquiry dengan produk yang dipilih
    setUserState(userId, { ...state, selectedProduct: product });
    await handlePostpaidInquiry(bot, chatId, userId, { ...state, selectedProduct: product });
    return;
  }

  // Prepaid: langsung konfirmasi
  setUserState(userId, { ...state, step: 'ppob_confirm', selectedProduct: product, finalPrice });

  await bot.sendMessage(chatId,
    `📋 *KONFIRMASI PPOB*\n\n` +
    `${state.cat.icon} Produk: *${product.name}*\n` +
    `🎯 Tujuan: \`${state.target}\`\n` +
    `💰 Harga: *${formatCurrency(finalPrice)}*\n` +
    `💳 Saldo Anda: *${formatCurrency(user?.balance || 0)}*\n\n` +
    `Pilih metode pembayaran:`,
    {
      parse_mode: 'Markdown',
      reply_markup: buildPaymentKeyboard(user?.balance || 0, finalPrice)
    }
  );
}

// ─── Proses Pembayaran ─────────────────────────────────────────────────────────

async function processPPOBPayment(bot, chatId, userId, paymentMethod) {
  const state = getUserState(userId);
  if (!state || !state.selectedProduct) {
    await bot.sendMessage(chatId, '❌ Sesi habis. Silakan mulai ulang.');
    return;
  }

  const user = usersDB.get(userId);
  const orderId = generateOrderId('PPOB');
  const { selectedProduct: product, finalPrice, target, cat, inquiryData } = state;

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

    // Kurangi saldo
    usersDB.update(userId, {
      balance: user.balance - finalPrice,
      totalTransactions: (user.totalTransactions || 0) + 1
    });

    // Simpan transaksi
    const trx = buildTransaction(orderId, userId, product, target, finalPrice, 'balance', cat, inquiryData);
    transactionsDB.set(orderId, { ...trx, status: 'processing' });

    await bot.sendMessage(chatId,
      `⏳ *Memproses...*\n\nOrder: \`${orderId}\`\nMohon tunggu...`,
      { parse_mode: 'Markdown' }
    );

    await executePPOBOrder(bot, chatId, userId, orderId, state);

  } else if (paymentMethod === 'midtrans') {
    await createMidtransPayment(bot, chatId, userId, orderId, state, user);

  } else if (paymentMethod === 'pakasir') {
    await createPakasirPayment(bot, chatId, userId, orderId, state, user);
  }
}

// ─── Eksekusi Order ke API ─────────────────────────────────────────────────────

async function executePPOBOrder(bot, chatId, userId, orderId, state) {
  const { selectedProduct: product, target, finalPrice, cat } = state;

  try {
    let result;
    try {
      result = await vipReseller.createOrder({
        orderId,
        productCode: product.originalCode || product.code,
        target
      });
    } catch {
      result = await apiGames.createOrder({
        orderId,
        productCode: product.originalCode || product.code,
        target
      });
    }

    const ok = result?.status === 'success' || result?.rc === '00' || result?.code === '00';

    transactionsDB.update(orderId, {
      status: ok ? 'success' : 'failed',
      apiResponse: result,
      processedAt: new Date().toISOString()
    });

    if (ok) {
      const sn = result.sn || result.serial_number || result.token || '-';
      await bot.sendMessage(chatId,
        `✅ *PPOB BERHASIL!*\n\n` +
        `${cat.icon} Produk: *${product.name}*\n` +
        `🎯 Tujuan: \`${target}\`\n` +
        `Order ID: \`${orderId}\`\n` +
        `${sn !== '-' ? `🔑 SN/Token: \`${sn}\`\n` : ''}` +
        `Status: ✅ Sukses\n\n` +
        `Terima kasih! 🎉`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'back_main' }]] }
        }
      );

      const user = usersDB.get(userId);
      if (user?.phone) {
        await sendNotification(user.phone,
          `✅ PPOB BERHASIL\n${cat.icon} ${product.name}\nTujuan: ${target}\nOrder: ${orderId}${sn !== '-' ? `\nToken: ${sn}` : ''}`
        );
      }
    } else {
      // Refund
      const user = usersDB.get(userId);
      usersDB.update(userId, {
        balance: (user?.balance || 0) + finalPrice,
        totalTransactions: Math.max(0, (user?.totalTransactions || 1) - 1)
      });

      await bot.sendMessage(chatId,
        `❌ *PPOB GAGAL*\n\nOrder: \`${orderId}\`\nSaldo dikembalikan.\n\n` +
        `Pesan: ${result?.message || 'Transaksi gagal'}`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'back_main' }]] }
        }
      );

      await sendAdminAlert(`❌ PPOB GAGAL\nOrder: ${orderId}\nUser: ${userId}\nProduk: ${product.name}\nTujuan: ${target}`);
    }
  } catch (err) {
    logger.error('PPOBHandler', 'executePPOBOrder error', { msg: err.message, orderId });
    const user = usersDB.get(userId);
    usersDB.update(userId, { balance: (user?.balance || 0) + finalPrice });
    transactionsDB.update(orderId, { status: 'failed', error: err.message });
    await bot.sendMessage(chatId,
      `❌ *Kesalahan sistem*\n\nSaldo dikembalikan. Hubungi admin jika masalah berlanjut.`,
      { parse_mode: 'Markdown' }
    );
  }
}

// ─── Midtrans Payment ──────────────────────────────────────────────────────────

async function createMidtransPayment(bot, chatId, userId, orderId, state, user) {
  const midtrans = require('../services/midtrans');
  const { selectedProduct: product, finalPrice, target, cat } = state;

  try {
    const result = await midtrans.createSnapTransaction({
      orderId,
      amount: finalPrice,
      customerName: user.name,
      customerPhone: user.phone,
      itemDetails: [{ id: product.code, price: finalPrice, quantity: 1, name: product.name }]
    });

    transactionsDB.set(orderId, {
      ...buildTransaction(orderId, userId, product, target, finalPrice, 'midtrans', cat),
      paymentUrl: result.redirect_url,
      paymentToken: result.token,
      status: 'pending'
    });

    await bot.sendMessage(chatId,
      `💳 *Pembayaran Midtrans*\n\n` +
      `${cat.icon} ${product.name}\n` +
      `🎯 Tujuan: \`${target}\`\n` +
      `💰 Total: *${formatCurrency(finalPrice)}*\n\n` +
      `Selesaikan pembayaran sebelum expired:`,
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
}

// ─── Pakasir Payment ───────────────────────────────────────────────────────────

async function createPakasirPayment(bot, chatId, userId, orderId, state, user) {
  const pakasir = require('../services/pakasir');
  const { selectedProduct: product, finalPrice, target, cat } = state;

  try {
    const result = await pakasir.createInvoice({
      orderId,
      amount: finalPrice,
      customerName: user.name,
      customerPhone: user.phone,
      description: `PPOB ${product.name} - ${target}`
    });

    transactionsDB.set(orderId, {
      ...buildTransaction(orderId, userId, product, target, finalPrice, 'pakasir', cat),
      invoiceId: result.invoiceId,
      paymentUrl: result.paymentUrl,
      status: 'pending'
    });

    await bot.sendMessage(chatId,
      `🏦 *Pembayaran Pakasir*\n\n` +
      `${cat.icon} ${product.name}\n` +
      `🎯 Tujuan: \`${target}\`\n` +
      `💰 Total: *${formatCurrency(finalPrice)}*\n\n` +
      `Selesaikan pembayaran:`,
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
  } catch (err) {
    await bot.sendMessage(chatId, `❌ Gagal buat invoice: ${err.message}`);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildPaymentKeyboard(balance, price) {
  return {
    inline_keyboard: [
      [{ text: `💰 Bayar Saldo (${formatCurrency(balance)})`, callback_data: 'ppob_pay_balance' }],
      [{ text: '💳 Midtrans (Transfer/QRIS/dll)', callback_data: 'ppob_pay_midtrans' }],
      [{ text: '🏦 Pakasir', callback_data: 'ppob_pay_pakasir' }],
      [{ text: '❌ Batal', callback_data: 'back_main' }]
    ]
  };
}

function buildTransaction(orderId, userId, product, target, amount, paymentMethod, cat, inquiryData = null) {
  return {
    id: orderId,
    userId,
    type: 'ppob',
    category: cat?.code || 'ppob',
    categoryName: cat?.name || 'PPOB',
    product: { code: product.code, name: product.name },
    target,
    amount,
    paymentMethod,
    inquiryData,
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  showPPOBMenu,
  handleCategorySelect,
  handleTargetInput,
  handleProductSelect,
  processPPOBPayment,
  executePPOBOrder,
  PPOB_CATEGORIES
};
