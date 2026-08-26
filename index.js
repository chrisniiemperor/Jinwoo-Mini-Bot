/**
 * ============================================================
 * JINWOO MINI-BOT
 * WhatsApp MD Bot - Main Entry Point
 * ============================================================
 */

process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';
process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';
process.env.PUPPETEER_CACHE_DIR =
  process.env.PUPPETEER_CACHE_DIR ||
  '/tmp/puppeteer_cache_disabled';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');

// ============================================================
// LOAD .ENV WITHOUT DOTENV
// ============================================================

const ENV_FILE = '/home/container/.env';

function loadEnvFile() {
  try {
    if (!fs.existsSync(ENV_FILE)) {
      console.warn('⚠️ .env file not found:', ENV_FILE);
      return false;
    }

    const content = fs.readFileSync(ENV_FILE, 'utf8');

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) continue;

      const index = trimmed.indexOf('=');
      if (index === -1) continue;

      const key = trimmed.substring(0, index).trim();
      let value = trimmed.substring(index + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.substring(1, value.length - 1);
      }

      process.env[key] = value;
    }

    return true;
  } catch (error) {
    console.error(
      '❌ Failed loading .env:',
      error.message || error
    );

    return false;
  }
}

const envLoaded = loadEnvFile();

// ============================================================
// ENV CHECK
// ============================================================

console.log('');
console.log('╔══════════════════════════════════════╗');
console.log('║       JINWOO MINI-BOT ENV CHECK     ║');
console.log('╚══════════════════════════════════════╝');

console.log(
  '📁 .env:',
  envLoaded ? 'FOUND' : 'NOT FOUND'
);

console.log('📍 Path:', ENV_FILE);

if (process.env.SESSION_ID) {
  console.log('🔑 SESSION_ID: FOUND');
  console.log(
    '📏 SESSION_ID length:',
    process.env.SESSION_ID.length
  );
} else {
  console.log('❌ SESSION_ID: NOT FOUND');
}

console.log('');

// ============================================================
// TEMP / CLEANUP
// ============================================================

const {
  initializeTempSystem
} = require('./utils/tempManager');

const {
  startCleanup
} = require('./utils/cleanup');

initializeTempSystem();
startCleanup();

// ============================================================
// CONSOLE FILTER
// ============================================================

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

const forbiddenPatternsConsole = [
  'closing session',
  'closing open session',
  'sessionentry',
  'prekey bundle',
  'pendingprekey',
  '_chains',
  'registrationid',
  'currentratchet',
  'chainkey',
  'ratchet',
  'signal protocol',
  'ephemeralkeypair',
  'indexinfo',
  'basekey',
  'ratchetkey'
];

function safeString(value) {
  try {
    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  } catch {
    return String(value);
  }
}

function shouldSuppress(args) {
  const message = args
    .map(safeString)
    .join(' ')
    .toLowerCase();

  return forbiddenPatternsConsole.some(
    pattern => message.includes(pattern)
  );
}

console.log = (...args) => {
  if (!shouldSuppress(args)) {
    originalConsoleLog.apply(console, args);
  }
};

console.error = (...args) => {
  if (!shouldSuppress(args)) {
    originalConsoleError.apply(console, args);
  }
};

console.warn = (...args) => {
  if (!shouldSuppress(args)) {
    originalConsoleWarn.apply(console, args);
  }
};

// ============================================================
// DEPENDENCIES
// ============================================================

const pino = require('pino');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const qrcode = require('qrcode-terminal');

const config = require('./config');
const handler = require('./handler');

// ============================================================
// PUPPETEER CACHE CLEANUP
// ============================================================

