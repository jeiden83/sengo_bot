const { EmbedBuilder } = require('discord.js');
const { t } = require('../utils/i18n.js');
const CONFIG = require('../config.js');

/**
 * Genera el embed de ayuda para s.populate
 * @param {string} locale Código de idioma
 * @param {boolean} isOwner Indica si el usuario que ejecuta el comando es el Owner del bot
 */
function buildPopulateHelpEmbed(locale = 'es', isOwner = false) {
    const fields = [
        {
            name: t(locale, 'populate.cmd_start_title'),
            value: t(locale, 'populate.cmd_start_desc')
        },
        {
            name: t(locale, 'populate.cmd_list_title'),
            value: t(locale, 'populate.cmd_list_desc')
        },
        {
            name: t(locale, 'populate.cmd_top_title'),
            value: t(locale, 'populate.cmd_top_desc')
        }
    ];

    if (isOwner) {
        fields.push(
            {
                name: t(locale, 'populate.cmd_allow_title'),
                value: t(locale, 'populate.cmd_allow_desc')
            },
            {
                name: t(locale, 'populate.cmd_stop_title'),
                value: t(locale, 'populate.cmd_stop_desc')
            },
            {
                name: t(locale, 'populate.cmd_worker_title'),
                value: t(locale, 'populate.cmd_worker_desc')
            }
        );
    }

    return new EmbedBuilder()
        .setTitle(t(locale, 'populate.help_header'))
        .setColor(CONFIG.colors?.primary || 0x3498db)
        .setDescription(t(locale, 'populate.help_body'))
        .addFields(fields)
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
                value: completed.length > 0 ? completed.map(c => `• **${c.code || c.countryCode}** (100% Completado)`).join('\n') : t(locale, 'populate.none_completed')
            },
            {
                name: t(locale, 'populate.cat_processing'),
                value: processing.length > 0 ? processing.map(c => `• **${c.code || c.countryCode}** — Progreso: **${c.progressPercent}%** (${c.scrapedCount.toLocaleString()}/${c.totalRanked.toLocaleString()}) | Puestos: **${c.occupiedSlots}/${c.totalSlots}** (${c.freeSlots} libres)`).join('\n') : t(locale, 'populate.none_processing')
            },
            {
                name: t(locale, 'populate.cat_available'),
                value: available.length > 0 ? available.map(c => `• **${c.code || c.countryCode}** — Progreso: **${c.progressPercent}%** (${c.scrapedCount.toLocaleString()}/${c.totalRanked.toLocaleString()}) | Puestos libres: **${c.freeSlots}/${c.totalSlots}**`).join('\n') : t(locale, 'populate.none_available')
            },
            {
                name: t(locale, 'populate.cat_locked'),
                value: locked.length > 0 ? locked.map(c => `• **${c.code || c.countryCode}** — Progreso: **${c.progressPercent}%** (${c.scrapedCount.toLocaleString()}/${c.totalRanked.toLocaleString()})`).join('\n') : t(locale, 'populate.none_locked')
            },
            {
                name: t(locale, 'populate.cat_no_supporter'),
                value: noSupporter.length > 0 ? noSupporter.map(c => `**${c.code || c.countryCode}**`).join(', ') : t(locale, 'populate.all_have_supporter')
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
                value: `\`\`\`powershell\nirm "https://sengo-bot.onrender.com/worker.ps1?key=${sessionKey}&country=${countryCode}" | iex\n\`\`\``
            },
            {
                name: t(locale, 'populate.dm_how_title'),
                value: t(locale, 'populate.dm_how_val')
            }
        )
        .setFooter({ text: t(locale, 'populate.dm_footer') });
}

/**
 * Genera el embed con la información compacta de los workers activos (Owner Only)
 */
function buildPopulateWorkersEmbed(workersList, locale = 'es') {
    const embed = new EmbedBuilder()
        .setTitle(t(locale, 'populate.workers_embed_title'))
        .setColor(CONFIG.colors?.primary || 0x3498db)
        .setDescription(t(locale, 'populate.workers_embed_desc', { count: workersList.length }))
        .setFooter({ text: 'Sengo • Monitor de Poblamiento' })
        .setTimestamp();

    if (!workersList || workersList.length === 0) {
        embed.addFields({
            name: t(locale, 'populate.workers_none_title'),
            value: t(locale, 'populate.workers_none_desc')
        });
        return embed;
    }

    for (const w of workersList) {
        const createdUnix = Math.floor(w.createdAt / 1000);
        const activeUnix = Math.floor(w.lastActiveAt / 1000);
        const userMention = w.discordId ? `<@${w.discordId}>` : `@${w.username}`;

        const fieldTitle = `👷 ${w.username} [${w.countryCode}]`;
        const infoLines = [
            `👤 ${userMention}`,
            `🔑 \`${w.key}\``,
            `💾 **${w.scoresSubmitted.toLocaleString()}** récords (\`${w.batchesRequested}\` lotes)`,
            `⏱️ <t:${createdUnix}:R> (Activo <t:${activeUnix}:R>)`
        ];

        embed.addFields({
            name: fieldTitle,
            value: infoLines.join('\n'),
            inline: true
        });
    }

    return embed;
}

/**
 * Genera el embed de tabla de clasificación de top colaboradores (s.populate -top)
 */
function buildPopulateTopEmbed(topList, locale = 'es') {
    const embed = new EmbedBuilder()
        .setTitle(t(locale, 'populate.top_embed_title'))
        .setColor(CONFIG.colors?.gold || 0xf1c40f)
        .setDescription(t(locale, 'populate.top_embed_desc'))
        .setFooter({ text: 'Sengo • Historial de Colaboradores' })
        .setTimestamp();

    if (!topList || topList.length === 0) {
        embed.addFields({
            name: t(locale, 'populate.top_none_title'),
            value: t(locale, 'populate.top_none_desc')
        });
        return embed;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = topList.map((item, index) => {
        const rankIcon = medals[index] || `\`#${index + 1}\``;
        const userMention = item.discord_id && !isNaN(item.discord_id) ? `<@${item.discord_id}>` : `**${item.username}**`;
        const scores = Number(item.scores_submitted || 0).toLocaleString();
        const batches = Number(item.batches_requested || 0).toLocaleString();
        return `${rankIcon} ${userMention} — **${scores}** récords guardados (\`${batches}\` lotes)`;
    });

    embed.addFields({
        name: t(locale, 'populate.top_leaderboard_title'),
        value: lines.join('\n')
    });

    return embed;
}

module.exports = {
    buildPopulateHelpEmbed,
    buildPopulateStatusEmbed,
    buildPopulateDmEmbed,
    buildPopulateWorkersEmbed,
    buildPopulateTopEmbed
};
