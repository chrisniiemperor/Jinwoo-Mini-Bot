const { generateApiKey } = require('../../utils/dashboardStats');
module.exports = {
  name: 'generateapi',
  aliases: ['genapi', 'api'],
  category: 'admin',
  description: 'Generate a secure API key for the Jinwoo web dashboard.',
  ownerOnly: true,
  async execute(sock, msg, args, ctx) {
    const key = generateApiKey();
    await ctx.reply(`╭━━〔 🔐 JINWOO API 〕━━╮\n┃\n┃ ✅ New dashboard API key generated.\n┃\n┃ 🔑 ${key}\n┃\n┃ ⚠️ Keep this key private.\n┃ Use it as BOT_API_KEY on your dashboard.\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━╯`);
  }
};
