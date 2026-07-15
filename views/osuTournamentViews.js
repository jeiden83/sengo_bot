const { EmbedBuilder } = require("discord.js");
const { getEmbedColor } = require("./osuViewHelpers.js");
const { t } = require("../utils/i18n.js");

// Emojis representativos de los modos de juego de osu!
const MODE_EMOJIS = {
    osu: "⭕",
    mania: "🎹",
    taiko: "🥁",
    fruits: "🍎"
};

// Emojis y claves representativas del estado del torneo
const STATUS_DATA = {
    open: { emoji: "🟢", textKey: "status_open" },
    in_progress: { emoji: "🟡", textKey: "status_in_progress" },
    completed: { emoji: "🔴", textKey: "status_completed" },
    unknown: { emoji: "⚪", textKey: "status_unknown" }
};

/**
 * Genera el embed de lista de torneos.
 * 
 * @param {Object} options
 * @param {Array} options.tournaments - Lista de torneos en la página actual
 * @param {number} options.total - Cantidad total de torneos filtrados
 * @param {number} options.page - Página actual (1-indexed)
 * @param {number} options.pageSize - Tamaño de página
 * @param {Object} options.message - Mensaje original para el color del embed
 * @param {string} [options.locale] - Localización de idioma
 * @returns {EmbedBuilder}
 */
