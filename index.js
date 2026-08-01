/**
 * WhatsApp MD Bot - Main Entry Point
 */
process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';
process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';
process.env.PUPPETEER_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || '/tmp/puppeteer_cache_disabled';

const { initializeTempSystem } = require('./utils/tempManager');
const { startCleanup } = require('./utils/cleanup');
initializeTempSystem();
startCleanup();
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

const forbiddenPatternsConsole = [
  'closing session', 'closing open session', 'sessionentry',
  'prekey bundle', 'pendingprekey', '_chains', 'registrationid',
  'currentratchet', 'chainkey', 'ratchet', 'signal protocol',
  'ephemeralkeypair', 'indexinfo', 'basekey'
];

console.log = (...args) => {
  const message = args.map(a => typeof a === 'string' ? a : typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ').toLowerCase();
  if (!forbiddenPatternsConsole.some(pattern => message.includes(pattern))) {
    originalConsoleLog.apply(console, args);
  }
};
console.error = (...args) => {
  const message = args.map(a => typeof a === 'string' ? a : typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ').toLowerCase();
  if (!forbiddenPatternsConsole.some(pattern => message.includes(pattern))) {
    originalConsoleError.apply(console, args);
  }
};
console.warn = (...args) => {
  const message = args.map(a => typeof a === 'string' ? a : typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ').toLowerCase();
  if (!forbiddenPatternsConsole.some(pattern => message.includes(pattern))) {
    originalConsoleWarn.apply(console, args);
  }
};

const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const config = require('./config');
const handler = require('./handler');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');

function cleanupPuppeteerCache() {
  try {
    const home = os.homedir();
    const cacheDir = path.join(home, '.cache', 'puppeteer');
    if (fs.existsSync(cacheDir)) {
      console.log('🧹 Removing Puppeteer cache at:', cacheDir);
      fs.rmSync(cacheDir, { recursive: true, force: true });
      console.log('✅ Puppeteer cache removed');
    }
  } catch (err) {
    console.error('⚠️ Failed to cleanup Puppeteer cache:', err.message || err);
  }
}

const store = {
  messages: new Map(),
  maxPerChat: 20,

  bind: (ev) => {
    ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        if (!msg.key?.id) continue;
        const jid = msg.key.remoteJid;
        if (!store.messages.has(jid)) store.messages.set(jid, new Map());
        const chatMsgs = store.messages.get(jid);
        chatMsgs.set(msg.key.id, msg);
        if (chatMsgs.size > store.maxPerChat) {
          const oldestKey = chatMsgs.keys().next().value;
          chatMsgs.delete(oldestKey);
        }
      }
    });
  },

  loadMessage: async (jid, id) => {
    return store.messages.get(jid)?.get(id) || null;
  }
};

const processedMessages = new Set();

setInterval(() => {
  processedMessages.clear();
}, 5 * 60 * 1000);

const createSuppressedLogger = (level = 'silent') => {
  const forbiddenPatterns = [
    'closing session', 'closing open session', 'sessionentry',
    'prekey bundle', 'pendingprekey', '_chains', 'registrationid',
    'currentratchet', 'chainkey', 'ratchet', 'signal protocol',
    'ephemeralkeypair', 'indexinfo', 'basekey', 'ratchetkey'
  ];

  let logger;
  try {
    logger = pino({
      level,
      transport: process.env.NODE_ENV === 'production' ? undefined : {
        target: 'pino-pretty',
        options: { colorize: true, ignore: 'pid,hostname' }
      },
      customLevels: { trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5 },
      redact: ['registrationId', 'ephemeralKeyPair', 'rootKey', 'chainKey', 'baseKey']
    });
  } catch (err) {
    logger = pino({ level });
  }

  const originalInfo = logger.info.bind(logger);
  logger.info = (...args) => {
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ').toLowerCase();
    if (!forbiddenPatterns.some(pattern => msg.includes(pattern))) originalInfo(...args);
  };
  logger.debug = () => { };
  logger.trace = () => { };
  return logger;
};

