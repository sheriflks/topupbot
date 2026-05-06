/**
 * vipReseller.js - Integrasi VIP Reseller API
 * Docs: https://vip-reseller.co.id/api
 */

const axios = require('axios');
const crypto = require('crypto');
const config = require('../config/config.json');
const logger = require('../utils/logger');

const BASE_URL = config.vip_reseller.base_url;
const API_KEY  = config.vip_reseller.api_key;
const MEMBER_ID = config.vip_reseller.member_id;
const PIN = config.vip_reseller.pin || '';

// ─── Signature ─────────────────────────────────────────────────────────────────

function makeSign() {
  return crypto.createHash('md5').update(MEMBER_ID + API_KEY).digest('hex');
}

// ─── Base Request ──────────────────────────────────────────────────────────────

async function post(endpoint, extra = {}) {
  const payload = {
    member_id: MEMBER_ID,
    signature: makeSign(),
    ...extra
  };
  try {
    const res = await axios.post(`${BASE_URL}/${endpoint}`, payload, {
      timeout: 20000,
      headers: { 'Content-Type': 'application/json' }
    });
    return res.data;
  } catch (err) {
    logger.error('VipReseller', `POST /${endpoint} gagal`, { msg: err.message });
    throw err;
  }
}

// ─── Products ──────────────────────────────────────────────────────────────────

/**
 * Ambil semua produk dari VIP Reseller
 * @param {string} type - 'game' | 'ppob' | '' (semua)
 */
async function getProducts(type = '') {
  try {
    const params = type ? { type } : {};
    const res = await post('prepaid', params); // VIP Reseller v2 biasanya pakai 'prepaid' untuk list produk
    if (res.status === 'success' || res.rc === '00' || res.status === true) {
      return Array.isArray(res.data) ? res.data : (res.products || []);
    }
    
    // Jika masih gagal, coba endpoint 'game' atau 'ppob' secara spesifik jika type kosong
    if (!type) {
      const gameRes = await post('prepaid', { type: 'game' });
      const ppobRes = await post('prepaid', { type: 'ppob' });
      let combined = [];
      if (gameRes.data) combined = combined.concat(gameRes.data);
      if (ppobRes.data) combined = combined.concat(ppobRes.data);
      return combined;
    }

    logger.warn('VipReseller', 'getProducts: status bukan success', { rc: res.rc, msg: res.message });
    return [];
  } catch (err) {
    // Terakhir coba endpoint 'product' (v1)
    try {
      const res = await post('product', type ? { type } : {});
      return Array.isArray(res.data) ? res.data : [];
    } catch {
      return [];
    }
  }
}

/**
 * Ambil produk PPOB berdasarkan kategori
 */
async function getPPOBProducts(category) {
  try {
    const res = await post('product', { type: 'ppob', category });
    if (res.status === 'success' || res.rc === '00') {
      return Array.isArray(res.data) ? res.data : [];
    }
    return [];
  } catch {
    return [];
  }
}

// ─── Inquiry (Cek Tagihan Postpaid) ───────────────────────────────────────────

/**
 * Inquiry tagihan postpaid (PLN pascabayar, PDAM, dll)
 * @param {string} productCode - kode produk
 * @param {string} target - nomor meter / ID pelanggan
 */
async function inquiry(productCode, target) {
  try {
    const res = await post('inquiry', {
      product_code: productCode,
      target
    });
    return res;
  } catch (err) {
    logger.error('VipReseller', 'Inquiry gagal', { productCode, target, msg: err.message });
    throw err;
  }
}

// ─── Order ─────────────────────────────────────────────────────────────────────

async function createOrder({ orderId, productCode, target, server = '' }) {
  const res = await post('order', {
    order_id: orderId,
    product_code: productCode,
    target,
    server
  });
  return res;
}

// ─── Status ────────────────────────────────────────────────────────────────────

async function checkStatus(orderId) {
  const res = await post('status', { order_id: orderId });
  return res;
}

// ─── Balance ───────────────────────────────────────────────────────────────────

async function checkBalance() {
  const res = await post('balance');
  return res;
}

// ─── Sync ke productsDB ────────────────────────────────────────────────────────

