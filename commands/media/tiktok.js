/**
 * TikTok downloader
 * Tries multiple current public resolvers and sends the actual MP4 to WhatsApp.
 */
const axios = require('axios');
const config = require('../../config');

function cleanUrl(url) {
  return String(url || '').trim().replace(/[)>.,]+$/, '');
}

function isTikTokUrl(url) {
  return /^https?:\/\/(?:www\.|m\.|vm\.|vt\.)?tiktok\.com\//i.test(url);
}

function isShortTikTokUrl(url) {
  return /^https?:\/\/(?:vm|vt)\.tiktok\.com\//i.test(url);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function expandShortUrl(url) {
  if (!isShortTikTokUrl(url)) return url;
  await sleep(3500);
  try {
    const response = await axios.get(url, {
      maxRedirects: 10,
      timeout: 20000,
      validateStatus: status => status >= 200 && status < 400,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36'
      }
    });
    const finalUrl = response.request?.res?.responseUrl || response.request?.responseURL;
    if (finalUrl && isTikTokUrl(finalUrl)) return finalUrl;
  } catch (error) {
    console.warn('[TikTok] Short-link expansion failed:', error.message);
  }
  return url;
}

async function tikwm(url, method = 'get') {
  let response;
  if (method === 'post') {
    response = await axios.post('https://www.tikwm.com/api/', new URLSearchParams({ url, hd: '1' }).toString(), {
      timeout: 45000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }
    });
  } else {
    response = await axios.get('https://www.tikwm.com/api/', {
      params: { url, hd: '1' },
      timeout: 45000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
  }
  const result = response.data;
  if (result?.code !== 0 || !result?.data) throw new Error(result?.msg || 'TikWM returned no data.');
  const data = result.data;
  const videoUrl = data.hdplay || data.play || data.wmplay;
  if (!videoUrl) throw new Error('TikWM returned no video URL.');
  return { videoUrl, title: data.title || '', author: data.author?.nickname || data.author?.unique_id || '' };
}

async function tdown(url) {
  const response = await axios.get('https://tdownv4.sl-bjs.workers.dev/', {
    params: { down: url }, timeout: 45000, headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const data = response.data;
  const videoUrl = data?.download_url || data?.video_url || data?.video?.url;
  if (!videoUrl) throw new Error(data?.error || 'TDown returned no video URL.');
  return { videoUrl, title: data?.title || '', author: data?.author?.nickname || data?.author?.username || '' };
}

async function clipx(url) {
  const response = await axios.get('https://clipx.zamdev.workers.dev/', {
    params: { url, quality: 'best', audio: 'true', metadata: 'true' },
    timeout: 45000, headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const data = response.data?.data;
  const videoUrl = data?.video?.hd_mp4 || data?.video?.standard_mp4 || data?.video?.wmplay;
  if (!response.data?.success || !videoUrl) throw new Error(response.data?.error || 'ClipX returned no video URL.');
  return { videoUrl, title: data?.title || '', author: data?.author?.nickname || data?.author?.username || '' };
}

async function downloadVideo(videoUrl) {
  const response = await axios.get(videoUrl, {
    responseType: 'arraybuffer', timeout: 90000,
    maxContentLength: 80 * 1024 * 1024, maxBodyLength: 80 * 1024 * 1024,
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'video/mp4,video/*,application/octet-stream,*/*;q=0.8' }
  });
  const buffer = Buffer.from(response.data);
  const type = String(response.headers['content-type'] || '').toLowerCase();
  const isMp4 = buffer.length > 12 && buffer.subarray(4, 8).toString() === 'ftyp';
  const looksVideo = type.includes('video') || type.includes('octet-stream') || isMp4;
  if (!looksVideo) throw new Error(`Video URL returned ${type || 'non-video data'}.`);
  return buffer;
}

module.exports = {
  name: 'tiktok', aliases: ['tt', 'ttdl'], category: 'media',
  description: 'Download a TikTok video', usage: '.tiktok <TikTok URL>', ownerOnly: false,

  async execute(sock, msg, args, extra) {
    const originalUrl = cleanUrl(args[0]);
    if (!originalUrl || !isTikTokUrl(originalUrl)) return extra.reply('❌ Please provide a valid TikTok URL.');

    try {
      await extra.reply('⏳ Downloading TikTok video...');
      const resolvedUrl = await expandShortUrl(originalUrl);
      const urls = [...new Set([resolvedUrl, originalUrl])];
      const attempts = [];
      let result = null;
      let lastError = null;

      for (const candidate of urls) {
        const providers = [
          ['TDown', tdown],
          ['TikWM GET', u => tikwm(u, 'get')],
          ['TikWM POST', u => tikwm(u, 'post')],
          ['ClipX', clipx]
        ];
        for (const [name, fn] of providers) {
          try {
            result = await fn(candidate);
            console.log(`[TikTok] Resolver success: ${name} -> ${candidate}`);
            break;
          } catch (error) {
            lastError = error;
            attempts.push(`${name}: ${error.message}`);
            console.warn(`[TikTok] ${name} failed:`, error.message);
          }
        }
        if (result) break;
      }

      if (!result?.videoUrl) throw lastError || new Error('All TikTok resolvers failed.');

      const videoBuffer = await downloadVideo(result.videoUrl);
      console.log(`[TikTok] Final MP4 size: ${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB`);

      await sock.sendMessage(extra.from, {
        video: videoBuffer,
        mimetype: 'video/mp4',
        caption: `🎵 *TikTok Download*${result.author ? `\n👤 ${result.author}` : ''}${result.title ? `\n📝 ${result.title}` : ''}\n\n🤖 ${config.botName}`
      }, { quoted: msg });
    } catch (error) {
      console.error('[TikTok] Final error:', error.message || error);
      await extra.reply(
        '❌ *TikTok download failed.*\n\n' +
        'The link could be unavailable, or the public downloader services may be temporarily unavailable.\n\n' +
        'Please try again with a freshly copied TikTok link.'
      );
    }
  }
};