function doTournamentListEmbed({ tournaments, total, page, pageSize, message, locale = 'es', filters }) {
    const embedColor = getEmbedColor(message);
    const startIndex = (page - 1) * pageSize;
    const maxPages = Math.ceil(total / pageSize) || 1;

    let filterDescription = "";
    if (filters) {
        const activeFilters = [];
        if (filters.gameMode) {
            const modeName = filters.gameMode === 'osu' ? 'STD' : filters.gameMode.toUpperCase();
            activeFilters.push(`**${t(locale, 'torneos.mode')}**: \`${modeName}\``);
        }
        if (filters.rank !== null && filters.rank !== undefined) {
            activeFilters.push(`**${t(locale, 'torneos.rank')}**: \`#${filters.rank.toLocaleString(locale === 'es' ? 'es-ES' : 'en-US')}\``);
        }
        if (filters.tag) {
            activeFilters.push(`**${t(locale, 'torneos.tag')}**: \`${filters.tag}\``);
        }
        const isDefaultStatus = Array.isArray(filters.status) && filters.status.length === 2 && filters.status.includes('open') && filters.status.includes('in_progress');
        if (!isDefaultStatus && filters.status) {
            if (filters.status === 'completed') {
                activeFilters.push(`**${t(locale, 'torneos.status')}**: \`${t(locale, 'torneos.status_closed')}\``);
            } else if (Array.isArray(filters.status)) {
                if (filters.status.length > 2) {
                    activeFilters.push(`**${t(locale, 'torneos.status')}**: \`Todos\``);
                } else {
                    const statusText = filters.status.map(s => t(locale, `torneos.status_${s === 'completed' ? 'closed' : s}`)).join(", ");
                    activeFilters.push(`**${t(locale, 'torneos.status')}**: \`${statusText}\``);
                }
            } else {
                activeFilters.push(`**${t(locale, 'torneos.status')}**: \`${t(locale, `torneos.status_${filters.status === 'completed' ? 'closed' : filters.status}`)}\``);
            }
        }
        
        if (activeFilters.length > 0) {
            filterDescription = `🔍 **${t(locale, 'torneos.filters_applied')}**: ${activeFilters.join("  •  ")}\n\n`;
        }
    }

    const lines = tournaments.map((tourney, idx) => {
        const itemNumber = startIndex + idx + 1;
        const modeEmoji = MODE_EMOJIS[tourney.game_mode] || "❓";
        const status = STATUS_DATA[tourney.reg_status] || STATUS_DATA.unknown;
        const statusText = t(locale, `torneos.${status.textKey}`);
        
        let rankStr = t(locale, 'torneos.open_range');
        if (!tourney.is_open_range) {
            const minStr = tourney.rank_min ? tourney.rank_min.toLocaleString(locale === 'es' ? 'es-ES' : 'en-US') : "1";
            const maxStr = tourney.rank_max ? tourney.rank_max.toLocaleString(locale === 'es' ? 'es-ES' : 'en-US') : "∞";
            rankStr = `#${minStr} - #${maxStr}`;
        }

        const formatStr = tourney.team_format ? ` • \`${tourney.team_format}\`` : "";
        const safeTitle = tourney.title.replace(/\[/g, '(').replace(/\]/g, ')');
        const titleLink = `[**${safeTitle}**](https://osu.ppy.sh/community/forums/topics/${tourney.id})`;

        return `${itemNumber}. ${status.emoji} ${modeEmoji} ${titleLink}\n   ↳ \`${rankStr}\`${formatStr} • *${statusText}*`;
    });

    const embed = new EmbedBuilder()
        .setTitle(t(locale, 'torneos.embed_title'))
        .setDescription(filterDescription + (lines.length > 0 ? lines.join("\n\n") : t(locale, 'torneos.no_tournaments')))
        .setColor(embedColor)
        .setFooter({
            text: t(locale, 'torneos.page_info', { page, totalPages: maxPages }) + " • " + t(locale, 'torneos.showing_info', { start: startIndex + 1, end: startIndex + tournaments.length, total }),
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();

    return embed;
}

/**
 * Genera el embed de detalle de un torneo.
 * 
 * @param {Object} tournament - Registro del torneo en la DB
 * @param {Object} message - Mensaje original para obtener el color
 * @param {string} [locale] - Localización
 * @returns {EmbedBuilder}
 */
function doTournamentDetailEmbed(tournament, message, locale = 'es') {
    let embedColor = getEmbedColor(message);
    
    // Cambiar color según el estado para darle premium feel
    if (tournament.reg_status === 'open') embedColor = 0x2ecc71; // verde
    else if (tournament.reg_status === 'in_progress') embedColor = 0xf1c40f; // dorado
    else if (tournament.reg_status === 'completed') embedColor = 0x95a5a6; // gris

    const status = STATUS_DATA[tournament.reg_status] || STATUS_DATA.unknown;
    const statusText = t(locale, `torneos.${status.textKey}`);

    let rankStr = t(locale, 'torneos.open_range');
    if (!tournament.is_open_range) {
        const minStr = tournament.rank_min ? tournament.rank_min.toLocaleString(locale === 'es' ? 'es-ES' : 'en-US') : "1";
        const maxStr = tournament.rank_max ? tournament.rank_max.toLocaleString(locale === 'es' ? 'es-ES' : 'en-US') : "∞";
        rankStr = `#${minStr} - #${maxStr}`;
    }

    const modeName = tournament.game_mode === 'osu' ? 'std' : tournament.game_mode;

    const detailsLines = [
        `**${t(locale, 'torneos.mode')}:** \`${modeName.toUpperCase()}\``,
        `**Formato:** \`${tournament.team_format || "1v1"}\``,
        `**${t(locale, 'torneos.rank')}:** \`${rankStr}\``,
        `**${t(locale, 'torneos.status')}:** ${status.emoji} **${statusText}**`
    ];

    if (tournament.created_at) {
        const createdUnix = Math.floor(new Date(tournament.created_at).getTime() / 1000);
        detailsLines.push(`**${t(locale, 'torneos.created')}:** <t:${createdUnix}:F> (<t:${createdUnix}:R>)`);
    }
    if (tournament.updated_at) {
        const updatedUnix = Math.floor(new Date(tournament.updated_at).getTime() / 1000);
        detailsLines.push(`**${t(locale, 'torneos.last_update')}:** <t:${updatedUnix}:F> (<t:${updatedUnix}:R>)`);
    }

    // Enlaces
    const links = [];
    if (tournament.discord_url) links.push(`[Discord](${tournament.discord_url})`);
    if (tournament.mainsheet_url) links.push(`[Planilla](${tournament.mainsheet_url})`);
    if (tournament.registration_url) links.push(`[Registro](${tournament.registration_url})`);
    if (tournament.rules_url) links.push(`[Reglas](${tournament.rules_url})`);
    if (tournament.challonge_url) links.push(`[Bracket](${tournament.challonge_url})`);
    if (tournament.twitch_url) links.push(`[Twitch](${tournament.twitch_url})`);

    const fields = [
        {
            name: t(locale, 'torneos.general_info'),
            value: detailsLines.join("\n"),
            inline: true
        },
        {
            name: t(locale, 'torneos.quick_links'),
            value: links.join(" • ") || t(locale, 'torneos.no_links'),
            inline: false
        }
    ];

    if (tournament.prizes) {
        fields.push({
            name: "🎁 " + t(locale, 'torneos.prizes'),
            value: tournament.prizes.length > 1024 ? tournament.prizes.slice(0, 1020) + "..." : tournament.prizes,
            inline: false
        });
    }

    if (tournament.schedule) {
        fields.push({
            name: "📅 " + t(locale, 'torneos.dates'),
            value: tournament.schedule.length > 1024 ? tournament.schedule.slice(0, 1020) + "..." : tournament.schedule,
            inline: false
        });
    }

    if (tournament.rules_summary) {
        fields.push({
            name: "📖 " + t(locale, 'torneos.rules'),
            value: tournament.rules_summary.length > 1024 ? tournament.rules_summary.slice(0, 1020) + "..." : tournament.rules_summary,
            inline: false
        });
    }

    if (tournament.tags && tournament.tags.length > 0) {
        const formattedTags = tournament.tags.map(tag => `\`${tag}\``).join(" ");
        fields.push({
            name: "🏷️ " + t(locale, 'torneos.tags'),
            value: formattedTags,
            inline: false
        });
    }

    const embed = new EmbedBuilder()
        .setTitle(`🏆 ${tournament.title}`)
        .setURL(`https://osu.ppy.sh/community/forums/topics/${tournament.id}`)
        .addFields(fields)
        .setColor(embedColor)
        .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();

    return embed;
}

module.exports = {
    doTournamentListEmbed,
    doTournamentDetailEmbed
};
