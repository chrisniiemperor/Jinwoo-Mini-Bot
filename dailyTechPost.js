const cron = require('node-cron');
const Parser = require('rss-parser');
const { GoogleGenAI } = require('@google/genai');

const parser = new Parser({ timeout: 15000 });
const FEEDS = [
  'https://techcrunch.com/feed/',
  'https://www.theverge.com/rss/index.xml',
  'https://www.wired.com/feed/rss'
];

let schedulerStarted = false;
let schedulerTask = null;
let activeSock = null;
let running = false;
const SETTINGS_FILE = require('path').join(__dirname, 'data', 'daily-settings.json');

function channelJid() {
  const jid = String(process.env.TECH_POST_JID || '').trim();
  return jid.endsWith('@newsletter') ? jid : '';
}

function loadDailySettings() {
  try {
    if (!require('fs').existsSync(SETTINGS_FILE)) return {};
    return JSON.parse(require('fs').readFileSync(SETTINGS_FILE, 'utf8')) || {};
  } catch { return {}; }
}

function saveDailySettings(settings) {
  try {
    require('fs').mkdirSync(require('path').dirname(SETTINGS_FILE), { recursive: true });
    require('fs').writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    return true;
  } catch (e) {
    console.error('⚠️ Could not save daily settings:', e.message || e);
    return false;
  }
}

function postTime() {
  const saved = loadDailySettings().time;
  const value = String(saved || process.env.DAILY_POST_TIME || '08:00').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : '08:00';
}

function setDailyPostTime(value) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
  const settings = loadDailySettings();
  settings.time = value;
  return saveDailySettings(settings);
}

async function getTechNews() {
  const all = [];
  for (const url of FEEDS) {
    try {
      const feed = await parser.parseURL(url);
      for (const item of (feed.items || []).slice(0, 5)) {
        if (item.title && item.link) all.push({ title: item.title.trim(), link: item.link.trim(), source: feed.title || url });
      }
    } catch (e) {
      console.error('📰 RSS error:', e.message || e);
    }
  }
  const seen = new Set();
  return all.filter(x => !seen.has(x.link) && seen.add(x.link)).slice(0, 12);
}

async function createTechPost() {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('GEMINI_API_KEY is not configured.');

  const articles = await getTechNews();
  if (!articles.length) throw new Error('No tech news found.');

  const news = articles.map((a, i) => `${i + 1}. ${a.title}\nSource: ${a.source}\n${a.link}`).join('\n\n');
  const ai = new GoogleGenAI({ apiKey: key });

  const prompt = `You are the official AI writer for CHRIS-TECH.\n\nCreate ONE concise WhatsApp tech-news post from the most relevant story below.\n\nRules:\n- Start exactly with: 🚨 CHRIS-TECH DAILY\n- Choose ONE story only.\n- Explain what happened and why it matters in simple language.\n- Be accurate. Do not invent facts.\n- Include the original source link.\n- Use a few relevant emojis.\n- End exactly with: 🚀 CHRIS-TECH | Into the Future of Technology\n\nStories:\n${news}`;

  // Try multiple current Gemini models so a temporary 503/high-demand
  // response from one model does not break the daily post.
  const models = String(process.env.GEMINI_MODELS ||
    'gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash-lite,gemini-2.5-flash')
    .split(',')
    .map(model => model.trim())
    .filter(Boolean);

  let lastError = null;

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`🤖 Trying Gemini model: ${model} (attempt ${attempt}/2)`);

        const response = await ai.models.generateContent({
          model,
          contents: prompt
        });

        if (!response.text) throw new Error(`Gemini ${model} returned an empty response.`);

        console.log(`✅ Gemini generated the post using ${model}`);
        return response.text.trim();
      } catch (error) {
        lastError = error;
        const status = error?.status || error?.code || error?.error?.code;
        const message = error?.message || error?.error?.message || String(error);
        console.error(`⚠️ Gemini ${model} failed (${status || 'unknown'}): ${message}`);

        // Retry transient capacity/server errors, then move to the next model.
        const transient = [429, 500, 502, 503, 504].includes(Number(status));
        if (!transient) break;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 2500));
      }
    }
  }

  throw new Error(`All Gemini models failed. Last error: ${lastError?.message || lastError || 'unknown error'}`);
}

async function publishDailyPost(sock = activeSock) {
  if (running) return;
  const jid = channelJid();
  if (!sock) return console.log('📰 Daily post skipped: WhatsApp is not connected.');
  if (!jid) return console.log('📰 Daily post skipped: TECH_POST_JID is not configured.');

  running = true;
  try {
    console.log('📰 Creating CHRIS-TECH daily post...');
    const post = await createTechPost();
    await sock.sendMessage(jid, { text: post });
    console.log(`✅ CHRIS-TECH daily post published to ${jid}`);
  } catch (error) {
    console.error('❌ Daily tech post failed:', error.message || error);
  } finally {
    running = false;
  }
}

function startDailyPostScheduler(sock) {
  activeSock = sock;
  if (schedulerStarted) return;
  schedulerStarted = true;

  const [hour, minute] = postTime().split(':').map(Number);
  schedulerTask = cron.schedule(`${minute} ${hour} * * *`, () => publishDailyPost(activeSock), {
    timezone: process.env.DAILY_POST_TIMEZONE || 'Africa/Accra'
  });

  console.log(`🤖 CHRIS-TECH Daily Post scheduler started: ${postTime()} (${process.env.DAILY_POST_TIMEZONE || 'Africa/Accra'})`);
  console.log(`📢 Daily post channel: ${channelJid() || 'NOT SET'}`);
}

function rescheduleDailyPost(time) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return false;
  if (schedulerTask) schedulerTask.stop();
  const [hour, minute] = time.split(':').map(Number);
  schedulerTask = cron.schedule(`${minute} ${hour} * * *`, () => publishDailyPost(activeSock), {
    timezone: process.env.DAILY_POST_TIMEZONE || 'Africa/Accra'
  });
  console.log(`🕐 CHRIS-TECH Daily Post rescheduled: ${time} (${process.env.DAILY_POST_TIMEZONE || 'Africa/Accra'})`);
  return true;
}

module.exports = { startDailyPostScheduler, publishDailyPost, postTime, setDailyPostTime, rescheduleDailyPost };
