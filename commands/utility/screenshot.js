const axios = require('axios');
const config = require('../../config');

module.exports = {
  name: 'screenshot',
  aliases: ['ss', 'webshot'],
  category: 'utility',
  description: 'Take a screenshot of a webpage',
  usage: '.screenshot <URL>',
  ownerOnly: false,

  async execute(sock, msg, args, extra) {
    let url = String(args[0] || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(url)) url = `https://${url}`;
      else return extra.reply('❌ Example: .screenshot https://google.com');
    }

    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol');

      await extra.reply('📸 Taking webpage screenshot...');

      // Public screenshot endpoint; no API key required.
      const imageUrl = `https://image.thum.io/get/width/1280/crop/900/noanimate/${url}`;
      const r = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 15 * 1024 * 1024
      });

      await sock.sendMessage(extra.from, {
        image: Buffer.from(r.data),
        caption: `📸 *Web Screenshot*\n${url}\n\n🤖 ${config.botName}`
      }, { quoted: msg });
    } catch (error) {
      console.error('[Screenshot]', error.message || error);
      await extra.reply('❌ Screenshot failed. The website may block automated screenshots or be unavailable.');
    }
  }
};
