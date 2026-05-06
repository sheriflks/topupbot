"use strict";

const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");

// ===== FILES =====
const PAYMENT_CFG_FILE = path.join(process.cwd(), "payment.json");
const PAYMENT_DB_FILE = path.join(process.cwd(), "dbpayment.json");

// ===== DB =====
function loadPaymentDb() {
  try {
    if (!fs.existsSync(PAYMENT_DB_FILE)) {
      const init = { payments: {}, pending_topups: {} };
      fs.writeFileSync(PAYMENT_DB_FILE, JSON.stringify(init, null, 2), "utf-8");
      return init;
    }
    const db = JSON.parse(fs.readFileSync(PAYMENT_DB_FILE, "utf-8"));
    if (!db.payments) db.payments = {};
    if (!db.pending_topups) db.pending_topups = {};
    return db;
  } catch (e) {
    console.error("[dbpayment] load error:", e.message);
    return { payments: {}, pending_topups: {} };
  }
}

function savePaymentDb(data) {
  try {
    const tmp = PAYMENT_DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, PAYMENT_DB_FILE);
  } catch (e) {
    console.error("[dbpayment] save error:", e.message);
  }
}

// ===== CONFIG =====
function loadPaymentConfig(defaultBasePrice = 3000) {
  try {
    if (!fs.existsSync(PAYMENT_CFG_FILE)) {
      return {
        baseUrl: "https://eqris.com",
        auth_username: "",
        auth_token: "",
        tokenKey: "",
        storeName: "Toko PutraOfficial",
        basePrice: defaultBasePrice,
        randomMin: 1,
        randomMax: 97,
        timeoutMs: 5 * 60 * 1000,
        TZ_WIB: "Asia/Jakarta",
      };
    }
    const cfg = JSON.parse(fs.readFileSync(PAYMENT_CFG_FILE, "utf-8"));
    return {
      baseUrl: cfg.baseUrl || "https://eqris.com",
      auth_username: cfg.auth_username || "",
      auth_token: cfg.auth_token || "",
      tokenKey: cfg.tokenKey || "",
      storeName: cfg.storeName || "Toko PutraOfficial",
      basePrice: Number(cfg.basePrice || defaultBasePrice),
      randomMin: Number(cfg.randomMin || 1),
      randomMax: Number(cfg.randomMax || 97),
      timeoutMs: Number(cfg.timeoutMs || 5 * 60 * 1000),
      TZ_WIB: cfg.TZ_WIB || "Asia/Jakarta",
    };
  } catch {
    return {
      baseUrl: "https://eqris.com",
      auth_username: "",
      auth_token: "",
      tokenKey: "",
      storeName: "Toko PutraOfficial",
      basePrice: defaultBasePrice,
      randomMin: 1,
      randomMax: 97,
      timeoutMs: 5 * 60 * 1000,
      TZ_WIB: "Asia/Jakarta",
    };
  }
}

// ===== HELPERS =====
function refDeposit() {
  return "DEP" + Date.now() + Math.random().toString(36).slice(2, 7).toUpperCase();
}

