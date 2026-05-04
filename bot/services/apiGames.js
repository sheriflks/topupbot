/**
 * apiGames.js - Integrasi API Games v2
 * Base URL  : https://v1.apigames.id
 * Auth      : md5(merchant_id:secret_key:ref_id) per transaksi
 *             md5(merchant_id:secret_key) untuk info akun
 * Docs      : https://docs.apigames.id
 */

'use strict';

const axios  = require('axios');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const logger = require('../utils/logger');

const BASE_URL = 'https://v1.apigames.id';

// ─── Baca config fresh setiap call (support update via admin panel) ────────────
function getCfg() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/config.json'), 'utf8'));
  } catch {
    return require('../config/config.json');
  }
}

// ─── Signature Helpers ─────────────────────────────────────────────────────────

/** md5(merchant_id:secret_key) — untuk info akun, cek koneksi */
function signBasic() {
  const { merchant_id, secret_key } = getCfg().api_games;
  return crypto.createHash('md5').update(`${merchant_id}:${secret_key}`).digest('hex');
}

/** md5(merchant_id:secret_key:ref_id) — untuk transaksi & cek status */
function signTrx(refId) {
  const { merchant_id, secret_key } = getCfg().api_games;
  return crypto.createHash('md5').update(`${merchant_id}:${secret_key}:${refId}`).digest('hex');
}

// ─── HTTP Helpers ──────────────────────────────────────────────────────────────

async function httpGet(endpoint, params = {}) {
  try {
    const res = await axios.get(`${BASE_URL}${endpoint}`, {
      params,
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000
    });
    return res.data;
  } catch (err) {
    logger.error('ApiGames', `GET ${endpoint} gagal`, { msg: err.message });
    throw err;
  }
}

async function httpPost(endpoint, body = {}) {
  try {
    const res = await axios.post(`${BASE_URL}${endpoint}`, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000
    });
    return res.data;
  } catch (err) {
    logger.error('ApiGames', `POST ${endpoint} gagal`, { msg: err.message });
    throw err;
  }
}

// ─── Info Akun ─────────────────────────────────────────────────────────────────
// GET /merchant/{merchant_id}?signature=md5(MERCHANT_ID:SECRET_KEY)

async function getAccountInfo() {
  const { merchant_id } = getCfg().api_games;
  const sig = signBasic();
  const res = await httpGet(`/merchant/${merchant_id}`, { signature: sig });
  return res; // { status, rc, message, data: { saldo, ... } }
}

// ─── Cek Username Game ─────────────────────────────────────────────────────────
// GET /merchant/{merchant_id}/cek-username/{game_code}?user_id=...&signature=...

async function checkUsername(gameCode, userId) {
  const { merchant_id } = getCfg().api_games;
  const sig = signBasic();
  const res = await httpGet(`/merchant/${merchant_id}/cek-username/${gameCode}`, {
    user_id: userId,
    signature: sig
  });
  // Response: { status, rc, data: { is_valid, username } }
  return res;
}

// ─── Transaksi (Order) — POST v2 ──────────────────────────────────────────────
// POST /v2/transaksi
// Body: { ref_id, merchant_id, produk, tujuan, server_id, signature }
// signature = md5(merchant_id:secret_key:ref_id)
// Response awal SELALU Pending — status final via webhook / cek status

async function createOrder({ orderId, productCode, target, server = '' }) {
  const { merchant_id } = getCfg().api_games;
  const sig = signTrx(orderId);

  const body = {
    ref_id:      orderId,
    merchant_id,
    produk:      productCode,
    tujuan:      target,
    server_id:   server || '',
    signature:   sig
  };

  const res = await httpPost('/v2/transaksi', body);
  // res.status === 1 → diterima (Pending)
  // res.status === 0 → error (signature, produk tidak ada, dll)
  return res;
}

// ─── Cek Status Transaksi — POST v2 ───────────────────────────────────────────
// POST /v2/transaksi/status
// Body: { ref_id, merchant_id, signature }
// signature = md5(merchant_id:secret_key:ref_id)

async function checkStatus(refId) {
  const { merchant_id } = getCfg().api_games;
  const sig = signTrx(refId);

  const res = await httpPost('/v2/transaksi/status', {
    ref_id:      refId,
    merchant_id,
    signature:   sig
  });
  return res;
  // res.data.status: "Pending" | "Sukses" | "Gagal" | "Proses" | "Sukses Sebagian" | "Validasi Provider"
}

// ─── Verifikasi Webhook dari APIGames ─────────────────────────────────────────
// Header: X-Apigames-Authorization = md5(merchant_id:secret_key:ref_id)

function verifyWebhook(headers, refId) {
  const { merchant_id, secret_key } = getCfg().api_games;
  const expected = crypto.createHash('md5')
    .update(`${merchant_id}:${secret_key}:${refId}`)
    .digest('hex');
  const received = headers['x-apigames-authorization'] || '';
  return received === expected;
}

// ─── Parse Status dari Webhook / Cek Status ───────────────────────────────────

function parseStatus(statusStr) {
  const s = (statusStr || '').toLowerCase();
  if (s === 'sukses' || s === 'sukses sebagian') return 'success';
  if (s === 'gagal') return 'failed';
  return 'pending'; // Pending, Proses, Validasi Provider → pending
}

// ─── Sync Produk ke productsDB ────────────────────────────────────────────────
// APIGames tidak punya endpoint list produk publik — produk dikelola manual
// atau diambil dari VIP Reseller. Fungsi ini sebagai placeholder.

async function syncAllProducts() {
  logger.info('ApiGames', 'APIGames tidak menyediakan endpoint list produk. Skip sync.');
  return { synced: 0, source: 'api_games' };
}

module.exports = {
  getAccountInfo,
  checkUsername,
  createOrder,
  checkStatus,
  verifyWebhook,
  parseStatus,
  syncAllProducts,
  signTrx,
  signBasic
};
