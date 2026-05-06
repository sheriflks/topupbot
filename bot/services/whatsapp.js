/**
 * whatsapp.js - WhatsApp via Baileys
 * QR dikirim ke Telegram admin, bisa connect/disconnect dari bot
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast
} = require('@whiskeysockets/baileys');
const { Boom }  = require('@hapi/boom');
const pino      = require('pino');
const QRCode    = require('qrcode');
const path      = require('path');
const fs        = require('fs');
const logger    = require('../utils/logger');
const config    = require('../config/config.json');

const SESSION_PATH = path.resolve(config.whatsapp.session_path || './wa_session');

// ─── State ─────────────────────────────────────────────────────────────────────
let waSocket         = null;
let isConnected      = false;
let isConnecting     = false;
let qrMsgId          = null;
let telegramBot      = null;
let reconnectTimer   = null;
let reconnectCount   = 0;
const MAX_RECONNECT  = 10;
const RECONNECT_BASE = 5000;
const RECONNECT_MAX  = 120000;

// Anti-spam notif: max 1 notif per 30 detik
let lastNotifTime    = 0;
const NOTIF_COOLDOWN = 30000;

// ─── Connect ───────────────────────────────────────────────────────────────────

async function connectWhatsApp(bot) {
  if (isConnecting) {
    logger.warn('WhatsApp', 'Sudah dalam proses connecting...');
    return;
  }
  if (isConnected) {
    logger.info('WhatsApp', 'WA sudah terhubung');
    return;
  }

  if (bot) telegramBot = bot;
  isConnecting = true;

  if (!fs.existsSync(SESSION_PATH)) {
    fs.mkdirSync(SESSION_PATH, { recursive: true });
  }

  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version }          = await fetchLatestBaileysVersion();

    logger.info('WhatsApp', `Baileys v${version.join('.')}`);

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,   // QR dikirim ke Telegram, bukan terminal
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
      },
      generateHighQualityLinkPreview: false,
      shouldIgnoreJid: jid => isJidBroadcast(jid),
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      markOnlineOnConnect: false
    });

    waSocket = sock;

    // ── Connection Events ─────────────────────────────────────────────────────
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // QR muncul → kirim ke Telegram admin sebagai gambar
      if (qr) {
        logger.info('WhatsApp', 'QR Code baru diterima');
        await sendQRToTelegram(qr);
      }

      if (connection === 'close') {
        isConnected  = false;
        isConnecting = false;

        const code      = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;

        logger.warn('WhatsApp', 'Koneksi terputus', { code, loggedOut, reconnectCount });

        if (loggedOut) {
          // Logout permanen — notif sekali saja, hapus session, lalu diam
          logger.warn('WhatsApp', 'Logged out permanen');
          reconnectCount = 0;
          clearSession();
          // Hanya notif jika admin sedang aktif (ada qrMsgId = sedang proses connect)
          if (qrMsgId) {
            await notifyAdminTelegram('❌ *WhatsApp Logout!*\n\nSilakan connect ulang via /admin → Koneksi WA.');
          }
          return;
        }

        // Reconnect dengan exponential backoff — TANPA notif spam
        if (reconnectCount >= MAX_RECONNECT) {
          logger.warn('WhatsApp', `Menyerah reconnect setelah ${MAX_RECONNECT}x`);
          reconnectCount = 0;
          // Notif hanya sekali saat benar-benar menyerah
          await notifyAdminTelegram(
            `❌ *WhatsApp gagal reconnect (${MAX_RECONNECT}x)*\n\nConnect ulang via /admin → Koneksi WA.`
          );
          return;
        }

        const delay = Math.min(RECONNECT_BASE * Math.pow(2, reconnectCount), RECONNECT_MAX);
        reconnectCount++;

        // TIDAK kirim notif saat reconnect biasa — silent saja
        logger.info('WhatsApp', `Reconnect ke-${reconnectCount} dalam ${delay}ms`);

        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => connectWhatsApp(telegramBot), delay);
      }

      if (connection === 'open') {
        isConnected    = true;
        isConnecting   = false;
        reconnectCount = 0;  // reset counter saat berhasil connect
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

        const waNumber = sock.user?.id?.split(':')[0] || '-';
        logger.info('WhatsApp', `✅ Terhubung sebagai ${waNumber}`);

        await editQRMessage(`✅ *WhatsApp Terhubung!*\n\n📱 Nomor: +${waNumber}\n\nBot siap menerima pesan.`);
        config.whatsapp._connected_number = waNumber;
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // ── Incoming Messages dari user WA ────────────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        if (!msg.message) continue;
        try {
          const waHandler = require('../handlers/waHandler');
          await waHandler.handleIncoming(sock, msg);
        } catch (err) {
          logger.error('WhatsApp', 'Error handle pesan masuk', { msg: err.message });
        }
      }
    });

  } catch (err) {
    isConnecting = false;
    logger.error('WhatsApp', 'connectWhatsApp error', { msg: err.message });
    // Silent — tidak spam notif ke admin
  }
}

// ─── Disconnect ────────────────────────────────────────────────────────────────

async function disconnectWhatsApp() {
  if (waSocket) {
    try {
      await waSocket.logout();
    } catch { /* ignore */ }
    waSocket = null;
  }
  isConnected  = false;
  isConnecting = false;
  clearSession();
  logger.info('WhatsApp', 'Disconnected & session dihapus');
}