async function startBot() {
  const sessionFolder = `./${config.sessionName}`;
  const sessionFile = path.join(sessionFolder, 'creds.json');

  if (config.sessionID && config.sessionID.startsWith('JinwooBot!')) {
    try {
      const [header, b64data] = config.sessionID.split('!');
      if (header !== 'JinwooBot' || !b64data) {
        throw new Error("❌ Invalid session format. Expected 'JinwooBot!.....'");
      }
      const cleanB64 = b64data.replace('...', '');
      const compressedData = Buffer.from(cleanB64, 'base64');
      const decompressedData = zlib.gunzipSync(compressedData);
      if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder, { recursive: true });
      fs.writeFileSync(sessionFile, decompressedData, 'utf8');
      console.log('📡 Session : 🔑 Retrieved from JinwooBot Session');
    } catch (e) {
      console.error('📡 Session : ❌ Error processing JinwooBot session:', e.message);
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version } = await fetchLatestBaileysVersion();
  const suppressedLogger = createSuppressedLogger('silent');

  const sock = makeWASocket({
    version,
    logger: suppressedLogger,
    printQRInTerminal: false,
    browser: ['Chrome', 'Windows', '10.0'],
    auth: state,
    syncFullHistory: false,
    downloadHistory: false,
    markOnlineOnConnect: false,
    getMessage: async () => undefined
  });

  store.bind(sock.ev);

  let lastActivity = Date.now();
  const INACTIVITY_TIMEOUT = 30 * 60 * 1000;

  sock.ev.on('messages.upsert', () => { lastActivity = Date.now(); });

  const watchdogInterval = setInterval(async () => {
    if (Date.now() - lastActivity > INACTIVITY_TIMEOUT && sock.ws.readyState === 1) {
      console.log('⚠️ No activity detected. Forcing reconnect...');
      await sock.end(undefined, undefined, { reason: 'inactive' });
      clearInterval(watchdogInterval);
      setTimeout(() => startBot(), 5000);
    }
  }, 5 * 60 * 1000);

  sock.ev.on('connection.update', (update) => {
    const { connection } = update;
    if (connection === 'open') lastActivity = Date.now();
    else if (connection === 'close') clearInterval(watchdogInterval);
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n\n📱 Scan this QR code with WhatsApp:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const errorMessage = lastDisconnect?.error?.message || 'Unknown error';
      if (statusCode === 515 || statusCode === 503 || statusCode === 408) {
        console.log(`⚠️ Connection closed (${statusCode}). Reconnecting...`);
      } else {
        console.log('Connection closed due to:', errorMessage, '\nReconnecting:', shouldReconnect);
      }
      if (shouldReconnect) setTimeout(() => startBot(), 3000);

    } else if (connection === 'open') {
      console.log('\n✅ Bot connected successfully!');
      console.log(`📱 Bot Number: ${sock.user.id.split(':')[0]}`);
      console.log(`🤖 Bot Name: ${config.botName}`);
      console.log(`⚡ Prefix: ${config.prefix}`);
      const ownerNames = Array.isArray(config.ownerName) ? config.ownerName.join(',') : config.ownerName;
      console.log(`👑 Owner: ${ownerNames}\n`);
      console.log('Bot is ready to receive messages!\n');

      if (config.autoBio) await sock.updateProfileStatus(`${config.botName} | Active 24/7`);

      handler.initializeAntiCall(sock);

      const now = Date.now();
      for (const [jid, chatMsgs] of store.messages.entries()) {
        const timestamps = Array.from(chatMsgs.values()).map(m => m.messageTimestamp * 1000 || 0);
        if (timestamps.length > 0 && now - Math.max(...timestamps) > 24 * 60 * 60 * 1000) {
          store.messages.delete(jid);
        }
      }
      console.log(`🧹 Store cleaned. Active chats: ${store.messages.size}`);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  const isSystemJid = (jid) => {
    if (!jid) return true;
    return jid.includes('@broadcast') ||
      jid.includes('status.broadcast') ||
      jid.includes('@newsletter') ||
      jid.includes('@newsletter.');
  };

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || !msg.key?.id) continue;

      const from = msg.key.remoteJid;
      if (!from) continue;

      // ---------------------------------------------------------------
      // AUTOSTATUS: intercept status@broadcast BEFORE the system filter
      // ---------------------------------------------------------------
      if (from === 'status@broadcast') {
        setImmediate(async () => {
          try {
            const { load } = require('./utils/autostatus');
            const cfg = load();

            // View the status (marks it as seen)
            if (cfg.view) {
              await sock.readMessages([msg.key]);
            }

            // React to the status
            if (cfg.react && cfg.reaction) {
              await sock.sendMessage(
                from,
                { react: { text: cfg.reaction, key: msg.key } },
                { statusJidList: [msg.key.participant] }
              );
            }
          } catch (e) {
            // silently ignore
          }
        });
        continue; // Don't process as a regular message
      }

      // System message filter - ignore all other broadcast/newsletter messages
      if (isSystemJid(from)) continue;

      const msgId = msg.key.id;
      if (processedMessages.has(msgId)) continue;

      const MESSAGE_AGE_LIMIT = 5 * 60 * 1000;
      if (msg.messageTimestamp) {
        const messageAge = Date.now() - (msg.messageTimestamp * 1000);
        if (messageAge > MESSAGE_AGE_LIMIT) continue;
      }

      processedMessages.add(msgId);

      if (msg.key && msg.key.id) {
        if (!store.messages.has(from)) store.messages.set(from, new Map());
        const chatMsgs = store.messages.get(from);
        chatMsgs.set(msg.key.id, msg);
        if (chatMsgs.size > store.maxPerChat) {
          const sortedIds = Array.from(chatMsgs.entries())
            .sort((a, b) => (a[1].messageTimestamp || 0) - (b[1].messageTimestamp || 0))
            .map(([id]) => id);
          for (let i = 0; i < sortedIds.length - store.maxPerChat; i++) {
            chatMsgs.delete(sortedIds[i]);
          }
        }
      }

      handler.handleMessage(sock, msg).catch(err => {
        if (!err.message?.includes('rate-overlimit') &&
          !err.message?.includes('not-authorized')) {
          console.error('Error handling message:', err.message);
        }
      });

      setImmediate(async () => {
        if (config.autoRead && from.endsWith('@g.us')) {
          try { await sock.readMessages([msg.key]); } catch (e) { }
        }
        if (from.endsWith('@g.us')) {
          try {
            const groupMetadata = await handler.getGroupMetadata(sock, msg.key.remoteJid);
            if (groupMetadata) await handler.handleAntilink(sock, msg, groupMetadata);
          } catch (error) { }
        }
      });
    }
  });

  sock.ev.on('message-receipt.update', () => { });
  sock.ev.on('messages.update', () => { });

  sock.ev.on('group-participants.update', async (update) => {
    await handler.handleGroupUpdate(sock, update);
  });

  sock.ev.on('error', (error) => {
    const statusCode = error?.output?.statusCode;
    if (statusCode === 515 || statusCode === 503 || statusCode === 408) return;
    console.error('Socket error:', error.message || error);
  });

  return sock;
}

