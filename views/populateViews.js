const { EmbedBuilder } = require('discord.js');
const { t } = require('../utils/i18n.js');
const CONFIG = require('../config.js');

/**
 * Genera el embed de ayuda para s.populate
 */
function buildPopulateHelpEmbed(locale = 'es') {
    return new EmbedBuilder()
        .setTitle(t(locale, 'populate.help_header'))
        .setColor(CONFIG.colors?.primary || 0x3498db)
        .setDescription(t(locale, 'populate.help_body'))
        .addFields(
            {
                name: t(locale, 'populate.cmd_start_title'),
                value: t(locale, 'populate.cmd_start_desc')
            },
            {
                name: t(locale, 'populate.cmd_list_title'),
                value: t(locale, 'populate.cmd_list_desc')
            },
            {
                name: t(locale, 'populate.cmd_allow_title'),
                value: t(locale, 'populate.cmd_allow_desc')
            },
            {
                name: t(locale, 'populate.cmd_stop_title'),
                value: t(locale, 'populate.cmd_stop_desc')
            }
        )
        .setFooter({ text: 'SengoBot • Poblamiento Distribuido' });
}

/**
 * Genera el embed con la lista y estado global de países
 */
function buildPopulateStatusEmbed(list, locale = 'es') {
    const completed = list.filter(c => c.status === 'COMPLETED');
    const processing = list.filter(c => c.status === 'PROCESSING');
    const available = list.filter(c => c.status === 'AVAILABLE');
    const locked = list.filter(c => c.status === 'LOCKED');
    const noSupporter = list.filter(c => c.status === 'NO_SUPPORTER');

    return new EmbedBuilder()
        .setTitle(t(locale, 'populate.status_title'))
        .setColor(CONFIG.colors?.primary || 0x3498db)
        .setDescription(t(locale, 'populate.status_desc'))
        .addFields(
            {
                name: t(locale, 'populate.cat_completed'),
                value: completed.length > 0 ? completed.map(c => `• **${c.code}** (Completado)`).join('\n') : t(locale, 'populate.none_completed')
            },
            {
                name: t(locale, 'populate.cat_processing'),
                value: processing.length > 0 ? processing.map(c => `• **${c.code}** (${c.workersCount} worker(s)`).join('\n') : t(locale, 'populate.none_processing')
            },
            {
                name: t(locale, 'populate.cat_available'),
                value: available.length > 0 ? available.map(c => `• **${c.code}** *(Supporter: ${c.supporterUser})*`).join('\n') : t(locale, 'populate.none_available')
            },
            {
                name: t(locale, 'populate.cat_locked'),
                value: locked.length > 0 ? locked.map(c => `**${c.code}**`).join(', ') : t(locale, 'populate.none_locked')
            },
            {
                name: t(locale, 'populate.cat_no_supporter'),
                value: noSupporter.length > 0 ? noSupporter.map(c => `**${c.code}**`).join(', ') : t(locale, 'populate.all_have_supporter')
            }
        )
        .setFooter({ text: 'SengoBot • Poblamiento Distribuido' })
        .setTimestamp();
}

/**
 * Genera el embed enviado al DM del colaborador con las instrucciones de PowerShell
 */
function buildPopulateDmEmbed(sessionKey, countryCode, username, locale = 'es') {
    return new EmbedBuilder()
        .setTitle(t(locale, 'populate.dm_title', { country: countryCode }))
        .setColor(0x2ecc71)
        .setDescription(t(locale, 'populate.dm_desc', { username, country: countryCode }))
        .addFields(
            {
                name: t(locale, 'populate.dm_step1_title'),
                value: t(locale, 'populate.dm_step1_val')
            },
            {
                name: t(locale, 'populate.dm_step2_title'),
                value: `\`\`\`powershell\niex (iwr -useb https://sengo-bot.onrender.com/worker.ps1) -Key "${sessionKey}" -Country "${countryCode}"\n\`\`\``
            },
            {
                name: t(locale, 'populate.dm_how_title'),
                value: t(locale, 'populate.dm_how_val')
            }
        )
        .setFooter({ text: t(locale, 'populate.dm_footer') });
}

module.exports = {
    buildPopulateHelpEmbed,
    buildPopulateStatusEmbed,
    buildPopulateDmEmbed
};