function cleanupPuppeteerCache() {
  try {
    const home = os.homedir();

    const cacheDir = path.join(
      home,
      '.cache',
      'puppeteer'
    );

    if (fs.existsSync(cacheDir)) {
      console.log(
        '🧹 Removing Puppeteer cache...'
      );

      fs.rmSync(cacheDir, {
        recursive: true,
        force: true
      });

      console.log(
        '✅ Puppeteer cache removed'
      );
    }
  } catch (error) {
    console.error(
      '⚠️ Puppeteer cleanup failed:',
      error.message || error
    );
  }
}

// ============================================================
// MESSAGE STORE
// ============================================================

const store = {
  messages: new Map(),

  maxPerChat: 20,

  bind: ev => {
    ev.on(
      'messages.upsert',
      ({ messages }) => {
        for (const msg of messages) {
          if (!msg.key?.id) continue;

          const jid = msg.key.remoteJid;

          if (!jid) continue;

          if (!store.messages.has(jid)) {
            store.messages.set(
              jid,
              new Map()
            );
          }

          const chatMsgs =
            store.messages.get(jid);

          chatMsgs.set(
            msg.key.id,
            msg
          );

          while (
            chatMsgs.size >
            store.maxPerChat
          ) {
            const oldest =
              chatMsgs
                .keys()
                .next()
                .value;

            if (!oldest) break;

            chatMsgs.delete(oldest);
          }
        }
      }
    );
  },

  loadMessage: async (jid, id) => {
    return (
      store.messages
        .get(jid)
        ?.get(id) || null
    );
  }
};

// ============================================================
// MESSAGE DEDUPLICATION
// ============================================================

const processedMessages = new Set();

setInterval(() => {
  processedMessages.clear();
}, 5 * 60 * 1000);

// ============================================================
// PINO LOGGER
// ============================================================

function createSuppressedLogger(
  level = 'silent'
) {
  const forbiddenPatterns = [
    'closing session',
    'closing open session',
    'sessionentry',
    'prekey bundle',
    'pendingprekey',
    '_chains',
    'registrationid',
    'currentratchet',
    'chainkey',
    'ratchet',
    'signal protocol',
    'ephemeralkeypair',
    'indexinfo',
    'basekey',
    'ratchetkey'
  ];

  let logger;

  try {
    logger = pino({
      level,

      transport:
        process.env.NODE_ENV === 'production'
          ? undefined
          : {
              target: 'pino-pretty',
              options: {
                colorize: true,
                ignore: 'pid,hostname'
              }
            },

      redact: [
        'registrationId',
        'ephemeralKeyPair',
        'rootKey',
        'chainKey',
        'baseKey'
      ]
    });
  } catch {
    logger = pino({
      level
    });
  }

  const originalInfo =
    logger.info.bind(logger);

  logger.info = (...args) => {
    const message = args
      .map(safeString)
      .join(' ')
      .toLowerCase();

    if (
      !forbiddenPatterns.some(
        pattern =>
          message.includes(pattern)
      )
    ) {
      originalInfo(...args);
    }
  };

  logger.debug = () => {};
  logger.trace = () => {};

  return logger;
}

// ============================================================
// GET SESSION ID
// ============================================================

function getSessionID() {
  if (
    process.env.SESSION_ID &&
    process.env.SESSION_ID.trim()
  ) {
    return process.env.SESSION_ID.trim();
  }

  if (
    config.sessionID &&
    config.sessionID.trim()
  ) {
    return config.sessionID.trim();
  }

  return '';
}

// ============================================================
// RESTORE SESSION
// ============================================================

