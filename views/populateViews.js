const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { t } = require('../utils/i18n.js');
const CONFIG = require('../config.js');

/**
 * Genera el embed de ayuda para s.populate según el índice de página
 * @param {string} locale Código de idioma
 * @param {number} pageIndex 0 para Comandos Generales, 1 para Comandos de Owner
 */
function buildPopulateHelpEmbed(locale = 'es', pageIndex = 0) {
    const embed = new EmbedBuilder()
        .setColor(CONFIG.colors?.primary || 0x3498db)
        .setFooter({ text: 'SengoBot • Poblamiento Distribuido' });

    if (pageIndex === 1) {
        embed
            .setTitle(t(locale, 'populate.help_owner_header'))
            .setDescription(t(locale, 'populate.help_owner_body'))
            .addFields(
                {
                    name: t(locale, 'populate.cmd_allow_title'),
                    value: t(locale, 'populate.cmd_allow_desc')
                },
                {
                    name: t(locale, 'populate.cmd_stop_title'),
                    value: t(locale, 'populate.cmd_stop_desc')
                },
                {
                    name: t(locale, 'populate.cmd_keys_title'),
                    value: t(locale, 'populate.cmd_keys_desc')
                },
                {
                    name: t(locale, 'populate.cmd_delkey_title'),
                    value: t(locale, 'populate.cmd_delkey_desc')
                },
                {
                    name: t(locale, 'populate.cmd_clean_title'),
                    value: t(locale, 'populate.cmd_clean_desc')
                }
            );
    } else {
        embed
            .setTitle(t(locale, 'populate.help_header'))
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
                    name: t(locale, 'populate.cmd_top_title'),
                    value: t(locale, 'populate.cmd_top_desc')
                }
            );
    }

    return embed;
}

/**
 * Crea la fila de botones de navegación para la ayuda de s.populate (Solo para Owner)
 * @param {number} currentPageIndex Índice de la página activa (0 o 1)
 * @param {string} locale Idioma del contexto
 * @returns {ActionRowBuilder} Fila de botones
 */
