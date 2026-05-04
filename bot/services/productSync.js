/**
 * productSync.js - Auto sync produk dari API ke JSON database
 * Menggabungkan VIP Reseller + API Games, deduplikasi, dan schedule sync
 */

const logger = require('../utils/logger');
const config = require('../config/config.json');
const { productsDB } = require('../utils/jsonDB');
const vipReseller = require('./vipReseller');
const apiGames = require('./apiGames');

let syncTimer = null;

// ─── Sync Utama ────────────────────────────────────────────────────────────────

async function syncProducts() {
  logger.info('ProductSync', 'Memulai sinkronisasi produk...');

  let totalSynced = 0;

  // Coba VIP Reseller dulu
  try {
    const result = await vipReseller.syncAllProducts();
    totalSynced += result.synced;
    logger.info('ProductSync', `VIP Reseller: ${result.synced} produk`);
  } catch (err) {
    logger.warn('ProductSync', 'VIP Reseller sync gagal, coba API Games', { msg: err.message });
  }

  // Tambah dari API Games (merge, tidak overwrite yang sudah ada)
  try {
    const result = await apiGames.syncAllProducts();
    totalSynced += result.synced;
    logger.info('ProductSync', `API Games: ${result.synced} produk`);
  } catch (err) {
    logger.warn('ProductSync', 'API Games sync gagal', { msg: err.message });
  }

  // Update meta
  const db = productsDB.read();
  db._meta = {
    last_sync: new Date().toISOString(),
    total_products: totalSynced,
    sync_source: 'combined'
  };
  productsDB.write(db);

  logger.info('ProductSync', `Total sync: ${totalSynced} produk`);
  return totalSynced;
}

// ─── Schedule Auto Sync ────────────────────────────────────────────────────────

function startAutoSync() {
  if (!config.product_sync.auto_sync) return;

  const intervalMs = (config.product_sync.interval_hours || 6) * 60 * 60 * 1000;

  if (syncTimer) clearInterval(syncTimer);

  syncTimer = setInterval(async () => {
    logger.info('ProductSync', 'Auto sync terjadwal...');
    await syncProducts().catch(err =>
      logger.error('ProductSync', 'Auto sync error', { msg: err.message })
    );
  }, intervalMs);

  logger.info('ProductSync', `Auto sync aktif setiap ${config.product_sync.interval_hours} jam`);
}

function stopAutoSync() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

// ─── Get Products dari DB ──────────────────────────────────────────────────────

function getGameProducts(gameCode) {
  const db = productsDB.read();
  const games = db.game || {};
  return Object.values(games).filter(p =>
    p.status === 'active' &&
    (
      p.gameCode === gameCode ||
      p.game?.toLowerCase().includes(gameCode.toLowerCase()) ||
      p.code?.toUpperCase().startsWith(gameCode.toUpperCase())
    )
  );
}

function getPPOBProducts(subCategory) {
  const db = productsDB.read();
  const ppob = db.ppob || {};
  const cat = ppob[subCategory] || {};
  return Object.values(cat).filter(p => p.status === 'active');
}

function getAllPPOBCategories() {
  const db = productsDB.read();
  const ppob = db.ppob || {};
  const result = {};
  for (const [key, val] of Object.entries(ppob)) {
    const active = Object.values(val).filter(p => p.status === 'active');
    if (active.length > 0) result[key] = active.length;
  }
  return result;
}

function getProductByCode(code) {
  const db = productsDB.read();

  // Cari di game
  if (db.game && db.game[code]) return db.game[code];

  // Cari di semua ppob
  for (const cat of Object.values(db.ppob || {})) {
    if (cat[code]) return cat[code];
  }

  return null;
}

function getLastSyncInfo() {
  const db = productsDB.read();
  return db._meta || { last_sync: null, total_products: 0 };
}

module.exports = {
  syncProducts,
  startAutoSync,
  stopAutoSync,
  getGameProducts,
  getPPOBProducts,
  getAllPPOBCategories,
  getProductByCode,
  getLastSyncInfo
};
