/**
 * apiGames.js - Integrasi API Games (fallback / alternatif)
 * Docs: https://api.apigames.id
 */

const axios = require('axios');
const crypto = require('crypto');
const config = require('../config/config.json');
const logger = require('../utils/logger');

const BASE_URL   = config.api_games.base_url;
const API_KEY    = config.api_games.api_key;
const SECRET_KEY = config.api_games.secret_key;

// ─── Auth ──────────────────────────────────────────────────────────────────────

function makeHeaders() {
  const ts   = Date.now().toString();
  const sign = crypto.createHmac('sha256', SECRET_KEY).update(`${API_KEY}${ts}`).digest('hex');
  return {
    'Content-Type': 'application/json',
    'X-Api-Key': API_KEY,
    'X-Timestamp': ts,
    'X-Signature': sign
  };
}

// ─── Base Request ──────────────────────────────────────────────────────────────

async function get(endpoint, params = {}) {
  try {
    const res = await axios.get(`${BASE_URL}/${endpoint}`, {
      params, headers: makeHeaders(), timeout: 20000
    });
    return res.data;
  } catch (err) {
    logger.error('ApiGames', `GET /${endpoint} gagal`, { msg: err.message });
    throw err;
  }
}

async function post(endpoint, body = {}) {
  try {
    const res = await axios.post(`${BASE_URL}/${endpoint}`, body, {
      headers: makeHeaders(), timeout: 20000
    });
    return res.data;
  } catch (err) {
    logger.error('ApiGames', `POST /${endpoint} gagal`, { msg: err.message });
    throw err;
  }
}

// ─── Products ──────────────────────────────────────────────────────────────────

async function getAllProducts() {
  try {
    const res = await get('products');
    return res.data || res.products || [];
  } catch { return []; }
}

async function getGameProducts(gameCode) {
  try {
    const res = await get(`products/game/${gameCode}`);
    return res.data || res.products || [];
  } catch { return []; }
}

async function getPPOBProducts(category) {
  try {
    const res = await get(`products/ppob/${category}`);
    return res.data || res.products || [];
  } catch { return []; }
}

// ─── Inquiry ───────────────────────────────────────────────────────────────────

async function inquiry(productCode, target) {
  try {
    const res = await post('inquiry', { product_code: productCode, target });
    return res;
  } catch (err) {
    logger.error('ApiGames', 'Inquiry gagal', { productCode, target, msg: err.message });
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

async function checkStatus(orderId) {
  const res = await get(`order/${orderId}`);
  return res;
}

// ─── Sync ke productsDB ────────────────────────────────────────────────────────

async function syncAllProducts() {
  const { productsDB } = require('../utils/jsonDB');
  const { detectCategory, detectSubCategory } = require('./vipReseller');
  logger.info('ApiGames', 'Mulai sync produk dari API Games...');

  const allRaw = await getAllProducts();
  if (!allRaw.length) {
    logger.warn('ApiGames', 'Tidak ada produk dari API Games');
    return { synced: 0, source: 'api_games' };
  }

  let synced = 0;
  const db = productsDB.read();

  for (const p of allRaw) {
    const code = `AG_${p.code || p.id}`;
    if (!code) continue;

    const cat    = detectCategory(p);
    const subCat = detectSubCategory(p);
    const isGame = cat === 'game';

    const entry = {
      code,
      originalCode: p.code || p.id,
      name: p.name || code,
      category: cat,
      subCategory: subCat,
      game: p.game || '',
      gameCode: p.game_code || '',
      price: parseInt(p.price || 0),
      status: (p.status || 'active').toLowerCase() === 'active' ? 'active' : 'inactive',
      isPostpaid: p.is_postpaid === true || false,
      needServer: p.need_server === true || false,
      description: p.description || '',
      source: 'api_games',
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
    sync_source: 'api_games'
  };

  productsDB.write(db);
  logger.info('ApiGames', `Sync selesai: ${synced} produk`);
  return { synced, source: 'api_games' };
}

module.exports = {
  getAllProducts,
  getGameProducts,
  getPPOBProducts,
  inquiry,
  createOrder,
  checkStatus,
  syncAllProducts
};
