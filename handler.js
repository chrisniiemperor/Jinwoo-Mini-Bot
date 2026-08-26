/**
 * Jinwoo Mini-Bot
 * handler.js — PART 1/2
 *
 * IMPORTANT:
 * Part 2 continues directly after this file section.
 * Do NOT create another handleMessage in Part 2.
 */

const config = require('./config');
const database = require('./database');

const { loadCommands } = require('./utils/commandLoader');
const { addMessage } = require('./utils/groupstats');

const {
  tryAutoLevelUp,
  formatLevelUpMessage
} = require('./utils/economy');

const {
  jidDecode,
  jidEncode
} = require('@whiskeysockets/baileys');

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const chatbotCmd =
  require('./commands/admin/chatbot');

const {
  containsBadWord
} = require('./utils/badwords');

const {
  writeExifImg
} = require('./utils/exif');


// ============================================================
// COMMANDS
// ============================================================

const commands = loadCommands();


// ============================================================
// GROUP METADATA CACHE
// ============================================================

const groupMetadataCache = new Map();

const CACHE_TTL = 60 * 1000;


// ============================================================
// ANTIBADWORD STICKER
// ============================================================

const ANTIBADWORD_STICKER_PATH = path.join(
  __dirname,
  'utils',
  'galimatde.webp'
);

const ANTIBADWORD_STICKER_AUTHOR =
  'GALI MAT DE BSDK';

let antibadwordStickerCache = null;


const getAntibadwordSticker = async () => {
  try {
    if (
      !antibadwordStickerCache &&
      fs.existsSync(ANTIBADWORD_STICKER_PATH)
    ) {
      const raw =
        fs.readFileSync(
          ANTIBADWORD_STICKER_PATH
        );

      antibadwordStickerCache =
        await writeExifImg(
          raw,
          {
            packname:
              ANTIBADWORD_STICKER_AUTHOR
          }
        );
    }
  } catch (error) {
    console.error(
      '[ANTIBADWORD STICKER]',
      error.message
    );
  }

  return antibadwordStickerCache;
};


// ============================================================
// MESSAGE UNWRAPPER
// ============================================================

const getMessageContent = (msg) => {
  if (!msg?.message) {
    return null;
  }

  let content = msg.message;

  if (content.ephemeralMessage) {
    content =
      content.ephemeralMessage.message;
  }

  if (content.viewOnceMessageV2) {
    content =
      content.viewOnceMessageV2.message;
  }

  if (content.viewOnceMessage) {
    content =
      content.viewOnceMessage.message;
  }

  if (content.documentWithCaptionMessage) {
    content =
      content.documentWithCaptionMessage.message;
  }

  return content;
};


// ============================================================
// NORMALIZE JID
// ============================================================

const normalizeJid = (jid) => {
  if (!jid || typeof jid !== 'string') {
    return null;
  }

  return jid
    .split(':')[0]
    .split('@')[0];
};


// ============================================================
// LID MAPPING CACHE
// ============================================================

const lidMappingCache = new Map();


const getLidMappingValue = (
  user,
  direction
) => {
  if (!user) {
    return null;
  }

  const cacheKey =
    `${direction}:${user}`;

  if (lidMappingCache.has(cacheKey)) {
    return lidMappingCache.get(cacheKey);
  }

  const sessionPath =
    path.join(
      __dirname,
      config.sessionName || 'session'
    );

  const suffix =
    direction === 'pnToLid'
      ? '.json'
      : '_reverse.json';

  const filePath =
    path.join(
      sessionPath,
      `lid-mapping-${user}${suffix}`
    );

  if (!fs.existsSync(filePath)) {
    lidMappingCache.set(
      cacheKey,
      null
    );

    return null;
  }

  try {
    const raw =
      fs.readFileSync(
        filePath,
        'utf8'
      ).trim();

    const value =
      raw
        ? JSON.parse(raw)
        : null;

    lidMappingCache.set(
      cacheKey,
      value || null
    );

    return value || null;

  } catch {
    lidMappingCache.set(
      cacheKey,
      null
    );

    return null;
  }
};


// ============================================================
// NORMALIZE JID WITH LID SUPPORT
// ============================================================

const normalizeJidWithLid = (jid) => {
  if (!jid) {
    return jid;
  }

  try {
    const decoded =
      jidDecode(jid);

    if (!decoded?.user) {
      return `${jid
        .split(':')[0]
        .split('@')[0]}@s.whatsapp.net`;
    }

    let user =
      decoded.user;

    let server =
      decoded.server === 'c.us'
        ? 's.whatsapp.net'
        : decoded.server;

    if (
      server === 'lid' ||
      server === 'hosted.lid'
    ) {
      const pnUser =
        getLidMappingValue(
          user,
          'lidToPn'
        );

      if (pnUser) {
        user = pnUser;

        server =
          server === 'hosted.lid'
            ? 'hosted'
            : 's.whatsapp.net';
      }
    }

    if (
      server === 's.whatsapp.net' ||
      server === 'hosted'
    ) {
      const pnUser =
        getLidMappingValue(
          user,
          'lidToPn'
        );

      if (pnUser) {
        user = pnUser;
      }
    }

    if (server === 'hosted') {
      return jidEncode(
        user,
        'hosted'
      );
    }

    return jidEncode(
      user,
      's.whatsapp.net'
    );

  } catch {
    return jid;
  }
};


// ============================================================
// BUILD COMPARABLE IDS
// ============================================================

const buildComparableIds = (jid) => {
  if (!jid) {
    return [];
  }

  try {
    const decoded =
      jidDecode(jid);

    if (!decoded?.user) {
      return [
        normalizeJidWithLid(jid)
      ].filter(Boolean);
    }

    const variants =
      new Set();

    const server =
      decoded.server === 'c.us'
        ? 's.whatsapp.net'
        : decoded.server;

    variants.add(
      jidEncode(
        decoded.user,
        server
      )
    );

    const isPnServer =
      server === 's.whatsapp.net' ||
      server === 'hosted';

    const isLidServer =
      server === 'lid' ||
      server === 'hosted.lid';

    if (isPnServer) {
      const lidUser =
        getLidMappingValue(
          decoded.user,
          'pnToLid'
        );

      if (lidUser) {
        variants.add(
          jidEncode(
            lidUser,
            server === 'hosted'
              ? 'hosted.lid'
              : 'lid'
          )
        );
      }
    }

    if (isLidServer) {
      const pnUser =
        getLidMappingValue(
          decoded.user,
          'lidToPn'
        );

      if (pnUser) {
        variants.add(
          jidEncode(
            pnUser,
            server === 'hosted.lid'
              ? 'hosted'
              : 's.whatsapp.net'
          )
        );
      }
    }

    return Array.from(
      variants
    );

  } catch {
    return [jid];
  }
};