function restoreSession(sessionFolder) {
  const sessionID = getSessionID();

  console.log(
    '📡 Session : Checking SESSION_ID...'
  );

  if (!sessionID) {
    console.log(
      '📡 Session : ❌ SESSION_ID not found'
    );

    return false;
  }

  console.log(
    '📡 Session : 🔑 SESSION_ID found'
  );

  if (
    !sessionID.startsWith('JinwooBot!')
  ) {
    console.error(
      '📡 Session : ❌ Invalid SESSION_ID'
    );

    console.error(
      '📡 Required prefix: JinwooBot!'
    );

    return false;
  }

  try {
    const b64data =
      sessionID.substring(
        'JinwooBot!'.length
      );

    if (!b64data) {
      throw new Error(
        'Session data is empty'
      );
    }

    const cleanB64 =
      b64data.replace(/\s+/g, '');

    const compressedData =
      Buffer.from(
        cleanB64,
        'base64'
      );

    if (!compressedData.length) {
      throw new Error(
        'Decoded session is empty'
      );
    }

    console.log(
      '📡 Session : 🔓 Decoding...'
    );

    const decompressedData =
      zlib.gunzipSync(
        compressedData
      );

    if (!decompressedData.length) {
      throw new Error(
        'Decompressed session is empty'
      );
    }

    let parsed;

    try {
      parsed = JSON.parse(
        decompressedData.toString(
          'utf8'
        )
      );
    } catch {
      throw new Error(
        'Decompressed session is not valid JSON'
      );
    }

    if (
      !parsed ||
      typeof parsed !== 'object'
    ) {
      throw new Error(
        'Invalid credentials object'
      );
    }

    if (
      !fs.existsSync(sessionFolder)
    ) {
      fs.mkdirSync(
        sessionFolder,
        {
          recursive: true
        }
      );
    }

    const sessionFile =
      path.join(
        sessionFolder,
        'creds.json'
      );

    fs.writeFileSync(
      sessionFile,
      JSON.stringify(
        parsed,
        null,
        2
      ),
      'utf8'
    );

    console.log(
      '📡 Session : ✅ Session restored'
    );

    return true;
  } catch (error) {
    console.error(
      '📡 Session : ❌ Session restore failed:',
      error.message || error
    );

    return false;
  }
}

// ============================================================
// START BOT
// ============================================================

