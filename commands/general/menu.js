/**
 * Jinwoo Mini-Bot — Clean WhatsApp Menu
 * One command per line for a readable, polished layout.
 * Dynamically renders every successfully loaded command.
 */

const config = require('../../config');
const { loadCommands } = require('../../utils/commandLoader');

const CATEGORY_ORDER = [
  'general', 'ai', 'group', 'admin', 'owner',
  'media', 'fun', 'economy', 'utility', 'anime', 'textmaker'
];

const CATEGORY_META = {
  general: ['🧭', 'GENERAL'],
  ai: ['🤖', 'ARTIFICIAL INTELLIGENCE'],
  group: ['👥', 'GROUP'],
  admin: ['🛡️', 'ADMIN'],
  owner: ['👑', 'OWNER'],
  media: ['🎬', 'MEDIA & DOWNLOADS'],
  fun: ['🎮', 'FUN & GAMES'],
  economy: ['💰', 'ECONOMY'],
  utility: ['🛠️', 'UTILITY'],
  anime: ['🌸', 'ANIME'],
  textmaker: ['🎨', 'TEXT MAKER'],
  other: ['📦', 'OTHER']
};

// Relevant emojis keep the menu varied without making it noisy.
const COMMAND_EMOJIS = {
  menu: '🏠', help: '📖', ai: '🧠', chatbot: '💬',
  owner: '👑', creator: '👑', dev: '👨‍💻', botowner: '🤴',
  ping: '📡', uptime: '⏱️', qr: '🔳', github: '🐙',
  groupinfo: '👥', groupstats: '📊', list: '📋',
  sticker: '🎨', attp: '🔤', crop: '✂️', getpp: '🖼️',
  simage: '🖼️', ssweb: '🌐', take: '📥', tts: '🔊',
  viewonce: '👀',
  facebook: '📘', instagram: '📸', igs: '📸', igsc: '📷',
  lyrics: '🎵', pinterest: '📌', song: '🎶', tiktok: '🎵',
  twitter: '🐦', youtube: '▶️', ytmp3: '🎧', ytmp4: '🎬',
  download: '⬇️',
  imagine: '🪄', gptimage: '🎨', image: '🖼️',
  whois: '🔎', define: '📚', ip: '🌍', screenshot: '📸',
  weather: '🌦️', translate: '🌐', calculator: '🧮',
  dailytime: '⏰', dailyposttime: '🗓️', posttime: '🗓️'
};

function titleCase(value) {
  return String(value || 'other')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function commandEmoji(name, category) {
  if (COMMAND_EMOJIS[name]) return COMMAND_EMOJIS[name];
  const fallbacks = {
    general: '🔹', ai: '🤖', group: '👥', admin: '🛡️', owner: '👑',
    media: '🎬', fun: '🎮', economy: '💰', utility: '🛠️',
    anime: '🌸', textmaker: '🎨', other: '📦'
  };
  return fallbacks[category] || '🔹';
}

module.exports = {
  name: 'menu',
  aliases: ['help', 'commands'],
  category: 'general',
  description: 'Show all available commands',
  usage: '.menu',

  async execute(sock, msg, args, extra) {
    try {
      const registry = loadCommands();
      const unique = new Map();

      // The command registry contains aliases too. Keep only the primary command.
      for (const cmd of registry.values()) {
        if (!cmd?.name) continue;
        if (!unique.has(cmd.name)) unique.set(cmd.name, cmd);
      }

      const visible = [...unique.values()].filter(cmd => !cmd.ownerOnly || extra.isOwner);
      const categories = new Map();

      for (const cmd of visible) {
        const category = String(cmd.category || 'other').toLowerCase();
        if (!categories.has(category)) categories.set(category, []);
        categories.get(category).push(cmd);
      }

      const ordered = [
        ...CATEGORY_ORDER.filter(c => categories.has(c)),
        ...[...categories.keys()]
          .filter(c => !CATEGORY_ORDER.includes(c))
          .sort()
      ];

      const botName = config.botName || 'Jinwoo Mini-Bot';
      const prefix = config.prefix || '+';
      const firstName = String(extra.sender || '').split('@')[0] || 'User';
      const total = visible.length;

      let text = '';
      text += `╭━━━〔 🤖 ${botName} 〕━━━╮\n`;
      text += `┃ 👋 Welcome, @${firstName}\n`;
      text += `┃ ⚡ Prefix: ${prefix}\n`;
      text += `┃ 📚 Commands: ${total}\n`;
      text += `┃ 🗂️ Categories: ${ordered.length}\n`;
      text += `╰━━━━━━━━━━━━━━━━━━━━╯\n\n`;

      text += `╭━━〔 🔥 QUICK ACCESS 〕━━╮\n`;
      text += `┃ 🏠 ${prefix}menu\n`;
      text += `┃ 📖 ${prefix}help <cmd>\n`;
      text += `┃ 🧠 ${prefix}ai <text>\n`;
      text += `┃ 💬 ${prefix}chatbot\n`;
      text += `╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n`;

      for (const category of ordered) {
        const cmds = categories.get(category) || [];
        if (!cmds.length) continue;

        cmds.sort((a, b) => a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: 'base'
        }));

        const [emoji, label] = CATEGORY_META[category] || ['📦', titleCase(category).toUpperCase()];

        text += `╭━━〔 ${emoji} ${label} • ${cmds.length} 〕━━╮\n`;
        for (const cmd of cmds) {
          text += `┃ ${commandEmoji(cmd.name, category)} ${prefix}${cmd.name}\n`;
        }
        text += `╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n`;
      }

      text += `💡 ${prefix}help <command> — command details\n`;
      text += `⚙️ Powered by ${botName}`;

      const fs = require('fs');
      const path = require('path');
      const imagePath = path.join(__dirname, '../../utils/bot_image.jpg');
      const payload = { caption: text, mentions: [extra.sender] };

      if (fs.existsSync(imagePath)) {
        payload.image = fs.readFileSync(imagePath);
      } else {
        payload.text = text;
        delete payload.caption;
      }

      await sock.sendMessage(extra.from, payload, { quoted: msg });
    } catch (error) {
      console.error('[MENU]', error);
      await extra.reply(`❌ Menu error: ${error.message}`);
    }
  }
};
