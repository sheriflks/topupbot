/**
 * pakasir.js - Integrasi Pakasir Payment Gateway
 * Docs  : https://pakasir.com/p/docs
 * Base  : https://app.pakasir.com
 *
 * Dua cara integrasi:
 *   1. Via URL  → redirect user ke halaman bayar Pakasir (paling simpel)
 *   2. Via API  → buat transaksi, dapat QR string / VA number
 *
 * Auth  : api_key + project (slug) dikirim di body POST / query GET
 * Webhook: POST dari Pakasir saat pembayaran selesai
 *   Body: { amount, order_id, project, status:"completed", payment_method, completed_at }
 */

'use strict';

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const logger = require('../utils/logger');

const BASE_URL = 'https://app.pakasir.com';

// ─── Baca config fresh (support update via admin panel) ───────────────────────
function getCfg() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/config.json'), 'utf8'));
  } catch {
    return require('../config/config.json');
  }
}

// ─── HTTP Helper ──────────────────────────────────────────────────────────────
async function httpPost(endpoint, body) {
  try {
    const res = await axios.post(`${BASE_URL}${endpoint}`, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000
    });
    return res.data;
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    logger.error('Pakasir', `POST ${endpoint} gagal`, { msg });
    throw new Error(msg);
  }
}

async function httpGet(endpoint, params) {
  try {
    const res = await axios.get(`${BASE_URL}${endpoint}`, {
      params,
      timeout: 15000
    });
    return res.data;
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    logger.error('Pakasir', `GET ${endpoint} gagal`, { msg });
    throw new Error(msg);
  }
}

// ─── A. Integrasi Via URL (paling simpel, tidak perlu API) ────────────────────
/**
 * Generate URL pembayaran Pakasir
 * User tinggal diklik ke URL ini → bayar di halaman Pakasir
 *
 * @param {string} orderId  - ID order unik
 * @param {number} amount   - Nominal (tanpa titik/spasi)
 * @param {string} redirect - URL redirect setelah bayar (opsional)
 * @param {boolean} qrisOnly - Paksa QRIS saja (opsional)
 */
function generatePaymentUrl(orderId, amount, redirect = null, qrisOnly = false) {
  const cfg = getCfg().pakasir;
  const slug = cfg.project || cfg.slug || cfg.merchant_id || '';
  if (!slug) throw new Error('Pakasir project slug belum diisi di config. Buka /admin → API Keys → Pakasir Project.');
  let url = `${BASE_URL}/pay/${slug}/${amount}?order_id=${orderId}`;
  if (redirect) url += `&redirect=${encodeURIComponent(redirect)}`;
  if (qrisOnly) url += `&qris_only=1`;
  return url;
}

// ─── B. Integrasi Via API ─────────────────────────────────────────────────────
/**
 * Buat transaksi via API — dapat QR string / VA number
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {number} params.amount
 * @param {string} params.method  - 'qris' | 'bri_va' | 'bni_va' | 'bca_va' | dll
 *
 * Response: {
 *   payment: {
 *     project, order_id, amount, fee, total_payment,
 *     payment_method, payment_number, expired_at
 *   }
 * }
 */
async function createTransaction({ orderId, amount, method = 'qris' }) {
  const cfg = getCfg().pakasir;
  const project = cfg.project || cfg.slug || cfg.merchant_id || '';
  const api_key = cfg.api_key;

  const body = {
    project,
    order_id: orderId,
    amount:   parseInt(amount),
    api_key
  };

  const res = await httpPost(`/api/transactioncreate/${method}`, body);

  if (!res?.payment) {
    throw new Error(res?.message || 'Gagal membuat transaksi Pakasir');
  }

  logger.info('Pakasir', 'Transaksi dibuat', { orderId, amount, method });

  return {
    success:       true,
    orderId,
    method,
    paymentNumber: res.payment.payment_number,  // QR string atau nomor VA
    amount:        res.payment.amount,
    fee:           res.payment.fee,
    totalPayment:  res.payment.total_payment,
    expiredAt:     res.payment.expired_at,
    // URL redirect untuk user (via URL method sebagai fallback)
    paymentUrl:    generatePaymentUrl(orderId, amount)
  };
}