// ============================================================
// BOT JID CHECK
// ============================================================

const isBotJid = (
  jid,
  sock
) => {
  if (!jid || !sock?.user) {
    return false;
  }

  const botRefs = [
    sock.user.id,
    sock.user.lid
  ].filter(Boolean);

  const targetVariants =
    buildComparableIds(jid);

  return botRefs.some(
    botRef =>
      buildComparableIds(
        botRef
      ).some(
        botVariant =>
          targetVariants.includes(
            botVariant
          )
      )
  );
};


// ============================================================
// FIND PARTICIPANT
// ============================================================

const findParticipant = (
  participants = [],
  userIds
) => {
  const targets = (
    Array.isArray(userIds)
      ? userIds
      : [userIds]
  )
    .filter(Boolean)
    .flatMap(
      id =>
        buildComparableIds(id)
    );

  if (!targets.length) {
    return null;
  }

  return participants.find(
    participant => {
      if (!participant) {
        return false;
      }

      const participantIds = [
        participant.id,
        participant.lid,
        participant.userJid,
        participant.phoneNumber
      ]
        .filter(Boolean)
        .flatMap(
          id =>
            buildComparableIds(id)
        );

      return participantIds.some(
        id =>
          targets.includes(id)
      );
    }
  ) || null;
};


// ============================================================
// OWNER CHECK
// ============================================================

const isOwner = (sender) => {
  if (!sender) {
    return false;
  }

  const senderNumber =
    normalizeJid(
      normalizeJidWithLid(
        sender
      )
    );

  const owners =
    Array.isArray(config.ownerNumber)
      ? config.ownerNumber
      : [config.ownerNumber];

  return owners
    .filter(Boolean)
    .some(owner => {
      const ownerJid =
        String(owner).includes('@')
          ? String(owner)
          : `${owner}@s.whatsapp.net`;

      const ownerNumber =
        normalizeJid(
          normalizeJidWithLid(
            ownerJid
          )
        );

      return (
        ownerNumber ===
        senderNumber
      );
    });
};


// ============================================================
// MODERATOR CHECK
// ============================================================

const isMod = (sender) => {
  if (!sender) {
    return false;
  }

  try {
    return database.isModerator(
      normalizeJid(sender)
    );
  } catch {
    return false;
  }
};


// ============================================================
// GROUP METADATA CACHE
// ============================================================

const getCachedGroupMetadata = async (
  sock,
  groupId
) => {
  try {
    if (
      !groupId ||
      !groupId.endsWith('@g.us')
    ) {
      return null;
    }

    const cached =
      groupMetadataCache.get(
        groupId
      );

    if (
      cached &&
      Date.now() - cached.timestamp <
        CACHE_TTL
    ) {
      return cached.data;
    }

    const metadata =
      await sock.groupMetadata(
        groupId
      );

    groupMetadataCache.set(
      groupId,
      {
        data: metadata,
        timestamp: Date.now()
      }
    );

    return metadata;

  } catch (error) {
    const cached =
      groupMetadataCache.get(
        groupId
      );

    if (
      error?.message?.includes(
        'rate-overlimit'
      )
    ) {
      return cached?.data || null;
    }

    return cached?.data || null;
  }
};


// ============================================================
// LIVE GROUP METADATA
// ============================================================

const getLiveGroupMetadata = async (
  sock,
  groupId
) => {
  try {
    if (
      !groupId ||
      !groupId.endsWith('@g.us')
    ) {
      return null;
    }

    const metadata =
      await sock.groupMetadata(
        groupId
      );

    groupMetadataCache.set(
      groupId,
      {
        data: metadata,
        timestamp: Date.now()
      }
    );

    return metadata;

  } catch {
    const cached =
      groupMetadataCache.get(
        groupId
      );

    return cached?.data || null;
  }
};


const getGroupMetadata =
  getCachedGroupMetadata;


// ============================================================
// ADMIN CHECK
// ============================================================

const isAdmin = async (
  sock,
  participant,
  groupId,
  groupMetadata = null
) => {
  if (
    !participant ||
    !groupId ||
    !groupId.endsWith('@g.us')
  ) {
    return false;
  }

  let metadata =
    groupMetadata;

  if (
    !metadata?.participants
  ) {
    metadata =
      await getLiveGroupMetadata(
        sock,
        groupId
      );
  }

  if (
    !metadata?.participants
  ) {
    return false;
  }

  const found =
    findParticipant(
      metadata.participants,
      participant
    );

  if (!found) {
    return false;
  }

  return (
    found.admin === 'admin' ||
    found.admin === 'superadmin'
  );
};


// ============================================================
// BOT ADMIN CHECK
// ============================================================

const isBotAdmin = async (
  sock,
  groupId,
  groupMetadata = null
) => {
  if (
    !sock?.user ||
    !groupId ||
    !groupId.endsWith('@g.us')
  ) {
    return false;
  }

  try {
    const metadata =
      groupMetadata ||
      await getLiveGroupMetadata(
        sock,
        groupId
      );

    if (
      !metadata?.participants
    ) {
      return false;
    }

    const botIds = [
      sock.user.id,
      sock.user.lid
    ].filter(Boolean);

    const participant =
      findParticipant(
        metadata.participants,
        botIds
      );

    if (!participant) {
      return false;
    }

    return (
      participant.admin === 'admin' ||
      participant.admin === 'superadmin'
    );

  } catch {
    return false;
  }
};


// ============================================================
// SYSTEM JID
// ============================================================

const isSystemJid = (jid) => {
  if (!jid) {
    return true;
  }

  return (
    jid.includes('@broadcast') ||
    jid.includes('status.broadcast') ||
    jid.includes('@newsletter') ||
    jid.includes('@newsletter.')
  );
};


// ============================================================
// MAIN MESSAGE HANDLER
// ============================================================

