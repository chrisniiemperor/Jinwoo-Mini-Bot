const axios = require('axios');
const config = require('../../config');

module.exports = {
  name: 'ip',
  aliases: ['ipinfo', 'iplookup'],
  category: 'utility',
  description: 'Look up public IP information',
  usage: '.ip <IP address>',
  ownerOnly: false,

  async execute(sock, msg, args, extra) {
    const ip = String(args[0] || '').trim();
    if (!ip || !/^[0-9a-f:.]+$/i.test(ip)) {
      return extra.reply('❌ Example: .ip 8.8.8.8');
    }

    try {
      await extra.reply('🔎 Looking up IP...');
      const r = await axios.get(`https://ipwho.is/${encodeURIComponent(ip)}`, { timeout: 10000 });
      const d = r.data;
      if (!d?.success) throw new Error(d?.message || 'Lookup failed');

      const text = [
        `🌐 *IP INFORMATION*`,
        ``,
        `📍 IP: ${d.ip || ip}`,
        `🌎 Country: ${d.country || 'N/A'}`,
        `🏙️ City: ${d.city || 'N/A'}`,
        `📡 ISP: ${d.connection?.isp || 'N/A'}`,
        `🏢 Organization: ${d.connection?.org || 'N/A'}`,
        `🕐 Timezone: ${d.timezone?.id || 'N/A'}`,
        ``,
        `🤖 ${config.botName}`
      ].join('\n');

      await extra.reply(text);
    } catch (error) {
      console.error('[IP]', error.message || error);
      await extra.reply('❌ Could not retrieve information for that IP address.');
    }
  }
};