async function startBot() {
  const sessionFolder =
    `./${config.sessionName}`;

  console.log('');
  console.log(
    '========================================'
  );
  console.log(
    '🚀 STARTING WHATSAPP CONNECTION'
  );
  console.log(
    '========================================'
  );

  // ----------------------------------------------------------
  // RESTORE SESSION
  // ----------------------------------------------------------

  const restored =
    restoreSession(
      sessionFolder
    );

  console.log(
    restored
      ? '🔐 Authentication: SESSION_ID'
      : '⚠️ Authentication: LOCAL SESSION / QR'
  );

  // ----------------------------------------------------------
  // AUTH STATE
  // ----------------------------------------------------------

  const {
    state,
    saveCreds
  } = await useMultiFileAuthState(
    sessionFolder
  );

  // ----------------------------------------------------------
  // WHATSAPP VERSION
  // ----------------------------------------------------------

  const {
    version
  } = await fetchLatestBaileysVersion();

  console.log(
    '🌐 WhatsApp version:',
    version.join('.')
  );

  // ----------------------------------------------------------
  // SOCKET
  // ----------------------------------------------------------

  const logger =
    createSuppressedLogger(
      'silent'
    );

  const sock =
    makeWASocket({
      version,
      logger,

      printQRInTerminal: false,

      browser: [
        'Chrome',
        'Windows',
        '10.0'
      ],

      auth: state,

      syncFullHistory: false,

      downloadHistory: false,

      markOnlineOnConnect: false,

      getMessage: async () =>
        undefined
    });

  store.bind(sock.ev);

  // ==========================================================
  // WATCHDOG
  // ==========================================================

  let lastActivity =
    Date.now();

  const INACTIVITY_TIMEOUT =
    30 * 60 * 1000;

  sock.ev.on(
    'messages.upsert',
    () => {
      lastActivity = Date.now();
    }
  );

  const watchdogInterval =
    setInterval(
      async () => {
        try {
          if (
            Date.now() -
              lastActivity >
              INACTIVITY_TIMEOUT &&
            sock.ws?.readyState === 1
          ) {
            console.log(
              '⚠️ Connection inactive. Reconnecting...'
            );

            try {
              await sock.end(
                undefined,
                undefined,
                {
                  reason: 'inactive'
                }
              );
            } catch {}

            clearInterval(
              watchdogInterval
            );

            setTimeout(
              () => startBot(),
              5000
            );
          }
        } catch {}
      },
      5 * 60 * 1000
    );

  // ==========================================================
  // CONNECTION UPDATE
  // ==========================================================

  sock.ev.on(
    'connection.update',
    async update => {
      const {
        connection,
        lastDisconnect,
        qr
      } = update;

      // --------------------------------------------------------
      // QR
      // --------------------------------------------------------

      if (qr) {
        console.log('');
        console.log(
          '⚠️ QR CODE GENERATED'
        );

        console.log(
          '📱 Scan this QR with WhatsApp:'
        );

        qrcode.generate(
          qr,
          {
            small: true
          }
        );
      }

      // --------------------------------------------------------
      // OPEN
      // --------------------------------------------------------

      if (
        connection === 'open'
      ) {
        clearInterval(
          watchdogInterval
        );

        lastActivity =
          Date.now();

        console.log('');
        console.log(
          '╔══════════════════════════════════════╗'
        );
        console.log(
          '║    ✅ BOT CONNECTED SUCCESSFULLY    ║'
        );
        console.log(
          '╚══════════════════════════════════════╝'
        );

        console.log(
          `📱 Number: ${
            sock.user?.id
              ?.split(':')[0] ||
            'Unknown'
          }`
        );

        console.log(
          `🤖 Bot: ${config.botName}`
        );

        console.log(
          `⚡ Prefix: ${config.prefix}`
        );

        const ownerNames =
          Array.isArray(
            config.ownerName
          )
            ? config.ownerName.join(', ')
            : config.ownerName;

        console.log(
          `👑 Owner: ${ownerNames}`
        );

        console.log(
          '🚀 Bot is ready!'
        );

        console.log('');

        if (config.autoBio) {
          try {
            await sock.updateProfileStatus(
              `${config.botName} | Active 24/7`
            );
          } catch {}
        }

        try {
          handler.initializeAntiCall(
            sock
          );
        } catch (error) {
          console.error(
            'Anti-call error:',
            error.message || error
          );
        }

        // Cleanup old stored messages
        const now = Date.now();

        for (
          const [
            jid,
            chatMsgs
          ] of store.messages
        ) {
          const timestamps =
            Array.from(
              chatMsgs.values()
            ).map(
              msg =>
                Number(
                  msg.messageTimestamp ||
                    0
                ) * 1000
            );

          if (
            timestamps.length &&
            now -
              Math.max(
                ...timestamps
              ) >
              24 *
                60 *
                60 *
                1000
          ) {
            store.messages.delete(
              jid
            );
          }
        }

        console.log(
          `🧹 Store cleaned: ${store.messages.size} active chats`
        );
      }

      // --------------------------------------------------------
      // CLOSE
      // --------------------------------------------------------

      if (
        connection === 'close'
      ) {
        clearInterval(
          watchdogInterval
        );

        const statusCode =
          lastDisconnect
            ?.error
            ?.output
            ?.statusCode;

        const errorMessage =
          lastDisconnect
            ?.error
            ?.message ||
          'Unknown error';

        const shouldReconnect =
          statusCode !==
          DisconnectReason.loggedOut;

        console.log(
          '⚠️ Connection closed:',
          errorMessage
        );

        console.log(
          '📊 Status:',
          statusCode || 'unknown'
        );

        if (
          shouldReconnect
        ) {
          console.log(
            '🔄 Reconnecting in 5 seconds...'
          );

          setTimeout(
            () => startBot(),
            5000
          );
        } else {
          console.log(
            '❌ Session logged out.'
          );

          console.log(
            '⚠️ Generate a new SESSION_ID.'
          );
        }
      }
    }
  );

  // ==========================================================
  // CREDENTIALS
  // ==========================================================

  sock.ev.on(
    'creds.update',
    saveCreds
  );

  // ==========================================================
  // SYSTEM JID FILTER
  // ==========================================================

  const isSystemJid = jid => {
    if (!jid) return true;

    return (
      jid.includes('@broadcast') ||
      jid.includes('status.broadcast') ||
      jid.includes('@newsletter') ||
      jid.includes('@newsletter.')
    );
  };

  // ==========================================================
  // MESSAGE HANDLER
  // ==========================================================

  sock.ev.on(
    'messages.upsert',
    ({ messages, type }) => {

      // Only process new messages
      if (type !== 'notify') {
        return;
      }

      for (const msg of messages) {

        if (
          !msg.message ||
          !msg.key?.id
        ) {
          continue;
        }

        const from =
          msg.key.remoteJid;

        if (!from) {
          continue;
        }

        // ======================================================
        // AUTOSTATUS
        // MUST COME BEFORE isSystemJid()
        // ======================================================

        // AUTOSTATUS: handle status@broadcast
        // BEFORE the isSystemJid filter so the
        // broadcast check does not swallow it.

        if (from === 'status@broadcast') {
          setImmediate(async () => {
            try {
              const {
                load
              } = require(
                './utils/autostatus'
              );

              const cfg = load();

              if (cfg.view) {
                await sock.readMessages([
                  msg.key
                ]);
              }

              if (
                cfg.react &&
                cfg.reaction
              ) {
                await sock.sendMessage(
                  from,
                  {
                    react: {
                      text: cfg.reaction,
                      key: msg.key
                    }
                  },
                  {
                    statusJidList: [
                      msg.key.participant
                    ]
                  }
                );
              }
            } catch {}
          });

          continue;
        }

        // ======================================================
        // OTHER SYSTEM MESSAGES
        // ======================================================

        if (
          isSystemJid(from)
        ) {
          continue;
        }

        // ======================================================
        // DUPLICATE PROTECTION
        // ======================================================

        const msgId =
          msg.key.id;

        if (
          processedMessages.has(
            msgId
          )
        ) {
          continue;
        }

        // ======================================================
        // MESSAGE AGE
        // ======================================================

        const MESSAGE_AGE_LIMIT =
          5 * 60 * 1000;

        if (
          msg.messageTimestamp
        ) {
          const messageAge =
            Date.now() -
            Number(
              msg.messageTimestamp
            ) *
              1000;

          if (
            messageAge >
            MESSAGE_AGE_LIMIT
          ) {
            continue;
          }
        }

        processedMessages.add(
          msgId
        );

        // ======================================================
        // STORE MESSAGE
        // ======================================================

        if (
          !store.messages.has(
            from
          )
        ) {
          store.messages.set(
            from,
            new Map()
          );
        }

        const chatMsgs =
          store.messages.get(
            from
          );

        chatMsgs.set(
          msg.key.id,
          msg
        );

        while (
          chatMsgs.size >
          store.maxPerChat
        ) {
          const oldest =
            chatMsgs
              .keys()
              .next()
              .value;

          if (!oldest) break;

          chatMsgs.delete(
            oldest
          );
        }

        // ======================================================
        // COMMAND HANDLER
        // ======================================================

        console.log(
          '📩 Message received from:',
          from
        );

        handler
          .handleMessage(
            sock,
            msg
          )
          .catch(error => {

            const errorMessage =
              error?.message ||
              '';

            if (
              !errorMessage.includes(
                'rate-overlimit'
              ) &&
              !errorMessage.includes(
                'not-authorized'
              )
            ) {
              console.error(
                '❌ Handler error:',
                error?.stack ||
                  errorMessage ||
                  error
              );
            }
          });

        // ======================================================
        // BACKGROUND OPERATIONS
        // ======================================================

        setImmediate(
          async () => {

            // --------------------------------------------------
            // AUTO READ
            // --------------------------------------------------

            if (
              config.autoRead &&
              from.endsWith('@g.us')
            ) {
              try {
                await sock.readMessages([
                  msg.key
                ]);
              } catch {}
            }

            // --------------------------------------------------
            // ANTILINK
            // --------------------------------------------------

            if (
              from.endsWith('@g.us')
            ) {
              try {
                const metadata =
                  await handler.getGroupMetadata(
                    sock,
                    from
                  );

                if (metadata) {
                  await handler.handleAntilink(
                    sock,
                    msg,
                    metadata
                  );
                }
              } catch {}
            }
          }
        );
      }
    }
  );

  // ==========================================================
  // RECEIPTS
  // ==========================================================

  sock.ev.on(
    'message-receipt.update',
    () => {}
  );

  // ==========================================================
  // MESSAGE UPDATES
  // ==========================================================

  sock.ev.on(
    'messages.update',
    () => {}
  );

  // ==========================================================
  // GROUP PARTICIPANTS
  // ==========================================================

  sock.ev.on(
    'group-participants.update',
    async update => {
      try {
        await handler.handleGroupUpdate(
          sock,
          update
        );
      } catch (error) {
        console.error(
          '❌ Group update error:',
          error.message || error
        );
      }
    }
  );

  // ==========================================================
  // SOCKET ERROR
  // ==========================================================

  sock.ev.on(
    'error',
    error => {
      const statusCode =
        error?.output
          ?.statusCode;

      if (
        statusCode === 515 ||
        statusCode === 503 ||
        statusCode === 408
      ) {
        return;
      }

      console.error(
        '❌ Socket error:',
        error.message || error
      );
    }
  );

  return sock;
}

