const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const config = require('../../config');

const DICTIONARY_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const WIKTIONARY_API = 'https://en.wiktionary.org/api/rest_v1/page/summary/';

function cleanText(text = '') {
  return String(text).replace(/\s+/g, ' ').trim();
}

function normalizeWord(input = '') {
  return String(input).trim().toLowerCase().replace(/^[^a-z]+|[^a-z'-]+$/gi, '');
}

async function getDictionary(word) {
  const response = await axios.get(`${DICTIONARY_API}${encodeURIComponent(word)}`, {
    timeout: 12000,
    headers: { 'User-Agent': 'Jinwoo-Mini-Bot/1.0' }
  });

  const entry = response.data?.[0];
  if (!entry) throw new Error('Dictionary API returned no entry.');

  const meanings = (entry.meanings || [])
    .flatMap(meaning => (meaning.definitions || []).slice(0, 2).map(def => ({
      partOfSpeech: meaning.partOfSpeech || 'Meaning',
      definition: cleanText(def.definition),
      example: cleanText(def.example)
    })))
    .filter(item => item.definition)
    .slice(0, 5);

  if (!meanings.length) throw new Error('No definitions returned.');

  return {
    word: entry.word || word,
    phonetic: entry.phonetic || entry.phonetics?.find(p => p.text)?.text || '',
    meanings
  };
}

async function getWiktionary(word) {
  const response = await axios.get(`${WIKTIONARY_API}${encodeURIComponent(word)}`, {
    timeout: 12000,
    headers: { 'User-Agent': 'Jinwoo-Mini-Bot/1.0' }
  });

  const data = response.data || {};
  const extract = cleanText(data.extract);
  if (!extract) throw new Error('Wiktionary returned no summary.');

  return {
    word,
    phonetic: '',
    meanings: [{ partOfSpeech: 'Definition', definition: extract, example: '' }]
  };
}

async function getGeminiDefinition(word) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('GEMINI_API_KEY is not configured.');

  const ai = new GoogleGenAI({ apiKey: key });
  const models = String(process.env.GEMINI_MODELS || 'gemini-2.5-flash,gemini-2.0-flash')
    .split(',').map(x => x.trim()).filter(Boolean);

  const prompt = `Define the English word "${word}". Return ONLY valid JSON in this exact shape:
{"word":"${word}","phonetic":"","meanings":[{"partOfSpeech":"noun","definition":"short clear definition","example":"short example or empty string"}]}
Give up to 3 common meanings. Do not invent an obscure meaning. No markdown.`;

  let lastError;
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({ model, contents: prompt });
      const text = String(response.text || '').trim().replace(/^```json\s*|\s*```$/g, '');
      const parsed = JSON.parse(text);
      const meanings = Array.isArray(parsed.meanings) ? parsed.meanings
        .map(x => ({
          partOfSpeech: cleanText(x.partOfSpeech || 'Meaning'),
          definition: cleanText(x.definition),
          example: cleanText(x.example)
        }))
        .filter(x => x.definition)
        .slice(0, 3) : [];
      if (!meanings.length) throw new Error('Gemini returned no usable definition.');
      return { word: parsed.word || word, phonetic: parsed.phonetic || '', meanings };
    } catch (error) {
      lastError = error;
      console.warn(`[Define] Gemini ${model} failed:`, error.message || error);
    }
  }
  throw lastError || new Error('Gemini definition failed.');
}

module.exports = {
  name: 'define',
  aliases: ['definition', 'meaning', 'dict'],
  category: 'utility',
  description: 'Get the definition of a word',
  usage: '.define <word>',
  ownerOnly: false,

  async execute(sock, msg, args, extra) {
    const rawWord = String(args[0] || '').trim();
    const word = normalizeWord(rawWord);
    if (!word || !/^[a-z][a-z'-]*$/i.test(word)) {
      return extra.reply('❌ Example: .define technology');
    }

    try {
      let result;
      try {
        result = await getDictionary(word);
        console.log(`[Define] Source: Dictionary API (${word})`);
      } catch (primaryError) {
        console.warn(`[Define] Dictionary API failed for ${word}:`, primaryError.message);
        try {
          result = await getWiktionary(word);
          console.log(`[Define] Source: Wiktionary (${word})`);
        } catch (wikiError) {
          console.warn(`[Define] Wiktionary failed for ${word}:`, wikiError.message);
          result = await getGeminiDefinition(word);
          console.log(`[Define] Source: Gemini (${word})`);
        }
      }

      const lines = [`📖 *${result.word}*${result.phonetic ? `  ${result.phonetic}` : ''}`];
      for (const meaning of result.meanings) {
        lines.push(`\n*${meaning.partOfSpeech}:* ${meaning.definition}`);
        if (meaning.example) lines.push(`_Example: ${meaning.example}_`);
      }
      await extra.reply(lines.join('\n') + `\n\n🤖 ${config.botName}`);
    } catch (error) {
      console.error('[Define] All sources failed:', error.message || error);
      await extra.reply(`❌ I couldn't find a definition for *${word}* right now. Please try again.`);
    }
  }
};
