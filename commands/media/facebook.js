/**
 * Facebook video downloader
 * Uses the existing @bochilteam scraper package.
 */
const { facebook } = require('@bochilteam/scraper');
const config = require('../../config');

module.exports = {
  name: 'facebook',
  aliases: ['fb', 'fbdl'],
  category: 'media',
  description: 'Download a Facebook video',
  usage: '.facebook <Facebook URL>',
  ownerOnly: false,

  async execute(sock, msg, args, extra) {
    const url = args[0];
    if (!url || !/facebook\.com|fb\.watch|fb\.com/i.test(url)) {
      return extra.reply('❌ Please provide a valid Facebook video URL.');
    }

    try {
      await extra.reply('⏳ Downloading Facebook video...');
      const result = await facebook(url);
      const data = result?.data || result;
      const videoUrl =
        data?.hd ||
        data?.sd ||
        data?.video ||
        data?.url ||
        result?.hd ||
        result?.sd;

      if (!videoUrl) throw new Error('No downloadable video was returned.');

      await sock.sendMessage(extra.from, {
        video: { url: videoUrl },
        caption: `📘 Facebook Download\n\n🤖 ${config.botName}`
      }, { quoted: msg });
    } catch (error) {
      console.error('[Facebook]', error);
      await extra.reply('❌ Facebook download failed. The link may be private, expired, or unsupported.');
    }
  }
};