const handleMessage = async (
  sock,
  msg
) => {

  try {

    if (
      !msg ||
      !msg.message
    ) {
      return;
    }

    const from =
      msg.key?.remoteJid;

    if (!from) {
      return;
    }

    if (
      isSystemJid(from)
    ) {
      return;
    }


    // ========================================================
    // FRESH CONFIG
    // ========================================================

    let currentConfig =
      config;

    try {
      delete require.cache[
        require.resolve('./config')
      ];

      currentConfig =
        require('./config');

    } catch {
      currentConfig =
        config;
    }


    // ========================================================
    // AUTO REACT
    // ========================================================

    try {
      if (
        currentConfig.autoReact &&
        !msg.key.fromMe
      ) {

        const content =
          msg.message
            ?.ephemeralMessage
            ?.message ||
          msg.message;

        const text =
          content?.conversation ||
          content
            ?.extendedTextMessage
            ?.text ||
          '';

        const mode =
          currentConfig.autoReactMode ||
          'bot';

        if (
          mode === 'bot' &&
          text.trim() &&
          ['.', '/', '#']
            .includes(
              text.trim()[0]
            )
        ) {
          await sock.sendMessage(
            from,
            {
              react: {
                text: '⏳',
                key: msg.key
              }
            }
          );
        }

        if (
          mode === 'all'
        ) {
          const emojis = [
            '❤️',
            '🔥',
            '👌',
            '💀',
            '😁',
            '✨',
            '👍',
            '🤨',
            '😎',
            '😂',
            '🤝',
            '💫'
          ];

          const emoji =
            emojis[
              Math.floor(
                Math.random() *
                emojis.length
              )
            ];

          await sock.sendMessage(
            from,
            {
              react: {
                text: emoji,
                key: msg.key
              }
            }
          );
        }
      }
    } catch (error) {
      console.error(
        '[AUTOREACT]',
        error.message
      );
    }


    // ========================================================
    // CONTENT
    // ========================================================

    const content =
      getMessageContent(msg);

    if (!content) {
      return;
    }

    const ignoredTypes = [
      'protocolMessage',
      'senderKeyDistributionMessage',
      'messageContextInfo'
    ];

    const messageTypes =
      Object.keys(content)
        .filter(
          key =>
            !ignoredTypes.includes(key)
        );

    if (!messageTypes.length) {
      return;
    }


    // ========================================================
    // SENDER
    // ========================================================

    const sender =
      msg.key.fromMe
        ? (
            sock.user?.id
              ? `${sock.user.id
                  .split(':')[0]
                  .split('@')[0]}@s.whatsapp.net`
              : from
          )
        : (
            msg.key.participant ||
            from
          );

    const isGroup =
      from.endsWith('@g.us');


    // ========================================================
    // GROUP METADATA
    // ========================================================

    const groupMetadata =
      isGroup
        ? await getGroupMetadata(
            sock,
            from
          )
        : null;


    // ========================================================
    // ANTIGROUP STATUS
    // ========================================================

    if (
      isGroup &&
      !msg.key.fromMe
    ) {
      try {
        const blocked =
          await handleAntigroupstatus(
            sock,
            msg,
            groupMetadata,
            content
          );

        if (blocked) {
          return;
        }
      } catch (error) {
        console.error(
          '[ANTIGROUPSTATUS]',
          error.message
        );
      }
    }


    // ========================================================
    // ANTISTICKER
    // ========================================================

    if (
      isGroup &&
      !msg.key.fromMe
    ) {
      try {
        const blocked =
          await handleAntisticker(
            sock,
            msg,
            groupMetadata,
            content
          );

        if (blocked) {
          return;
        }
      } catch (error) {
        console.error(
          '[ANTISTICKER]',
          error.message
        );
      }
    }


    // ========================================================
    // ANTILINK
    // ========================================================

    if (
      isGroup &&
      !msg.key.fromMe
    ) {
      try {
        const blocked =
          await handleAntilink(
            sock,
            msg,
            groupMetadata
          );

        if (blocked) {
          return;
        }
      } catch (error) {
        console.error(
          '[ANTILINK]',
          error.message
        );
      }
    }


    // ========================================================
    // ANTIGROUP MENTION
    // ========================================================

    if (isGroup) {
      try {
        const blocked =
          await handleAntigroupmention(
            sock,
            msg,
            groupMetadata
          );

        if (blocked) {
          return;
        }
      } catch (error) {
        console.error(
          '[ANTIGROUPMENTION]',
          error.message
        );
      }
    }


    // ========================================================
    // GROUP STATISTICS
    // ========================================================

    if (isGroup) {

      const ctx =
        content
          ?.extendedTextMessage
          ?.contextInfo;

      try {
        addMessage(
          from,
          sender,
          {
            mentions:
              ctx?.mentionedJid || [],

            sticker:
              !!content?.stickerMessage
          }
        );
      } catch (error) {
        console.error(
          '[GROUPSTATS]',
          error.message
        );
      }


      // ======================================================
      // AUTO LEVEL
      // ======================================================

      if (!msg.key.fromMe) {
        try {
          const result =
            tryAutoLevelUp(
              from,
              sender
            );

          if (
            result?.leveled
          ) {
            await sock.sendMessage(
              from,
              {
                text:
                  formatLevelUpMessage(
                    result.before,
                    result.after,
                    result.role,
                    result.diamondsEarned
                  ),
                mentions: [
                  sender
                ]
              },
              {
                quoted: msg
              }
            );
          }
        } catch {
          // Ignore economy errors
        }
      }
    }


    // ========================================================
    // MESSAGE BODY
    // ========================================================

    let body = '';

    if (content.conversation) {
      body =
        content.conversation;

    } else if (
      content.extendedTextMessage
    ) {
      body =
        content.extendedTextMessage.text ||
        '';

    } else if (
      content.imageMessage
    ) {
      body =
        content.imageMessage.caption ||
        '';

    } else if (
      content.videoMessage
    ) {
      body =
        content.videoMessage.caption ||
        '';
    }

    body =
      String(body || '')
        .trim();


    // ========================================================
    // GROUP SETTINGS
    // ========================================================

    if (isGroup) {

      const groupSettings =
        database.getGroupSettings(
          from
        );


      // ======================================================
      // ANTITAG
      // ======================================================

      if (
        groupSettings.antitag &&
        !msg.key.fromMe
      ) {

        const ctx =
          content
            ?.extendedTextMessage
            ?.contextInfo ||
          content
            ?.imageMessage
            ?.contextInfo ||
          content
            ?.videoMessage
            ?.contextInfo;

        const mentionedJids =
          ctx?.mentionedJid || [];

        const numericMentions =
          body.match(
            /@\d{7,}/g
          ) || [];

        const numericSet =
          new Set();

        for (
          const mention of numericMentions
        ) {
          const match =
            mention.match(
              /@(\d+)/
            );

          if (match) {
            numericSet.add(
              match[1]
            );
          }
        }

        const totalMentions =
          Math.max(
            mentionedJids.length,
            numericSet.size
          );

        if (
          totalMentions >= 3
        ) {

          const participants =
            groupMetadata
              ?.participants || [];

          const threshold =
            Math.max(
              3,
              Math.ceil(
                participants.length *
                0.5
              )
            );

          const manyMentions =
            numericSet.size >= 10 ||
            (
              numericSet.size >= 5 &&
              numericSet.size >= threshold
            );

          if (
            totalMentions >= threshold ||
            manyMentions
          ) {

            const admin =
              await isAdmin(
                sock,
                sender,
                from,
                groupMetadata
              );

            if (
              !admin &&
              !isOwner(sender)
            ) {

              const action =
                (
                  groupSettings
                    .antitagAction ||
                  'delete'
                ).toLowerCase();

              try {
                await sock.sendMessage(
                  from,
                  {
                    delete: msg.key
                  }
                );
              } catch {}

              if (
                action === 'kick'
              ) {

                const botAdmin =
                  await isBotAdmin(
                    sock,
                    from,
                    groupMetadata
                  );

                if (botAdmin) {
                  try {
                    await sock.groupParticipantsUpdate(
                      from,
                      [sender],
                      'remove'
                    );
                  } catch {}
                }
              }

              try {
                await sock.sendMessage(
                  from,
                  {
                    text:
                      '⚠️ *Tagall Detected!*',
                    mentions: [
                      sender
                    ]
                  },
                  {
                    quoted: msg
                  }
                );
              } catch {}

              return;
            }
          }
        }
      }


      // ======================================================
      // ANTIBADWORD
      // ======================================================

      if (
        groupSettings.antibadword &&
        !msg.key.fromMe &&
        body
      ) {

        try {
          const blocked =
            await handleAntibadword(
              sock,
              msg,
              groupMetadata,
              body,
              sender
            );

          if (blocked) {
            return;
          }
        } catch (error) {
          console.error(
            '[ANTIBADWORD]',
            error.message
          );
        }
      }


      // ======================================================
      // AUTOSTICKER
      // ======================================================

      if (
        groupSettings.autosticker
      ) {

        const media =
          content.imageMessage ||
          content.videoMessage;

        if (
          media &&
          !body.startsWith(
            currentConfig.prefix
          )
        ) {

          try {

            const stickerCommand =
              commands.get(
                'sticker'
              );

            if (
              stickerCommand
            ) {

              const senderAdmin =
                await isAdmin(
                  sock,
                  sender,
                  from,
                  groupMetadata
                );

              const botAdmin =
                await isBotAdmin(
                  sock,
                  from,
                  groupMetadata
                );

              await stickerCommand.execute(
                sock,
                msg,
                [],
                {
                  from,
                  sender,
                  isGroup,
                  groupMetadata,

                  isOwner:
                    isOwner(sender),

                  isAdmin:
                    senderAdmin,

                  isBotAdmin:
                    botAdmin,

                  isMod:
                    isMod(sender),

                  reply: async text =>
                    sock.sendMessage(
                      from,
                      { text },
                      {
                        quoted: msg
                      }
                    ),

                  react: async emoji =>
                    sock.sendMessage(
                      from,
                      {
                        react: {
                          text: emoji,
                          key: msg.key
                        }
                      }
                    )
                }
              );

              return;
            }

          } catch (error) {
            console.error(
              '[AUTOSTICKER]',
              error.message
            );
          }
        }
      }
    }


    // ========================================================
    // ACTIVE BOMB
    // ========================================================

    try {

      const bomb =
        require(
          './commands/fun/bomb'
        );

      if (
        bomb.gameState?.has(
          sender
        )
      ) {

        const command =
          commands.get(
            'bomb'
          );

        if (
          command?.execute
        ) {

          await command.execute(
            sock,
            msg,
            [],
            createCommandContext(
              sock,
              msg,
              from,
              sender,
              isGroup,
              groupMetadata
            )
          );

          return;
        }
      }

    } catch {
      // Ignore bomb errors
    }


    // ========================================================
    // TIC TAC TOE
    // ========================================================

    try {

      const ttt =
        require(
          './commands/fun/tictactoe'
        );

      if (
        typeof ttt.handleTicTacToeMove ===
        'function'
      ) {

        const games =
          Object.values(
            ttt.games || {}
          );

        const playing =
          games.some(
            room =>
              room?.id?.startsWith(
                'tictactoe'
              ) &&
              [
                room.game?.playerX,
                room.game?.playerO
              ].includes(sender) &&
              room.state === 'PLAYING'
          );

        if (playing) {

          const handled =
            await ttt.handleTicTacToeMove(
              sock,
              msg,
              createCommandContext(
                sock,
                msg,
                from,
                sender,
                isGroup,
                groupMetadata
              )
            );

          if (handled) {
            return;
          }
        }
      }

    } catch {
      // Ignore tic tac toe errors
    }


    // ========================================================
    // OTHER FUN GAMES
    // ========================================================

    try {

      const {
        handleGameInput
      } = require(
        './utils/funGames'
      );

      if (
        typeof handleGameInput ===
        'function'
      ) {

        const handled =
          await handleGameInput(
            sock,
            msg,
            {
              from,
              sender,
              isGroup,
              groupMetadata,

              isOwner:
                isOwner(sender),

              reply: async text =>
                sock.sendMessage(
                  from,
                  { text },
                  {
                    quoted: msg
                  }
                )
            }
          );

        if (handled) {
          return;
        }
      }

    } catch {
      // Ignore game errors
    }


    // ========================================================
    // AFK
    // ========================================================

    if (
      !msg.key.fromMe
    ) {

      try {

        const afk =
          require(
            './utils/afk'
          );

        if (
          afk.isEnabled() &&
          !isOwner(sender)
        ) {

          let shouldHandle =
            false;

          if (!isGroup) {
            shouldHandle = true;

          } else {

            const ctx =
              content
                ?.extendedTextMessage
                ?.contextInfo ||
              content
                ?.imageMessage
                ?.contextInfo ||
              content
                ?.videoMessage
                ?.contextInfo ||
              content
                ?.stickerMessage
                ?.contextInfo;

            const mentioned =
              ctx?.mentionedJid || [];

            const mentionedBot =
              mentioned.some(
                jid =>
                  isBotJid(
                    jid,
                    sock
                  )
              );

            const replyToBot =
              ctx?.participant &&
              isBotJid(
                ctx.participant,
                sock
              );

            shouldHandle =
              (
                mentionedBot ||
                replyToBot
              ) &&
              !body.startsWith(
                currentConfig.prefix
              );
          }

          if (
            shouldHandle
          ) {

            if (
              afk.shouldNotify(
                from,
                sender
              )
            ) {

              afk.markNotified(
                from,
                sender
              );

              await sock.sendMessage(
                from,
                {
                  text:
                    afk.getMessage()
                },
                {
                  quoted: msg
                }
              );
            }

            return;
          }
        }

      } catch (error) {
        console.error(
          '[AFK]',
          error.message
        );
      }
    }


    // ========================================================
    // CHATBOT
    // ========================================================

    if (
      !msg.key.fromMe &&
      isGroup
    ) {

      try {

        const settings =
          database.getGroupSettings(
            from
          );

        if (
          settings.chatbot
        ) {

          const ctx =
            content
              ?.extendedTextMessage
              ?.contextInfo ||
            content
              ?.imageMessage
              ?.contextInfo ||
            content
              ?.videoMessage
              ?.contextInfo;

          const mentioned =
            ctx?.mentionedJid || [];

          const mentionedBot =
            mentioned.some(
              jid =>
                isBotJid(
                  jid,
                  sock
                )
            );

          const replyToBot =
            ctx?.participant &&
            isBotJid(
              ctx.participant,
              sock
            );

          if (
            (
              mentionedBot ||
              replyToBot
            ) &&
            !body.startsWith(
              currentConfig.prefix
            )
          ) {

            await chatbotCmd.handleChat(
              sock,
              msg,
              body,
              sender
            );

            return;
          }
        }

      } catch (error) {
        console.error(
          '[CHATBOT]',
          error.message
        );
      }
    }


    // ========================================================
    // COMMAND PREFIX
    // ========================================================

    if (
      !body.startsWith(
        currentConfig.prefix
      )
    ) {
      return;
    }

    const commandText =
      body
        .slice(
          currentConfig.prefix.length
        )
        .trim();

    if (!commandText) {
      return;
    }

    const parts =
      commandText.split(/\s+/);

    const commandName =
      (
        parts.shift() || ''
      ).toLowerCase();

    const args =
      parts;


    // ========================================================
    // FIND COMMAND
    // ========================================================

    const command =
      commands.get(
        commandName
      );

    if (!command) {
      return;
    }


    // ========================================================
    // SELF MODE
    // ========================================================

    if (
      currentConfig.selfMode &&
      !isOwner(sender)
    ) {
      return;
    }


    // ========================================================
    // PERMISSIONS
    // ========================================================

    const senderOwner =
      isOwner(sender);

    const senderMod =
      isMod(sender);

    let senderAdmin =
      false;

    let botAdmin =
      false;

    if (isGroup) {

      senderAdmin =
        await isAdmin(
          sock,
          sender,
          from,
          groupMetadata
        );

      if (
        command.botAdminNeeded
      ) {
        botAdmin =
          await isBotAdmin(
            sock,
            from,
            groupMetadata
          );
      }
    }


    // ========================================================
    // OWNER ONLY
    // ========================================================

    if (
      command.ownerOnly &&
      !senderOwner
    ) {
      return await sock.sendMessage(
        from,
        {
          text:
            currentConfig.messages
              ?.ownerOnly ||
            '🔒 This command is only available to the owner.'
        },
        {
          quoted: msg
        }
      );
    }


    // ========================================================
    // MOD ONLY
    // ========================================================

    if (
      command.modOnly &&
      !senderMod &&
      !senderOwner
    ) {
      return await sock.sendMessage(
        from,
        {
          text:
            '🔒 This command is only for moderators!'
        },
        {
          quoted: msg
        }
      );
    }


    // ========================================================
    // GROUP ONLY
    // ========================================================

    if (
      command.groupOnly &&
      !isGroup
    ) {
      return await sock.sendMessage(
        from,
        {
          text:
            currentConfig.messages
              ?.groupOnly ||
            '❌ This command can only be used in groups.'
        },
        {
          quoted: msg
        }
      );
    }


    // ========================================================
    // PRIVATE ONLY
    // ========================================================

    if (
      command.privateOnly &&
      isGroup
    ) {
      return await sock.sendMessage(
        from,
        {
          text:
            currentConfig.messages
              ?.privateOnly ||
            '❌ This command can only be used in private chat.'
        },
        {
          quoted: msg
        }
      );
    }


    // ========================================================
    // ADMIN ONLY
    // ========================================================

    if (
      command.adminOnly &&
      !senderAdmin &&
      !senderOwner
    ) {
      return await sock.sendMessage(
        from,
        {
          text:
            currentConfig.messages
              ?.adminOnly ||
            '🔒 This command is only for group admins.'
        },
        {
          quoted: msg
        }
      );
    }


    // ========================================================
    // BOT ADMIN
    // ========================================================

    if (
      command.botAdminNeeded &&
      !botAdmin
    ) {
      return await sock.sendMessage(
        from,
        {
          text:
            currentConfig.messages
              ?.botAdminNeeded ||
            '❌ I need to be a group admin to use this command.'
        },
        {
          quoted: msg
        }
      );
    }


    // ========================================================
    // AUTO TYPING
    // ========================================================

    if (
      currentConfig.autoTyping
    ) {
      try {
        await sock.sendPresenceUpdate(
          'composing',
          from
        );
      } catch {}
    }


    // ========================================================
    // COMMAND EXECUTION
    // ========================================================

    console.log(
      `[COMMAND] ${commandName} | ${sender}`
    );

    await command.execute(
      sock,
      msg,
      args,
      createCommandContext(
        sock,
        msg,
        from,
        sender,
        isGroup,
        groupMetadata,
        senderAdmin,
        botAdmin,
        senderOwner,
        senderMod
      )
    );

  } catch (error) {

    console.error(
      '[MESSAGE HANDLER ERROR]',
      error
    );

    if (
      error?.message?.includes(
        'rate-overlimit'
      )
    ) {
      return;
    }

    try {

      await sock.sendMessage(
        msg?.key?.remoteJid,
        {
          text:
            `${config.messages?.error || '❌ Something went wrong.'}\n\n${error.message || ''}`
        },
        {
          quoted: msg
        }
      );

    } catch (sendError) {

      if (
        !sendError?.message?.includes(
          'rate-overlimit'
        )
      ) {
        console.error(
          '[ERROR MESSAGE SEND]',
          sendError
        );
      }
    }
  }
};


