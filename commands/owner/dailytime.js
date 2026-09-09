const {
  postTime,
  setDailyPostTime,
  rescheduleDailyPost
} = require('../../dailyTechPost');

module.exports = {
  name: 'dailytime',
  aliases: ['dailyposttime', 'posttime'],
  category: 'owner',
  description: 'Change the CHRIS-TECH daily post time',
  usage: '.dailytime 08:00 | .dailytime off',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const value = String(args[0] || '').trim().toLowerCase();

    if (!value) {
      return extra.reply(`📰 *CHRIS-TECH Daily Post*\n\n⏰ Current time: *${postTime()}*\n🌍 Timezone: *${process.env.DAILY_POST_TIMEZONE || 'Africa/Accra'}*\n\nUsage: *.dailytime 08:00*`);
    }

    if (value === 'off') {
      return extra.reply('⚠️ Automatic disabling is not available in this version. Use `.dailytime HH:MM` to change the schedule.');
    }

    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      return extra.reply('❌ Invalid time.\nExample: `.dailytime 08:00`');
    }

    if (!setDailyPostTime(value)) {
      return extra.reply('❌ Could not save the new daily post time.');
    }

    rescheduleDailyPost(value);
    await extra.reply(`✅ Daily CHRIS-TECH post time changed to *${value}*.\n🌍 Timezone: *${process.env.DAILY_POST_TIMEZONE || 'Africa/Accra'}*`);
  }
};