// ─── C. Cek Status Transaksi ──────────────────────────────────────────────────
/**
 * GET /api/transactiondetail?project=...&amount=...&order_id=...&api_key=...
 *
 * Response: {
 *   transaction: { amount, order_id, project, status, payment_method, completed_at }
 * }
 * status: "completed" | "pending" | "expired" | "cancelled"
 */
async function checkTransaction(orderId, amount) {
  const cfg = getCfg().pakasir;
  const project = cfg.project || cfg.slug || cfg.merchant_id || '';
  const api_key = cfg.api_key;

  const res = await httpGet('/api/transactiondetail', {
    project,
    amount:   parseInt(amount),
    order_id: orderId,
    api_key
  });

  return res; // { transaction: { status, ... } }
}

// ─── D. Cancel Transaksi ──────────────────────────────────────────────────────
async function cancelTransaction(orderId, amount) {
  const cfg = getCfg().pakasir;
  const project = cfg.project || cfg.slug || cfg.merchant_id || '';
  const api_key = cfg.api_key;

  const res = await httpPost('/api/transactioncancel', {
    project,
    order_id: orderId,
    amount:   parseInt(amount),
    api_key
  });

  return res;
}

// ─── E. Payment Simulation (Sandbox) ─────────────────────────────────────────
async function simulatePayment(orderId, amount) {
  const cfg = getCfg().pakasir;
  const project = cfg.project || cfg.slug || cfg.merchant_id || '';
  const api_key = cfg.api_key;

  const res = await httpPost('/api/paymentsimulation', {
    project,
    order_id: orderId,
    amount:   parseInt(amount),
    api_key
  });

  return res;
}

// ─── F. Proses Webhook dari Pakasir ──────────────────────────────────────────
/**
 * Pakasir mengirim POST ke webhook URL saat pembayaran selesai
 * Body: { amount, order_id, project, status:"completed", payment_method, completed_at }
 *
 * PENTING: Validasi amount + order_id dengan data di DB kita
 */
function processWebhook(body, storedTransaction) {
  const { amount, order_id, project, status } = body;
  const cfg = getCfg().pakasir;
  const cfgProject = cfg.project || cfg.slug || cfg.merchant_id || '';

  // Validasi project
  if (cfgProject && project !== cfgProject) {
    logger.warn('Pakasir', 'Webhook project tidak cocok', { received: project, expected: cfgProject });
    return { valid: false, reason: 'project mismatch' };
  }

  // Validasi amount & order_id dengan data di DB
  if (storedTransaction) {
    if (parseInt(amount) !== parseInt(storedTransaction.amount)) {
      logger.warn('Pakasir', 'Webhook amount tidak cocok', { received: amount, stored: storedTransaction.amount });
      return { valid: false, reason: 'amount mismatch' };
    }
  }

  const isCompleted = status === 'completed';

  return {
    valid:   true,
    orderId: order_id,
    status:  isCompleted ? 'success' : 'pending',
    amount:  parseInt(amount),
    rawStatus: status,
    paymentMethod: body.payment_method,
    completedAt:   body.completed_at
  };
}

// ─── G. Daftar Payment Method ─────────────────────────────────────────────────
const PAYMENT_METHODS = [
  { code: 'qris',           name: 'QRIS'              },
  { code: 'bri_va',         name: 'BRI Virtual Account' },
  { code: 'bni_va',         name: 'BNI Virtual Account' },
  { code: 'bca_va',         name: 'BCA Virtual Account' },
  { code: 'cimb_niaga_va',  name: 'CIMB Niaga VA'     },
  { code: 'sampoerna_va',   name: 'Sampoerna VA'       },
  { code: 'bnc_va',         name: 'BNC VA'             },
  { code: 'maybank_va',     name: 'Maybank VA'         },
  { code: 'permata_va',     name: 'Permata VA'         },
  { code: 'atm_bersama_va', name: 'ATM Bersama VA'     },
  { code: 'artha_graha_va', name: 'Artha Graha VA'     }
];

module.exports = {
  generatePaymentUrl,
  createTransaction,
  checkTransaction,
  cancelTransaction,
  simulatePayment,
  processWebhook,
  PAYMENT_METHODS
};
