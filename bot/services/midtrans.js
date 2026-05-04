const axios = require('axios');
const crypto = require('crypto');
const config = require('../config/config.json');
const logger = require('../utils/logger');

const SERVER_KEY = config.midtrans.server_key;
const IS_PRODUCTION = config.midtrans.is_production;

const BASE_URL = IS_PRODUCTION
  ? config.midtrans.base_url_production
  : config.midtrans.base_url_sandbox;

const SNAP_URL = IS_PRODUCTION
  ? config.midtrans.snap_url_production
  : config.midtrans.snap_url_sandbox;

function getAuthHeader() {
  const encoded = Buffer.from(`${SERVER_KEY}:`).toString('base64');
  return `Basic ${encoded}`;
}

async function createSnapTransaction(params) {
  const { orderId, amount, customerName, customerEmail, customerPhone, itemDetails } = params;

  const payload = {
    transaction_details: {
      order_id: orderId,
      gross_amount: amount
    },
    customer_details: {
      first_name: customerName,
      email: customerEmail || `${orderId}@topupbot.id`,
      phone: customerPhone
    },
    item_details: itemDetails || [
      {
        id: orderId,
        price: amount,
        quantity: 1,
        name: 'Deposit Saldo'
      }
    ],
    callbacks: {
      finish: `${config.webhook.base_url}/payment/finish`,
      error: `${config.webhook.base_url}/payment/error`,
      pending: `${config.webhook.base_url}/payment/pending`
    }
  };

  try {
    const response = await axios.post(`${SNAP_URL}/transactions`, payload, {
      headers: {
        'Authorization': getAuthHeader(),
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    logger.info('Midtrans', 'Snap transaction created', { orderId, amount });
    return {
      success: true,
      token: response.data.token,
      redirect_url: response.data.redirect_url,
      orderId
    };
  } catch (err) {
    logger.error('Midtrans', 'Gagal buat Snap transaction', {
      error: err.response?.data || err.message,
      orderId
    });
    throw new Error(err.response?.data?.error_messages?.[0] || 'Gagal membuat transaksi Midtrans');
  }
}

async function createCoreTransaction(params) {
  const { orderId, amount, paymentType, customerName, customerPhone } = params;

  const payload = {
    payment_type: paymentType || 'bank_transfer',
    transaction_details: {
      order_id: orderId,
      gross_amount: amount
    },
    customer_details: {
      first_name: customerName,
      phone: customerPhone
    }
  };

  if (paymentType === 'bank_transfer') {
    payload.bank_transfer = { bank: 'bca' };
  } else if (paymentType === 'gopay') {
    payload.gopay = { enable_callback: true };
  } else if (paymentType === 'qris') {
    payload.qris = { acquirer: 'gopay' };
  }

  try {
    const response = await axios.post(`${BASE_URL}/v2/charge`, payload, {
      headers: {
        'Authorization': getAuthHeader(),
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    logger.info('Midtrans', 'Core transaction created', { orderId, paymentType });
    return {
      success: true,
      data: response.data,
      orderId
    };
  } catch (err) {
    logger.error('Midtrans', 'Gagal buat Core transaction', {
      error: err.response?.data || err.message
    });
    throw new Error('Gagal membuat transaksi Midtrans Core');
  }
}

async function checkTransactionStatus(orderId) {
  try {
    const response = await axios.get(`${BASE_URL}/v2/${orderId}/status`, {
      headers: { 'Authorization': getAuthHeader() },
      timeout: 10000
    });
    return response.data;
  } catch (err) {
    logger.error('Midtrans', 'Gagal cek status transaksi', { error: err.message, orderId });
    throw err;
  }
}

function verifyWebhookSignature(orderId, statusCode, grossAmount, serverKey, signatureKey) {
  const hash = crypto.createHash('sha512')
    .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
    .digest('hex');
  return hash === signatureKey;
}

function processWebhookNotification(notification) {
  const {
    order_id,
    transaction_status,
    fraud_status,
    gross_amount,
    signature_key,
    status_code
  } = notification;

  const isValid = verifyWebhookSignature(
    order_id,
    status_code,
    gross_amount,
    SERVER_KEY,
    signature_key
  );

  if (!isValid) {
    logger.warn('Midtrans', 'Signature webhook tidak valid', { order_id });
    return { valid: false };
  }

  let status = 'pending';
  if (transaction_status === 'settlement' || transaction_status === 'capture') {
    if (fraud_status === 'accept' || !fraud_status) {
      status = 'success';
    } else {
      status = 'failed';
    }
  } else if (transaction_status === 'expire' || transaction_status === 'cancel' || transaction_status === 'deny') {
    status = 'failed';
  }

  return {
    valid: true,
    orderId: order_id,
    status,
    amount: parseInt(gross_amount),
    rawStatus: transaction_status
  };
}

module.exports = {
  createSnapTransaction,
  createCoreTransaction,
  checkTransactionStatus,
  processWebhookNotification,
  verifyWebhookSignature
};