// ============================================================
// COMMAND CONTEXT
// ============================================================

function createCommandContext(
  sock,
  msg,
  from,
  sender,
  isGroup,
  groupMetadata,
  senderAdmin = false,
  botAdmin = false,
  senderOwner = isOwner(sender),
  senderMod = isMod(sender)
) {
  return {
    from,
    sender,
    isGroup,
    groupMetadata,

    isOwner:
      senderOwner,

    isAdmin:
      senderAdmin,

    isBotAdmin:
      botAdmin,

    isMod:
      senderMod,

    reply: async text => {
      return sock.sendMessage(
        from,
        {
          text: String(text)
        },
        {
          quoted: msg
        }
      );
    },

    react: async emoji => {
      return sock.sendMessage(
        from,
        {
          react: {
            text: emoji,
            key: msg.key
          }
        }
      );
    }
  };
}


// ============================================================
// PART 1 ENDS HERE
// ============================================================
//
// PART 2 MUST BE PASTED DIRECTLY BELOW THIS LINE.
//
// There must NOT be another handleMessage.
// ============================================================
// ============================================================
// Jinwoo Mini-Bot
// handler.js — PART 2/2
// ============================================================
//
// IMPORTANT:
// This is a continuation of Part 1.
// Do NOT create another handleMessage here.
// ============================================================