function adminFeeRandom(min, max) {
  min = Math.ceil(Number(min));
  max = Math.floor(Number(max));
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    min = 1;
    max = 99;
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickUniqueAdminFee(dbPay, min = 1, max = 99) {
  const payments = dbPay?.payments || {};
  const pendingFees = new Set();
  for (const ref in payments) {
    const p = payments[ref];
    if (p?.status === "pending") pendingFees.add(Number(p.admin_fee));
  }
  for (let i = 0; i < 200; i++) {
    const v = adminFeeRandom(min, max);
    if (!pendingFees.has(v)) return v;
  }
  return adminFeeRandom(min, max);
}

function dataUrlToBuffer(dataUrl) {
  const raw = String(dataUrl || "");
  const base64 = raw.includes(",") ? raw.split(",").pop() : raw;
  return Buffer.from(base64, "base64");
}

async function apiPostOrkut(cfg, endpoint, body) {
  const baseUrl = String(cfg.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl || baseUrl.includes("DOMAIN-API-LU")) {
    throw new Error("baseUrl belum diset di payment.json");
  }
  if (!cfg.tokenKey) {
    throw new Error("tokenKey belum diset di payment.json");
  }
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "tokenKey": cfg.tokenKey,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Response API bukan JSON: ${text.slice(0, 120)}`);
  }

  if (!res.ok || json.status === false || json.success === false) {
    throw new Error(json.message || `API error ${res.status}`);
  }
  return json;
}

async function generateQrOrkut(cfg, nominal) {
  const json = await apiPostOrkut(cfg, "/api/qr-orkut-v2", {
    username_orkut: cfg.auth_username,
    token_orkut: cfg.auth_token,
    nominal: Number(nominal),
  });

  if (!json?.qris) {
    throw new Error("QRIS tidak diterima dari API");
  }

  return {
    qrBuffer: dataUrlToBuffer(json.qris),
    qrString: json.qrString || null,
    qris: json.qris,
  };
}

async function checkPaymentByMutasi(cfg, reference, totalPay) {
  const dbPay = loadPaymentDb();
  const tx = dbPay.payments?.[reference];
  if (!tx) return { success: false, reason: "TX_NOT_FOUND" };
  if (tx.status === "paid") return { success: true, paid: true, tx };
  if (tx.status === "canceled") return { success: false, reason: "CANCELED", tx };
  if (Date.now() > Number(tx.expires_at_ms || 0)) {
    tx.status = "expired";
    tx.expired_at = new Date().toISOString();
    savePaymentDb(dbPay);
    return { success: false, reason: "EXPIRED", tx };
  }

  try {
    const json = await apiPostOrkut(cfg, "/api/mutasi-orkut-v2", {
      username_orkut: cfg.auth_username,
      token_orkut: cfg.auth_token,
    });

    const list = Array.isArray(json.data) ? json.data : [];
    const targetAmount = Number(totalPay || tx.total_pay);
    const createdAt = new Date(tx.created_at).getTime();

    const found = list.find((m) => {
      const amount = Number(String(m.amount || "0").replace(/\D/g, ""));
      const type = String(m.type || "").toUpperCase();
      let trxTime = Date.now();
      if (m.date) {
        trxTime = moment.tz(String(m.date), "YYYY-MM-DD HH:mm", cfg.TZ_WIB).valueOf();
      }
      return (
        type === "CR" &&
        amount === targetAmount &&
        trxTime >= createdAt - 2 * 60 * 1000
      );
    });

    if (found) {
      tx.status = "paid";
      tx.paid_at = new Date().toISOString();
      tx.issuer_reff = found.issuer_reff || null;
      tx.buyer_reff = found.buyer_reff || null;
      tx.brand_name = found.brand_name || null;
      tx.qris_type = found.qris || null;
      tx.mutasi_date = found.date || null;
      savePaymentDb(dbPay);
      return { success: true, paid: true, tx };
    }
    return { success: true, paid: false, tx };
  } catch (e) {
    return { success: false, reason: e?.message || "CHECK_FAILED" };
  }
}

// ===== FACTORY =====
function createEngine({ basePrice = 3000 } = {}) {
  const cfg = loadPaymentConfig(basePrice);
  const timeoutMs = cfg.timeoutMs;

  async function createDeposit(userId, username, baseAmount) {
    const dbPay = loadPaymentDb();
    const adminFee = pickUniqueAdminFee(dbPay, cfg.randomMin, cfg.randomMax);
    const totalPay = Number(baseAmount) + adminFee;
    const reference = refDeposit();
    const expiresAtMs = Date.now() + timeoutMs;

    const { qrBuffer, qrString } = await generateQrOrkut(cfg, totalPay);

    dbPay.payments[reference] = {
      expires_at_ms: expiresAtMs,
      reference,
      user_id: String(userId),
      username: username || null,
      type: "deposit",
      base_amount: Number(baseAmount),
      admin_fee: adminFee,
      total_pay: totalPay,
      status: "pending",
      created_at: new Date().toISOString(),
      paid_at: null,
      expired_at: null,
      canceled_at: null,
      qrString,
    };

    dbPay.pending_topups[String(userId)] = {
      reference,
      expire_at: expiresAtMs,
    };

    savePaymentDb(dbPay);
    return { reference, adminFee, totalPay, qrBuffer, timeoutMs };
  }

  async function createOrder({ userId, username, baseAmount, meta = {} }) {
    const dbPay = loadPaymentDb();
    const adminFee = pickUniqueAdminFee(dbPay, cfg.randomMin, cfg.randomMax);
    const totalPay = Number(baseAmount) + adminFee;
    const reference = refDeposit();
    const expiresAtMs = Date.now() + timeoutMs;

    const { qrBuffer, qrString } = await generateQrOrkut(cfg, totalPay);

    dbPay.payments[reference] = {
      expires_at_ms: expiresAtMs,
      reference,
      user_id: String(userId),
      username: username || null,
      type: "order",
      base_amount: Number(baseAmount),
      admin_fee: adminFee,
      total_pay: totalPay,
      status: "pending",
      created_at: new Date().toISOString(),
      paid_at: null,
      expired_at: null,
      canceled_at: null,
      qrString,
      ...meta,
    };

    savePaymentDb(dbPay);
    return { reference, adminFee, totalPay, qrBuffer, timeoutMs };
  }

  async function cancel(reference, userId) {
    const dbPay = loadPaymentDb();
    const tx = dbPay.payments?.[reference];
    if (!tx) return { ok: false, reason: "TX_NOT_FOUND" };
    if (String(tx.user_id) !== String(userId)) return { ok: false, reason: "NOT_OWNER" };
    if (tx.status !== "pending") return { ok: false, reason: "NOT_PENDING" };

    tx.status = "canceled";
    tx.canceled_at = new Date().toISOString();

    if (dbPay.pending_topups?.[String(userId)]?.reference === reference) {
      delete dbPay.pending_topups[String(userId)];
    }

    savePaymentDb(dbPay);
    return { ok: true, tx };
  }

  async function checkBalance() {
    try {
      const json = await apiPostOrkut(cfg, "/api/cek-saldo-orkut", {
        username_orkut: cfg.auth_username,
        token_orkut: cfg.auth_token,
      });
      return json;
    } catch (e) {
      throw e;
    }
  }

  async function withdrawBalance(amount, destination, accountName, bankCode, source = 'orkut') {
    try {
      // Jika source adalah orkut, panggil API orkut
      if (source === 'orkut') {
        const json = await apiPostOrkut(cfg, "/api/withdraw-orkut", {
          username_orkut: cfg.auth_username,
          token_orkut: cfg.auth_token,
          amount: Number(amount),
          destination,
          account_name: accountName,
          bank_code: bankCode
        });
        return json;
      }
      
      // Jika source lain (pakasir/midtrans), saat ini kita anggap sebagai 'permintaan' 
      // karena API payout mereka lebih kompleks (perlu key Iris/Pakasir Payout)
      throw new Error(`Fitur withdraw otomatis via API ${source.toUpperCase()} belum dikonfigurasi. Silakan lakukan penarikan manual.`);
    } catch (e) {
      throw e;
    }
  }

  return {
    qris: null,
    timeoutMs,
    loadPaymentDb,
    savePaymentDb,
    createDeposit,
    createOrder,
    checkPayment: (reference, totalPay) => checkPaymentByMutasi(cfg, reference, totalPay),
    cancel,
    checkBalance,
    withdrawBalance,
  };
}

let _engine = null;
function getEngine() {
  if (!_engine) _engine = createEngine();
  return _engine;
}

module.exports = { getEngine, loadPaymentDb, savePaymentDb };
