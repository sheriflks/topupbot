const axios = require('axios');
const crypto = require('crypto');
const config = require('../config/config.json');
const logger = require('../utils/logger');

const BASE_URL = config.pakasir.base_url;
const API_KEY = config.pakasir.api_key;
const MERCHANT_ID = config.pakasir.merchant_id;

function generateSign(data) {
  const str = `${MERCHANT_ID}${data.order_id}${data.amount}${API_KEY}`;
  return crypto.createHash('md5').update(str).digest('hex');
}

async function createInvoice(params) {
  const { orderId, amount, customerName, customerPhone, description, expiredMinutes = 60 } = params;

  const payload = {
    merchant_id: MERCHANT_ID,
    order_id: orderId,
    amount: amount,
    customer_name: customerName,
    customer_phone: customerPhone,
    description: description || 'Deposit Saldo TopupBot',
    expired_time: expiredMinutes,
    callback_url: `${config.webhook.base_url}/webhook/pakasir`,
    return_url: `${config.webhook.base_url}/payment/finish`
  };

  payload.signature = generateSign(payload);

  try {
    const response = await axios.post(`${BASE_URL}/invoice/create`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': API_KEY
      },
      timeout: 15000
    });

    const data = response.data;

    if (data.status === 'success' || data.code === '00') {
      logger.info('Pakasir', 'Invoice berhasil dibuat', { orderId, amount });
      return {
        success: true,
        invoiceId: data.invoice_id || data.data?.invoice_id,
        paymentUrl: data.payment_url || data.data?.payment_url,
        qrCode: data.qr_code || data.data?.qr_code,
        expiredAt: data.expired_at || data.data?.expired_at,
        orderId
      };
    } else {
      throw new Error(data.message || 'Gagal membuat invoice Pakasir');
    }
  } catch (err) {
    logger.error('Pakasir', 'Gagal buat invoice', {
      error: err.response?.data || err.message,
      orderId
    });
    throw new Error(err.response?.data?.message || 'Gagal membuat invoice Pakasir');
  }
}

async function checkInvoiceStatus(invoiceId) {
  try {
    const response = await axios.get(`${BASE_URL}/invoice/status`, {
      params: {
        merchant_id: MERCHANT_ID,
        invoice_id: invoiceId
      },
      headers: {
        'X-Api-Key': API_KEY
      },
      timeout: 10000
    });

    return response.data;
  } catch (err) {
    logger.error('Pakasir', 'Gagal cek status invoice', { error: err.message, invoiceId });
    throw err;
  }
}

function processWebhookNotification(notification) {
  const { order_id, invoice_id, status, amount, signature } = notification;

  // Verify signature
  const expectedSign = crypto.createHash('md5')
    .update(`${MERCHANT_ID}${order_id}${amount}${API_KEY}`)
    .digest('hex');

  if (signature !== expectedSign) {
    logger.warn('Pakasir', 'Signature webhook tidak valid', { order_id });
    return { valid: false };
  }

  let paymentStatus = 'pending';
  if (status === 'paid' || status === 'success' || status === 'settlement') {
    paymentStatus = 'success';
  } else if (status === 'expired' || status === 'failed' || status === 'cancel') {
    paymentStatus = 'failed';
  }

  return {
    valid: true,
    orderId: order_id,
    invoiceId: invoice_id,
    status: paymentStatus,
    amount: parseInt(amount),
    rawStatus: status
  };
}

module.exports = {
  createInvoice,
  checkInvoiceStatus,
  processWebhookNotification
};
