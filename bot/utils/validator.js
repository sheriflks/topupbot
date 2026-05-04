/**
 * validator.js - Input validation, formatting, rate limiting
 */

const rateLimitMap = new Map();

// ─── Phone ─────────────────────────────────────────────────────────────────────

function validatePhone(phone) {
  if (!phone) return false;
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 9 || cleaned.length > 15) return false;
  return /^(0|62|\+62|8)/.test(cleaned);
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = '62' + cleaned.slice(1);
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
  if (!cleaned.startsWith('62') && cleaned.startsWith('8')) cleaned = '62' + cleaned;
  return cleaned;
}

// ─── Input ─────────────────────────────────────────────────────────────────────

function validateName(name) {
  return name && name.trim().length >= 2 && name.trim().length <= 60;
}

function validateAmount(amount) {
  const num = parseInt(amount);
  return !isNaN(num) && num > 0;
}

function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input.replace(/[<>"'&]/g, '').trim();
}

// ─── Rate Limit ────────────────────────────────────────────────────────────────

function rateLimit(userId, action, maxRequests = 5, windowMs = 60000) {
  const key = `${userId}:${action}`;
  const now = Date.now();
  if (!rateLimitMap.has(key)) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  const entry = rateLimitMap.get(key);
  if (now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  if (entry.count >= maxRequests) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count };
}

// ─── ID Generation ─────────────────────────────────────────────────────────────

function generateOrderId(prefix = 'TRX') {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

// ─── Formatting ────────────────────────────────────────────────────────────────

function formatCurrency(amount) {
  if (isNaN(amount)) return 'Rp 0';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0
  }).format(amount);
}

function formatDate(date) {
  return new Date(date).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatNumber(num) {
  return new Intl.NumberFormat('id-ID').format(num);
}

// ─── Chunk Array ───────────────────────────────────────────────────────────────

function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

module.exports = {
  validatePhone,
  normalizePhone,
  validateName,
  validateAmount,
  sanitizeInput,
  rateLimit,
  generateOrderId,
  formatCurrency,
  formatDate,
  formatNumber,
  chunkArray
};