// ============================================================
// GROUP PARTICIPANT UPDATE
// ============================================================

const handleGroupUpdate = async (
  sock,
  update
) => {

  try {

    const {
      id,
      participants,
      action
    } = update || {};

    if (
      !id ||
      !id.endsWith('@g.us')
    ) {
      return;
    }

    const settings =
      database.getGroupSettings(
        id
      );

    if (
      !settings?.welcome &&
      !settings?.goodbye
    ) {
      return;
    }

    const metadata =
      await getGroupMetadata(
        sock,
        id
      );

    if (!metadata) {
      return;
    }

    const list =
      Array.isArray(participants)
        ? participants
        : [];

    for (
      const participant of list
    ) {

      const participantJid =
        typeof participant === 'string'
          ? participant
          : participant?.id ||
            participant?.jid ||
            participant?.participant;

      if (!participantJid) {
        continue;
      }

      const participantNumber =
        normalizeJid(
          participantJid
        );


      // ======================================================
      // WELCOME
      // ======================================================

      if (
        action === 'add' &&
        settings.welcome
      ) {

        try {

          let displayName =
            participantNumber;

          const info =
            metadata.participants?.find(
              p => {

                const ids = [
                  p?.id,
                  p?.lid,
                  p?.phoneNumber,
                  p?.userJid
                ].filter(Boolean);

                return ids.some(
                  value =>
                    value ===
                      participantJid ||
                    normalizeJid(value) ===
                      participantNumber
                );
              }
            );

          if (info) {
            displayName =
              info.notify ||
              info.name ||
              participantNumber;
          }


          // ==================================================
          // PROFILE PICTURE
          // ==================================================

          let profilePicUrl =
            '';

          try {

            profilePicUrl =
              await sock.profilePictureUrl(
                participantJid,
                'image'
              );

          } catch {

            profilePicUrl =
              'https://img.pyrocdn.com/dbKUgahg.png';
          }


          const groupName =
            metadata.subject ||
            'the group';

          const groupDesc =
            metadata.desc ||
            'No description';

          const time =
            new Date()
              .toLocaleTimeString(
                'en-US',
                {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true
                }
              );


          // ==================================================
          // WELCOME MESSAGE
          // ==================================================

          const welcomeMsg =
`╭╼━≪•𝙽𝙴𝚆 𝙼𝙴𝙼𝙱𝙴𝚁•≫━╾╮
┃𝚆𝙴𝙻𝙲𝙾𝙼𝙴: @${participantNumber} 👋
┃Member count: #${metadata.participants?.length || 0}
┃𝚃𝙸𝙼𝙴: ${time} ⏰
╰━━━━━━━━━━━━━━━╯

*@${participantNumber}* Welcome to *${groupName}*! 🎉

*Group 𝙳𝙴𝚂𝙲𝚁𝙸𝙿𝚃𝙸𝙾𝙽*
${groupDesc}

> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ${config.botName || 'Jinwoo Mini-Bot'}*`;


          // ==================================================
          // WELCOME IMAGE API
          // ==================================================

          const apiUrl =
            `https://api.some-random-api.com/welcome/img/7/gaming4` +
            `?type=join` +
            `&textcolor=white` +
            `&username=${encodeURIComponent(
              displayName
            )}` +
            `&guildName=${encodeURIComponent(
              groupName
            )}` +
            `&memberCount=${
              metadata.participants?.length || 0
            }` +
            `&avatar=${encodeURIComponent(
              profilePicUrl
            )}`;


          try {

            const response =
              await axios.get(
                apiUrl,
                {
                  responseType:
                    'arraybuffer',
                  timeout: 15000
                }
              );

            await sock.sendMessage(
              id,
              {
                image:
                  Buffer.from(
                    response.data
                  ),

                caption:
                  welcomeMsg,

                mentions: [
                  participantJid
                ]
              }
            );

          } catch {

            const fallback =
              settings.welcomeMessage ||
              'Welcome @user to @group! 👋';

            await sock.sendMessage(
              id,
              {
                text:
                  fallback
                    .replace(
                      '@user',
                      `@${participantNumber}`
                    )
                    .replace(
                      '@group',
                      groupName
                    ),

                mentions: [
                  participantJid
                ]
              }
            );
          }

        } catch (error) {

          console.error(
            '[WELCOME ERROR]',
            error.message
          );
        }
      }


      // ======================================================
      // GOODBYE
      // ======================================================

      if (
        action === 'remove' &&
        settings.goodbye
      ) {

        try {

          const goodbye =
            `Goodbye @${participantNumber} 👋 We will never miss you! 💀`;

          await sock.sendMessage(
            id,
            {
              text: goodbye,

              mentions: [
                participantJid
              ]
            }
          );

        } catch (error) {

          console.error(
            '[GOODBYE ERROR]',
            error.message
          );
        }
      }
    }

  } catch (error) {

    if (
      error?.message?.includes(
        'forbidden'
      ) ||
      error?.message?.includes(
        '403'
      ) ||
      error?.statusCode === 403
    ) {
      return;
    }

    console.error(
      '[GROUP UPDATE ERROR]',
      error
    );
  }
};


