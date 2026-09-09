const axios = require('axios');
const config = require('../../config');

module.exports = {
  name: 'whois',
  aliases: ['domain', 'whoislookup'],
  category: 'utility',
  description: 'Look up domain registration information',
  usage: '.whois <domain>',
  ownerOnly: false,

  async execute(sock, msg, args, extra) {
    let domain = String(args[0] || '').trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0];

    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      return extra.reply('❌ Example: .whois google.com');
    }

    try {
      await extra.reply('🔎 Looking up domain...');
      const r = await axios.get(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
        timeout: 15000,
        headers: { 'User-Agent': 'Jinwoo-Mini-Bot/1.0' }
      });
      const d = r.data || {};
      const events = Object.fromEntries((d.events || []).map(e => [e.eventAction, e.eventDate]));
      const registrar = (d.entities || [])
        .find(e => (e.roles || []).includes('registrar'))
        ?.vcardArray?.[1]
        ?.find(x => x[0] === 'fn')?.[3] || 'Not available';

      const text = [
        `🌐 *WHOIS / RDAP*`,
        ``,
        `🔗 Domain: ${d.ldhName || domain}`,
        `📅 Registered: ${events.registration || 'Not available'}`,
        `🔄 Updated: ${events['last changed'] || 'Not available'}`,
        `⏳ Expires: ${events.expiration || 'Not available'}`,
        `🏢 Registrar: ${registrar}`,
        `📡 Status: ${(d.status || []).slice(0, 4).join(', ') || 'Not available'}`,
        ``,
        `🤖 ${config.botName}`
      ].join('\n');

      await extra.reply(text);
    } catch (error) {
      console.error('[WHOIS]', error.message || error);
      await extra.reply('❌ Could not retrieve WHOIS/RDAP information for that domain.');
    }
  }
};