async function syncAllProducts() {
  const { productsDB } = require('../utils/jsonDB');
  logger.info('VipReseller', 'Mulai sync semua produk...');

  const allRaw = await getProducts('');
  if (!allRaw.length) {
    logger.warn('VipReseller', 'Tidak ada produk dari API');
    return { synced: 0, source: 'vip_reseller' };
  }

  let synced = 0;
  const db = productsDB.read();

  for (const p of allRaw) {
    const code = p.product_code || p.code;
    if (!code) continue;

    const cat = detectCategory(p);
    const subCat = detectSubCategory(p);
    const isGame = cat === 'game';

    const entry = {
      code,
      name: p.product_name || p.name || code,
      category: cat,
      subCategory: subCat,
      game: p.game_name || p.game || '',
      gameCode: p.game_code || '',
      price: parseInt(p.price || p.harga || 0),
      status: (p.status || 'active').toLowerCase() === 'active' ? 'active' : 'inactive',
      isPostpaid: p.type === 'postpaid' || p.is_postpaid === true || false,
      needServer: p.need_server === true || p.server_required === true || false,
      description: p.description || '',
      source: 'vip_reseller',
      updatedAt: new Date().toISOString()
    };

    if (isGame) {
      if (!db.game) db.game = {};
      db.game[code] = entry;
    } else {
      if (!db.ppob) db.ppob = {};
      if (!db.ppob[subCat]) db.ppob[subCat] = {};
      db.ppob[subCat][code] = entry;
    }
    synced++;
  }

  db._meta = {
    last_sync: new Date().toISOString(),
    total_products: synced,
    sync_source: 'vip_reseller'
  };

  productsDB.write(db);
  logger.info('VipReseller', `Sync selesai: ${synced} produk`);
  return { synced, source: 'vip_reseller' };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function detectCategory(p) {
  const type = (p.type || p.category || '').toLowerCase();
  const name = (p.product_name || p.name || '').toLowerCase();
  if (type === 'game' || type === 'games') return 'game';
  if (type === 'ppob' || type === 'pulsa' || type === 'pln' || type === 'bpjs') return 'ppob';
  // Deteksi dari nama
  const gameKeywords = ['diamond', 'uc ', 'voucher game', 'free fire', 'mobile legend', 'pubg', 'genshin', 'valorant'];
  if (gameKeywords.some(k => name.includes(k))) return 'game';
  return 'ppob';
}

function detectSubCategory(p) {
  const type = (p.type || p.category || p.sub_category || '').toLowerCase();
  const code = (p.product_code || p.code || '').toLowerCase();
  const name = (p.product_name || p.name || '').toLowerCase();

  if (type === 'game' || type === 'games') return 'game';
  if (type === 'pulsa' || code.startsWith('pls') || name.includes('pulsa')) return 'pulsa';
  if (type === 'data' || code.startsWith('dat') || name.includes('paket data') || name.includes('gb')) return 'data';
  if (type === 'pln' || code.startsWith('pln') || name.includes('pln') || name.includes('listrik')) {
    return name.includes('pascabayar') || name.includes('postpaid') || type === 'postpaid' ? 'pln_postpaid' : 'pln_prepaid';
  }
  if (type === 'pdam' || code.startsWith('pdam') || name.includes('pdam') || name.includes('air')) return 'pdam';
  if (type === 'internet' || name.includes('indihome') || name.includes('biznet') || name.includes('firstmedia')) return 'internet';
  if (type === 'tv' || name.includes('tv') || name.includes('useetv') || name.includes('transvision')) return 'tv';
  if (type === 'ewallet' || name.includes('ovo') || name.includes('dana') || name.includes('gopay') || name.includes('shopeepay') || name.includes('linkaja')) return 'ewallet';
  if (type === 'voucher' || name.includes('google play') || name.includes('steam') || name.includes('itunes') || name.includes('netflix')) return 'voucher';
  if (type === 'etoll' || name.includes('e-toll') || name.includes('etoll') || name.includes('brizzi') || name.includes('flazz')) return 'etoll';
  if (type === 'bpjs' || code.startsWith('bpjs') || name.includes('bpjs')) return 'bpjs';
  if (type === 'pendidikan' || name.includes('spp') || name.includes('ukt') || name.includes('sekolah')) return 'pendidikan';
  return 'lainnya';
}

module.exports = {
  getProducts,
  getPPOBProducts,
  inquiry,
  createOrder,
  checkStatus,
  checkBalance,
  syncAllProducts,
  detectCategory,
  detectSubCategory
};