// ============================================================
// ANTILINK
// ============================================================

const handleAntilink = async (
  sock,
  msg,
  groupMetadata
) => {

  try {

    const from =
      msg?.key?.remoteJid;

    if (
      !from ||
      !from.endsWith('@g.us')
    ) {
      return false;
    }

    const sender =
      msg.key.participant ||
      from;

    const settings =
      database.getGroupSettings(
        from
      );

    if (
      !settings?.antilink
    ) {
      return false;
    }

    const content =
      getMessageContent(msg);

    const body =
      content?.conversation ||
      content
        ?.extendedTextMessage
        ?.text ||
      content
        ?.imageMessage
        ?.caption ||
      content
        ?.videoMessage
        ?.caption ||
      '';

    if (!body) {
      return false;
    }


    // Matches normal URLs/domains
    const linkPattern =
      /(https?:\/\/|www\.)[^\s]+|(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?/i;

    if (
      !linkPattern.test(body)
    ) {
      return false;
    }


    const admin =
      await isAdmin(
        sock,
        sender,
        from,
        groupMetadata
      );

    if (
      admin ||
      isOwner(sender)
    ) {
      return false;
    }


    const botAdmin =
      await isBotAdmin(
        sock,
        from,
        groupMetadata
      );

    if (!botAdmin) {
      return false;
    }


    const action =
      (
        settings.antilinkAction ||
        'delete'
      ).toLowerCase();


    // ========================================================
    // DELETE
    // ========================================================

    try {

      await sock.sendMessage(
        from,
        {
          delete: msg.key
        }
      );

    } catch (error) {

      console.error(
        '[ANTILINK DELETE]',
        error.message
      );
    }


    // ========================================================
    // KICK
    // ========================================================

    if (
      action === 'kick'
    ) {

      try {

        await sock.groupParticipantsUpdate(
          from,
          [sender],
          'remove'
        );

      } catch (error) {

        console.error(
          '[ANTILINK KICK]',
          error.message
        );
      }
    }


    // ========================================================
    // WARN
    // ========================================================

    if (
      action === 'warn'
    ) {

      try {

        const result =
          database.addWarning(
            from,
            sender,
            'Antilink'
          );

        const maxWarnings =
          config.maxWarnings || 3;

        await sock.sendMessage(
          from,
          {
            text:
              `⚠️ @${normalizeJid(sender)} don't send links here.\n\nWarnings: ${result.count}/${maxWarnings}`,
            mentions: [
              sender
            ]
          },
          {
            quoted: msg
          }
        );

        if (
          result.count >=
          maxWarnings
        ) {

          await sock.groupParticipantsUpdate(
            from,
            [sender],
            'remove'
          );

          database.clearWarnings(
            from,
            sender
          );
        }

      } catch (error) {

        console.error(
          '[ANTILINK WARNING]',
          error.message
        );
      }
    }

    return true;

  } catch (error) {

    console.error(
      '[ANTILINK ERROR]',
      error
    );

    return false;
  }
};


// ============================================================
// ANTIGROUP STATUS
// ============================================================

const isGroupStatusPost = (
  msg,
  content
) => {

  if (
    content?.groupStatusMentionMessage
  ) {
    return true;
  }

  if (
    content?.statusMentionMessage
  ) {
    return true;
  }

  const message =
    msg?.message;

  if (
    message?.groupStatusMentionMessage
  ) {
    return true;
  }

  if (
    message?.statusMentionMessage
  ) {
    return true;
  }

  return false;
};


const handleAntigroupstatus =
  async (
    sock,
    msg,
    groupMetadata,
    content
  ) => {

    try {

      const from =
        msg?.key?.remoteJid;

      if (
        !from ||
        !from.endsWith('@g.us')
      ) {
        return false;
      }

      const sender =
        msg.key.participant ||
        from;

      const settings =
        database.getGroupSettings(
          from
        );

      if (
        !settings?.antigroupstatus
      ) {
        return false;
      }

      if (
        !isGroupStatusPost(
          msg,
          content
        )
      ) {
        return false;
      }

      const admin =
        await isAdmin(
          sock,
          sender,
          from,
          groupMetadata
        );

      if (
        admin ||
        isOwner(sender)
      ) {
        return false;
      }

      const botAdmin =
        await isBotAdmin(
          sock,
          from,
          groupMetadata
        );

      if (!botAdmin) {
        return false;
      }


      try {

        await sock.sendMessage(
          from,
          {
            delete: msg.key
          }
        );

      } catch (error) {

        console.error(
          '[ANTIGROUPSTATUS DELETE]',
          error.message
        );
      }


      const action =
        (
          settings.antigroupstatusAction ||
          'delete'
        ).toLowerCase();


      if (
        action === 'kick'
      ) {

        try {

          await sock.groupParticipantsUpdate(
            from,
            [sender],
            'remove'
          );

        } catch (error) {

          console.error(
            '[ANTIGROUPSTATUS KICK]',
            error.message
          );
        }
      }

      return true;

    } catch (error) {

      console.error(
        '[ANTIGROUPSTATUS ERROR]',
        error
      );

      return false;
    }
  };


// ============================================================
// ANTISTICKER
// ============================================================

const handleAntisticker =
  async (
    sock,
    msg,
    groupMetadata,
    content
  ) => {

    try {

      const from =
        msg?.key?.remoteJid;

      if (
        !from ||
        !from.endsWith('@g.us')
      ) {
        return false;
      }

      const sender =
        msg.key.participant ||
        from;

      const settings =
        database.getGroupSettings(
          from
        );

      if (
        !settings?.antisticker
      ) {
        return false;
      }

      const messageContent =
        content ||
        getMessageContent(msg);

      if (
        !messageContent?.stickerMessage
      ) {
        return false;
      }


      const admin =
        await isAdmin(
          sock,
          sender,
          from,
          groupMetadata
        );

      if (
        admin ||
        isOwner(sender)
      ) {
        return false;
      }


      const botAdmin =
        await isBotAdmin(
          sock,
          from,
          groupMetadata
        );

      if (!botAdmin) {
        return false;
      }


      try {

        await sock.sendMessage(
          from,
          {
            delete: msg.key
          }
        );

      } catch (error) {

        console.error(
          '[ANTISTICKER DELETE]',
          error.message
        );
      }


      const action =
        (
          settings.antistickerAction ||
          'delete'
        ).toLowerCase();


      if (
        action === 'kick'
      ) {

        try {

          await sock.groupParticipantsUpdate(
            from,
            [sender],
            'remove'
          );

        } catch (error) {

          console.error(
            '[ANTISTICKER KICK]',
            error.message
          );
        }
      }

      return true;

    } catch (error) {

      console.error(
        '[ANTISTICKER ERROR]',
        error
      );

      return false;
    }
  };


// ============================================================
// ANTIBADWORD
// ============================================================

const handleAntibadword =
  async (
    sock,
    msg,
    groupMetadata,
    userMessage,
    sender
  ) => {

    try {

      const from =
        msg?.key?.remoteJid;

      if (
        !from ||
        !from.endsWith('@g.us')
      ) {
        return false;
      }

      const settings =
        database.getGroupSettings(
          from
        );

      if (
        !settings?.antibadword
      ) {
        return false;
      }

      if (
        !containsBadWord(
          userMessage
        )
      ) {
        return false;
      }


      const admin =
        await isAdmin(
          sock,
          sender,
          from,
          groupMetadata
        );

      if (
        admin ||
        isOwner(sender)
      ) {
        return false;
      }


      const botAdmin =
        await isBotAdmin(
          sock,
          from,
          groupMetadata
        );

      if (!botAdmin) {
        return false;
      }


      try {

        await sock.sendMessage(
          from,
          {
            delete: msg.key
          }
        );

      } catch (error) {

        console.error(
          '[ANTIBADWORD DELETE]',
          error.message
        );
      }


      const action =
        (
          settings.antibadwordAction ||
          'delete'
        ).toLowerCase();


      // ======================================================
      // KICK
      // ======================================================

      if (
        action === 'kick'
      ) {

        try {

          await sock.groupParticipantsUpdate(
            from,
            [sender],
            'remove'
          );

        } catch (error) {

          console.error(
            '[ANTIBADWORD KICK]',
            error.message
          );
        }
      }


      // ======================================================
      // WARN
      // ======================================================

      if (
        action === 'warn'
      ) {

        try {

          const result =
            database.addWarning(
              from,
              sender,
              'Bad words'
            );

          const maxWarnings =
            config.maxWarnings || 3;


          await sock.sendMessage(
            from,
            {
              text:
                `⚠️ @${normalizeJid(sender)} *watch your language!*\n\nWarnings: ${result.count}/${maxWarnings}`,
              mentions: [
                sender
              ]
            },
            {
              quoted: msg
            }
          );


          if (
            result.count >=
            maxWarnings
          ) {

            await sock.groupParticipantsUpdate(
              from,
              [sender],
              'remove'
            );

            database.clearWarnings(
              from,
              sender
            );
          }

        } catch (error) {

          console.error(
            '[ANTIBADWORD WARNING]',
            error.message
          );
        }
      }


      return true;

    } catch (error) {

      console.error(
        '[ANTIBADWORD ERROR]',
        error
      );

      return false;
    }
  };


// ============================================================
// ANTIGROUP MENTION
// ============================================================

const handleAntigroupmention =
  async (
    sock,
    msg,
    groupMetadata
  ) => {

    try {

      const from =
        msg?.key?.remoteJid;

      if (
        !from ||
        !from.endsWith('@g.us')
      ) {
        return false;
      }

      const settings =
        database.getGroupSettings(
          from
        );

      if (
        !settings?.antigroupmention
      ) {
        return false;
      }

      const content =
        getMessageContent(msg);

      const ctx =
        content
          ?.extendedTextMessage
          ?.contextInfo ||
        content
          ?.imageMessage
          ?.contextInfo ||
        content
          ?.videoMessage
          ?.contextInfo;

      const mentions =
        ctx?.mentionedJid || [];

      if (
        mentions.length === 0
      ) {
        return false;
      }

      const sender =
        msg.key.participant ||
        from;

      const admin =
        await isAdmin(
          sock,
          sender,
          from,
          groupMetadata
        );

      if (
        admin ||
        isOwner(sender)
      ) {
        return false;
      }

      const threshold =
        settings.antigroupmentionThreshold ||
        5;

      if (
        mentions.length <
        threshold
      ) {
        return false;
      }

      const botAdmin =
        await isBotAdmin(
          sock,
          from,
          groupMetadata
        );

      if (!botAdmin) {
        return false;
      }


      try {

        await sock.sendMessage(
          from,
          {
            delete: msg.key
          }
        );

      } catch {}


      const action =
        (
          settings.antigroupmentionAction ||
          'delete'
        ).toLowerCase();


      if (
        action === 'kick'
      ) {

        try {

          await sock.groupParticipantsUpdate(
            from,
            [sender],
            'remove'
          );

        } catch (error) {

          console.error(
            '[ANTIGROUPMENTION KICK]',
            error.message
          );
        }
      }


      return true;

    } catch (error) {

      console.error(
        '[ANTIGROUPMENTION ERROR]',
        error
      );

      return false;
    }
  };


// ============================================================
// ANTICALL INITIALIZER
// ============================================================
//
// Safe initializer so the export always exists.
// Your main connection file can call it if needed.
// ============================================================

const initializeAntiCall = (
  sock
) => {

  if (
    !sock ||
    typeof sock.ev?.on !==
      'function'
  ) {
    return;
  }

  // Prevent duplicate registration.
  if (
    sock.__jinwooAntiCallInitialized
  ) {
    return;
  }

  sock.__jinwooAntiCallInitialized =
    true;


  sock.ev.on(
    'call',
    async calls => {

      try {

        if (
          !Array.isArray(calls)
        ) {
          return;
        }

        const currentConfig =
          require('./config');

        if (
          !currentConfig.antiCall
        ) {
          return;
        }

        for (
          const call of calls
        ) {

          const caller =
            call?.from;

          if (!caller) {
            continue;
          }

          // Do not reject the bot's own calls.
          if (
            call?.status ===
            'accept'
          ) {
            continue;
          }

          try {

            await sock.rejectCall(
              call.id,
              caller
            );

          } catch (error) {

            console.error(
              '[ANTICALL]',
              error.message
            );
          }


          try {

            await sock.sendMessage(
              caller,
              {
                text:
                  currentConfig.messages
                    ?.antiCall ||
                  '📵 Calls are not allowed. Please send a message instead.'
              }
            );

          } catch {}
        }

      } catch (error) {

        console.error(
          '[ANTICALL HANDLER]',
          error
        );
      }
    }
  );
};


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

  // Main handlers
  handleMessage,
  handleGroupUpdate,

  // Group protections
  handleAntilink,
  handleAntibadword,
  handleAntisticker,
  handleAntigroupstatus,
  handleAntigroupmention,

  // Anti-call
  initializeAntiCall,

  // Permission helpers
  isOwner,
  isAdmin,
  isBotAdmin,
  isMod,

  // Metadata helpers
  getGroupMetadata,
  findParticipant,

  // Utility
  normalizeJid,
  normalizeJidWithLid,
  isBotJid,

  // Sticker helper
  getAntibadwordSticker
};


// ============================================================
// END OF handler.js
// ============================================================