function clearSession() {
  try {
    if (fs.existsSync(SESSION_PATH)) {
      fs.rmSync(SESSION_PATH, { recursive: true, force: true });
      fs.mkdirSync(SESSION_PATH, { recursive: true });
    }
  } catch (e) {
    logger.warn('WhatsApp', 'Gagal hapus session', { msg: e.message });
  }
}

// ─── Kirim QR ke Telegram ──────────────────────────────────────────────────────

async function sendQRToTelegram(qrData) {
  if (!telegramBot) return;
  const adminId = config.telegram.admin_id;
  if (!adminId) return;

  try {
    // Generate QR sebagai PNG buffer
    const qrBuffer = await QRCode.toBuffer(qrData, {
      type: 'png',
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });

    const caption =
      `📱 *Scan QR Code ini dengan WhatsApp*\n\n` +
      `1. Buka WhatsApp di HP\n` +
      `2. Ketuk ⋮ → *Perangkat Tertaut*\n` +
      `3. Ketuk *Tautkan Perangkat*\n` +
      `4. Scan QR di atas\n\n` +
      `⏳ QR berlaku ~60 detik`;

    if (qrMsgId) {
      // Hapus pesan QR lama, kirim yang baru
      try {
        await telegramBot.deleteMessage(adminId, qrMsgId);
      } catch { /* ignore */ }
    }

    const sent = await telegramBot.sendPhoto(adminId, qrBuffer, {
      caption,
      parse_mode: 'Markdown'
    });
    qrMsgId = sent.message_id;

  } catch (err) {
    logger.error('WhatsApp', 'Gagal kirim QR ke Telegram', { msg: err.message });
    // Fallback: kirim teks
    try {
      await telegramBot.sendMessage(adminId,
        `📱 *QR Code WhatsApp*\n\nGagal generate gambar QR.\nCoba lagi dengan /admin → Koneksi WA`,
        { parse_mode: 'Markdown' }
      );
    } catch { /* ignore */ }
  }
}

async function editQRMessage(text) {
  if (!telegramBot || !qrMsgId) return;
  const adminId = config.telegram.admin_id;
  try {
    await telegramBot.deleteMessage(adminId, qrMsgId);
    await telegramBot.sendMessage(adminId, text, { parse_mode: 'Markdown' });
    qrMsgId = null;
  } catch { /* ignore */ }
}

async function notifyAdminTelegram(text) {
  if (!telegramBot) return;
  const adminId = config.telegram.admin_id;
  if (!adminId) return;
  try {
    await telegramBot.sendMessage(adminId, text, { parse_mode: 'Markdown' });
  } catch { /* ignore */ }
}

// ─── Send Message ──────────────────────────────────────────────────────────────

async function sendMessage(jid, text) {
  if (!waSocket || !isConnected) {
    logger.warn('WhatsApp', 'WA belum connect, skip notifikasi');
    return false;
  }
  try {
    const formattedJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    await waSocket.sendMessage(formattedJid, { text });
    return true;
  } catch (err) {
    logger.error('WhatsApp', 'Gagal kirim pesan', { msg: err.message, jid });
    return false;
  }
}

async function sendNotification(phone, message) {
  const jid = phone.replace(/\D/g, '');
  return sendMessage(jid, message);
}

async function sendAdminAlert(message) {
  // Kirim ke WA admin jika connect
  if (isConnected) {
    const adminJid = config.whatsapp.admin_number;
    if (adminJid) await sendMessage(adminJid, `🔔 *ADMIN ALERT*\n\n${message}`);
  }
  // Kirim ke Telegram admin (selalu, tapi hanya untuk alert transaksi bukan WA status)
  await notifyAdminTelegram(`🔔 *ALERT*\n\n${message}`);
}

function getSocket()     { return waSocket; }
function isWAConnected() { return isConnected; }
function isWAConnecting(){ return isConnecting; }

module.exports = {
  connectWhatsApp,
  disconnectWhatsApp,
  sendMessage,
  sendNotification,
  sendAdminAlert,
  getSocket,
  isWAConnected,
  isWAConnecting
};