console.log('🚀 Starting WhatsApp MD Bot...\n');
console.log(`📦 Bot Name: ${config.botName}`);
console.log(`⚡ Prefix: ${config.prefix}`);
const ownerNames = Array.isArray(config.ownerName) ? config.ownerName.join(',') : config.ownerName;
console.log(`👑 Owner: ${ownerNames}\n`);

cleanupPuppeteerCache();

startBot().catch(err => {
  console.error('Error starting bot:', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  if (err.code === 'ENOSPC' || err.errno === -28 || err.message?.includes('no space left on device')) {
    console.error('⚠️ ENOSPC Error: No space left on device. Attempting cleanup...');
    const { cleanupOldFiles } = require('./utils/cleanup');
    cleanupOldFiles();
    console.warn('⚠️ Cleanup completed. Bot will continue but may experience issues until space is freed.');
    return;
  }
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  if (err.code === 'ENOSPC' || err.errno === -28 || err.message?.includes('no space left on device')) {
    console.warn('⚠️ ENOSPC Error in promise: No space left on device. Attempting cleanup...');
    const { cleanupOldFiles } = require('./utils/cleanup');
    cleanupOldFiles();
    console.warn('⚠️ Cleanup completed. Bot will continue but may experience issues until space is freed.');
    return;
  }
  if (err.message && err.message.includes('rate-overlimit')) {
    console.warn('⚠️ Rate limit reached. Please slow down your requests.');
    return;
  }
  console.error('Unhandled Rejection:', err);
});

module.exports = { store };