function buildPopulateHelpNavigationRow(currentPageIndex = 0, locale = 'es') {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("pop_help_page_0")
            .setLabel(t(locale, 'populate.buttons.public'))
            .setEmoji("🌐")
            .setStyle(currentPageIndex === 0 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("pop_help_page_1")
            .setLabel(t(locale, 'populate.buttons.owner'))
            .setEmoji("👑")
            .setStyle(currentPageIndex === 1 ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
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

    const lockedWithProgress = locked.filter(c => Number(c.scrapedCount || 0) > 0);
    const lockedZeroProgress = locked.filter(c => Number(c.scrapedCount || 0) === 0);

    let lockedValue = t(locale, 'populate.none_locked');
    if (locked.length > 0) {
        const parts = [];
        if (lockedWithProgress.length > 0) {
            parts.push(lockedWithProgress.map(c => `• **${c.code || c.countryCode}** — Progreso: **${c.progressPercent}%** (${c.scrapedCount.toLocaleString()}/${c.totalRanked.toLocaleString()})`).join('\n'));
        }
        if (lockedZeroProgress.length > 0) {
            const zeroList = lockedZeroProgress.map(c => `**${c.code || c.countryCode}**`).join(', ');
            if (lockedWithProgress.length > 0) {
                parts.push(`• Sin avance: ${zeroList}`);
            } else {
                parts.push(zeroList);
            }
        }
        lockedValue = parts.join('\n');
    }

    const safeVal = (str) => {
        if (!str) return 'N/A';
        return str.length > 1024 ? str.substring(0, 1020) + '...' : str;
    };

    return new EmbedBuilder()
        .setTitle(t(locale, 'populate.status_title'))
        .setColor(CONFIG.colors?.primary || 0x3498db)
        .setDescription(t(locale, 'populate.status_desc'))
        .addFields(
            {
                name: t(locale, 'populate.cat_completed'),
                value: safeVal(completed.length > 0 ? completed.map(c => `**${c.code || c.countryCode}**`).join(', ') : t(locale, 'populate.none_completed'))
            },
            {
                name: t(locale, 'populate.cat_processing'),
                value: safeVal(processing.length > 0 ? processing.map(c => `• **${c.code || c.countryCode}** — Progreso: **${c.progressPercent}%** (${c.scrapedCount.toLocaleString()}/${c.totalRanked.toLocaleString()}) | Puestos: **${c.occupiedSlots}/${c.totalSlots}** (${c.freeSlots} libres)`).join('\n') : t(locale, 'populate.none_processing'))
            },
            {
                name: t(locale, 'populate.cat_available'),
                value: safeVal(available.length > 0 ? available.map(c => `• **${c.code || c.countryCode}** — Progreso: **${c.progressPercent}%** (${c.scrapedCount.toLocaleString()}/${c.totalRanked.toLocaleString()}) | Puestos libres: **${c.freeSlots}/${c.totalSlots}**`).join('\n') : t(locale, 'populate.none_available'))
            },
            {
                name: t(locale, 'populate.cat_locked'),
                value: safeVal(lockedValue)
            },
            {
                name: t(locale, 'populate.cat_no_supporter'),
                value: safeVal(noSupporter.length > 0 ? noSupporter.map(c => `**${c.code || c.countryCode}**`).join(', ') : t(locale, 'populate.all_have_supporter'))
            }
        )
        .setFooter({ text: 'SengoBot • Poblamiento Distribuido' })
        .setTimestamp();
}

/**
 * Genera el embed enviado al DM del colaborador según el modo (PowerShell, Worker Web Móvil o Bash)
 */
function buildPopulateDmEmbed(sessionKey, countryCode, username, locale = 'es', modeOption = 'ps') {
    const isMobile = modeOption === true || modeOption === 'web' || modeOption === 'movil' || modeOption === 'mobile';
    const isBash = modeOption === 'bash' || modeOption === 'sh' || modeOption === 'linux';
    const baseUrl = process.env.RENDER_EXTERNAL_URL || 'https://sengo-bot-tc9l.onrender.com';

    if (isMobile) {
        const webUrl = `${baseUrl}/worker?key=${sessionKey}&country=${countryCode}`;
        return new EmbedBuilder()
            .setTitle(t(locale, 'populate.dm_title', { country: countryCode }))
            .setColor(0x38bdf8)
            .setDescription(t(locale, 'populate.dm_desc_mobile', { username, country: countryCode }))
            .addFields(
                {
                    name: t(locale, 'populate.dm_step1_mobile_title'),
                    value: t(locale, 'populate.dm_step1_mobile_val')
                },
                {
                    name: '📱 2️⃣ Toca este enlace para abrir el Worker Web:',
                    value: `👉 [**Iniciar Sengo Worker Web para ${countryCode}**](${webUrl})\n\`${webUrl}\``
                },
                {
                    name: t(locale, 'populate.dm_how_title'),
                    value: t(locale, 'populate.dm_how_val')
                }
            )
            .setFooter({ text: t(locale, 'populate.dm_footer') });
    }

    if (isBash) {
        const bashCmd = `curl -sSL "${baseUrl}/worker.sh?key=${sessionKey}&country=${countryCode}" | bash`;
        return new EmbedBuilder()
            .setTitle(t(locale, 'populate.dm_title', { country: countryCode }))
            .setColor(0xe67e22)
            .setDescription(t(locale, 'populate.dm_desc_bash', { username, country: countryCode }))
            .addFields(
                {
                    name: t(locale, 'populate.dm_step1_bash_title'),
                    value: t(locale, 'populate.dm_step1_bash_val')
                },
                {
                    name: t(locale, 'populate.dm_step2_title'),
                    value: `\`\`\`bash\n${bashCmd}\n\`\`\``
                },
                {
                    name: t(locale, 'populate.dm_how_title'),
                    value: t(locale, 'populate.dm_how_val')
                }
            )
            .setFooter({ text: t(locale, 'populate.dm_footer') });
    }

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
                value: `\`\`\`powershell\nirm "${baseUrl}/worker.ps1?key=${sessionKey}&country=${countryCode}" | iex\n\`\`\``
            },
            {
                name: t(locale, 'populate.dm_how_title'),
                value: t(locale, 'populate.dm_how_val')
            }
        )
        .setFooter({ text: t(locale, 'populate.dm_footer') });
}


