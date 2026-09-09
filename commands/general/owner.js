/**
 * Owner Command - Sends bot owner's contact card (vCard)
 */

const config = require('../../config');

module.exports = {
    name: 'owner',
    aliases: ['creator', 'dev', 'botowner'],
    category: 'general',
    description: 'Show bot owner contact information',
    usage: '.owner',
    ownerOnly: false,

    async execute(sock, msg, args, extra) {
        try {
            const chatId = extra.from;

            // Always show the official creator contact.
            // This is intentionally separate from the dynamic bot owner.
            const creatorNumbers = Array.isArray(config.creatorNumber)
                ? config.creatorNumber
                : [config.creatorNumber || '233200317234'];

            const creatorName = 'CHRIS-TECH';
            const vCards = creatorNumbers.map((num) => {
                const name = creatorName;
                return {
                    vcard: `
BEGIN:VCARD
VERSION:3.0
FN:${name}
TEL;waid=${num}:${num}
END:VCARD
                    `.trim()
                };
            });

            const displayName = creatorName;

            await sock.sendMessage(chatId, {
                contacts: {
                    displayName: displayName,
                    contacts: vCards
                }
            });

            await extra.reply('👑 Here is the contact of my *Creator*.');

        } catch (error) {
            console.error('Owner command error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