// ============================================================
// STARTUP
// ============================================================

console.log(
  '🚀 Starting WhatsApp MD Bot...\n'
);

console.log(
  `📦 Bot Name: ${config.botName}`
);

console.log(
  `⚡ Prefix: ${config.prefix}`
);

const ownerNames =
  Array.isArray(
    config.ownerName
  )
    ? config.ownerName.join(', ')
    : config.ownerName;

console.log(
  `👑 Owner: ${ownerNames}\n`
);

cleanupPuppeteerCache();

startBot().catch(
  error => {
    console.error(
      '❌ Error starting bot:',
      error
    );

    process.exit(1);
  }
);

// ============================================================
// UNCAUGHT EXCEPTION
// ============================================================

process.on(
  'uncaughtException',
  error => {

    if (
      error?.code === 'ENOSPC' ||
      error?.errno === -28 ||
      error?.message?.includes(
        'no space left on device'
      )
    ) {
      console.error(
        '⚠️ ENOSPC: No space left on device.'
      );

      try {
        const {
          cleanupOldFiles
        } = require(
          './utils/cleanup'
        );

        cleanupOldFiles();
      } catch {}

      return;
    }

    console.error(
      '❌ Uncaught Exception:',
      error
    );
  }
);

// ============================================================
// UNHANDLED REJECTION
// ============================================================

process.on(
  'unhandledRejection',
  error => {

    if (
      error?.code === 'ENOSPC' ||
      error?.errno === -28 ||
      error?.message?.includes(
        'no space left on device'
      )
    ) {
      console.warn(
        '⚠️ ENOSPC: No space left on device.'
      );

      try {
        const {
          cleanupOldFiles
        } = require(
          './utils/cleanup'
        );

        cleanupOldFiles();
      } catch {}

      return;
    }

    if (
      error?.message?.includes(
        'rate-overlimit'
      )
    ) {
      console.warn(
        '⚠️ Rate limit reached.'
      );

      return;
    }

    console.error(
      '❌ Unhandled Rejection:',
      error
    );
  }
);

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  store
};