/**
 * Genera el embed de tabla de clasificación de top colaboradores (s.populate -top)
 */
function buildPopulateTopEmbed(topList, locale = 'es', page = 0, pageSize = 10) {
    const totalItems = topList ? topList.length : 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const currentPage = Math.min(Math.max(0, page), totalPages - 1);

    const embed = new EmbedBuilder()
        .setTitle(t(locale, 'populate.top_embed_title'))
        .setColor(CONFIG.colors?.gold || 0xf1c40f)
        .setDescription(t(locale, 'populate.top_embed_desc'))
        .setFooter({ text: `Sengo • Historial de Colaboradores • Página ${currentPage + 1}/${totalPages}` })
        .setTimestamp();

    if (!topList || topList.length === 0) {
        embed.addFields({
            name: t(locale, 'populate.top_none_title'),
            value: t(locale, 'populate.top_none_desc')
        });
        return embed;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const pageItems = topList.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
    const lines = pageItems.map((item, idx) => {
        const globalIndex = currentPage * pageSize + idx;
        const rankIcon = medals[globalIndex] || `\`#${globalIndex + 1}\``;
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

/**
 * Genera la fila de botones de navegación para la tabla de clasificación de colaboradores (s.populate -top)
 */
function buildPopulateTopNavigationRow(page = 0, totalPages = 1) {
    const disablePrev = page <= 0;
    const disableNext = page >= totalPages - 1;

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("pop_top_first")
            .setLabel("<<")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disablePrev),
        new ButtonBuilder()
            .setCustomId("pop_top_prev")
            .setLabel("<")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disablePrev),
        new ButtonBuilder()
            .setCustomId("pop_top_next")
            .setLabel(">")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disableNext),
        new ButtonBuilder()
            .setCustomId("pop_top_last")
            .setLabel(">>")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disableNext)
    );
}

/**
 * Genera el embed con la lista de Worker Keys registradas (Owner Only)
 */
function buildPopulateKeysEmbed(workersList, locale = 'es') {
    const embed = new EmbedBuilder()
        .setTitle(t(locale, 'populate.keys_embed_title'))
        .setColor(CONFIG.colors?.primary || 0x3498db)
        .setDescription(t(locale, 'populate.keys_embed_desc', { count: workersList ? workersList.length : 0 }))
        .setFooter({ text: 'Sengo • Gestión de Keys de Poblamiento' })
        .setTimestamp();

    if (!workersList || workersList.length === 0) {
        embed.addFields({
            name: t(locale, 'populate.keys_none_title'),
            value: t(locale, 'populate.keys_none_desc')
        });
        return embed;
    }

    const now = Date.now();
    for (const w of workersList) {
        const lastActiveMs = w.lastActiveAt || w.createdAt;
        const inactiveMin = Math.floor((now - lastActiveMs) / (1000 * 60));
        const statusEmoji = inactiveMin > 30 ? '🔴' : (inactiveMin > 10 ? '🟡' : '🟢');
        const activeUnix = Math.floor(lastActiveMs / 1000);
        const userMention = w.discordId ? `<@${w.discordId}>` : `@${w.username}`;

        const fieldTitle = `${statusEmoji} ${w.username} [${w.countryCode}]`;
        const infoLines = [
            `🔑 \`${w.key}\``,
            `👤 ${userMention}`,
            `💾 **${(w.scoresSubmitted || 0).toLocaleString()}** récords (\`${w.batchesRequested || 0}\` lotes)`,
            `⏱️ Última actividad: <t:${activeUnix}:R> (${inactiveMin} min inactivo)`
        ];

        embed.addFields({
            name: fieldTitle,
            value: infoLines.join('\n'),
            inline: true
        });
    }

    return embed;
}

module.exports = {
    buildPopulateHelpEmbed,
    buildPopulateHelpNavigationRow,
    buildPopulateStatusEmbed,
    buildPopulateDmEmbed,
    buildPopulateTopEmbed,
    buildPopulateTopNavigationRow,
    buildPopulateKeysEmbed
};
