// views/osuDroidEmbeds.js
// Vistas y embeds para comandos de osu!droid en Sengo

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { t, formatNumber, formatDecimal } = require("../utils/i18n.js");
const { getEmbedColor, getGradeEmoji } = require("./osuViewHelpers.js");
const osuDroidModel = require("../models/osuDroidModel.js");

/**
 * Genera el emoji de la bandera nacional a partir del código ISO de dos letras (ej: 've' -> 🇻🇪)
 * @param {string} regionCode 
 * @returns {string}
 */
function getCountryFlag(regionCode) {
    if (!regionCode || typeof regionCode !== 'string' || regionCode.length !== 2) return '🌐';
    const code = regionCode.toUpperCase();
    const first = 0x1F1E6 + code.charCodeAt(0) - 65;
    const second = 0x1F1E6 + code.charCodeAt(1) - 65;
    return String.fromCodePoint(first, second);
}

/**
 * Botones de navegación para la vista de Perfil
 */
function buildDroidProfileButtons(userId, locale = 'es') {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`droid_top_${userId}_0`)
            .setLabel(t(locale, 'droid.view_top') || '🏆 Top 50')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`droid_rs_${userId}`)
            .setLabel(t(locale, 'droid.view_recent') || '⚡ Reciente')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setLabel(t(locale, 'droid.view_web') || '🌐 Perfil Web')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://osudroid.moe/profile.php?uid=${userId}`)
    );
    return row;
}

/**
 * Botones para la vista de Jugada Reciente
 */
function buildDroidRecentButtons(scoreId, userId, locale = 'es') {
    const row = new ActionRowBuilder();

    if (scoreId) {
        row.addComponents(
            new ButtonBuilder()
                .setLabel(t(locale, 'droid.download_replay') || '📥 Descargar Replay (.odr)')
                .setStyle(ButtonStyle.Link)
                .setURL(osuDroidModel.getReplayUrl(scoreId))
        );
    }

    if (userId) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`droid_prof_${userId}`)
                .setLabel(t(locale, 'droid.view_profile') || '📊 Perfil')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`droid_top_${userId}_0`)
                .setLabel(t(locale, 'droid.view_top') || '🏆 Top 50')
                .setStyle(ButtonStyle.Primary)
        );
    }

    return row;
}

/**
 * Botones de paginación para la vista de Top 50 Plays
 */
function buildDroidTopButtons(userId, page, maxPages, locale = 'es') {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`droid_top_${userId}_0`)
            .setLabel('⏮️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId(`droid_top_${userId}_${page - 1}`)
            .setLabel('◀️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId(`droid_top_${userId}_${page + 1}`)
            .setLabel('▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= maxPages - 1),
        new ButtonBuilder()
            .setCustomId(`droid_top_${userId}_${maxPages - 1}`)
            .setLabel('⏭️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= maxPages - 1),
        new ButtonBuilder()
            .setCustomId(`droid_prof_${userId}`)
            .setLabel(t(locale, 'droid.view_profile') || '📊 Perfil')
            .setStyle(ButtonStyle.Primary)
    );
    return row;
}

/**
 * Botones de paginación para la vista de Leaderboard
 */
function buildDroidLeaderboardButtons(hash, page, maxPages, locale = 'es') {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`droid_lb_${hash}_1`)
            .setLabel('⏮️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 1),
        new ButtonBuilder()
            .setCustomId(`droid_lb_${hash}_${page - 1}`)
            .setLabel('◀️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 1),
        new ButtonBuilder()
            .setCustomId(`droid_lb_${hash}_${page + 1}`)
            .setLabel('▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= maxPages),
        new ButtonBuilder()
            .setCustomId(`droid_lb_${hash}_${maxPages}`)
            .setLabel('⏭️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= maxPages)
    );
    return row;
}

/**
 * Construye el embed principal del perfil de osu!droid
 * @param {object} message 
 * @param {object} profile 
 * @param {string} locale 
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
function doDroidProfileEmbed(message, profile, locale = 'es') {
    const flag = getCountryFlag(profile.Region);
    const avatarUrl = osuDroidModel.getAvatarUrl(profile.UserId);
    const bannerUrl = osuDroidModel.getBannerUrl(profile.UserId);
    const embedColor = getEmbedColor(message) || '#00c2ff';

    const globalRank = profile.GlobalRank ? `#${formatNumber(profile.GlobalRank, locale)}` : '-';
    const countryRank = profile.CountryRank ? `#${formatNumber(profile.CountryRank, locale)}` : '-';
    const pp = formatDecimal(profile.OverallPP || 0, locale, 2);
    const accuracy = formatDecimal((profile.OverallAccuracy || 0) * 100, locale, 2);
    const playcount = formatNumber(profile.OverallPlaycount || 0, locale);
    const score = formatNumber(profile.OverallScore || 0, locale);

    const registeredTimestamp = profile.Registered ? Math.floor(new Date(profile.Registered).getTime() / 1000) : null;
    const lastLoginTimestamp = profile.LastLogin ? Math.floor(new Date(profile.LastLogin).getTime() / 1000) : null;

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: t(locale, 'droid.profile_title', { username: profile.Username }) || `osu!droid • Perfil de ${profile.Username}`,
            iconURL: avatarUrl,
            url: `https://osudroid.moe/profile.php?uid=${profile.UserId}`
        })
        .setTitle(`${flag} ${profile.Username}`)
        .setURL(`https://osudroid.moe/profile.php?uid=${profile.UserId}`)
        .setThumbnail(avatarUrl);

    // Si tiene banner verificado, agregarlo
    if (bannerUrl) {
        embed.setImage(bannerUrl);
    }

    let statsDescription = [
        `**${t(locale, 'droid.pp_total') || 'Rendimiento (PP)'}:** \`${pp} pp\``,
        `**${t(locale, 'droid.global_rank') || 'Ranking Global'}:** \`${globalRank}\` • **${t(locale, 'droid.country_rank') || 'Nacional'}:** \`${countryRank}\` ${flag}`,
        `**${t(locale, 'droid.accuracy') || 'Precisión Promedio'}:** \`${accuracy}%\``,
        `**${t(locale, 'droid.play_count') || 'Partidas Jugadas'}:** \`${playcount}\` • **${t(locale, 'droid.total_score') || 'Puntuación'}:** \`${score}\``
    ];

    if (registeredTimestamp) {
        statsDescription.push(`**Registro:** <t:${registeredTimestamp}:R>${lastLoginTimestamp ? ` • **Última conexión:** <t:${lastLoginTimestamp}:R>` : ''}`);
    }

    embed.setDescription(statsDescription.join('\n'));

    // Resumen Top 5 Plays
    if (profile.Top50Plays && profile.Top50Plays.length > 0) {
        const top5 = profile.Top50Plays.slice(0, 5);
        const topLines = top5.map((p, idx) => {
            const mods = osuDroidModel.formatDroidMods(p.Mods);
            const playPp = formatDecimal(p.MapPP || 0, locale, 1);
            const playAcc = formatDecimal((p.MapAccuracy || 0) * 100, locale, 2);
            return `\`#${idx + 1}\` **${p.Filename || 'Beatmap'}**\n└ ${p.MapRank || 'SH'} \`${mods}\` • **${playPp}pp** (${playAcc}%, ${p.MapCombo || 0}x)`;
        });

        embed.addFields({
            name: t(locale, 'droid.top_plays_title') || '🏆 Mejores Jugadas (Top 5)',
            value: topLines.join('\n\n'),
            inline: false
        });
    }

    // Resumen Última Jugada
    if (profile.Last50Scores && profile.Last50Scores.length > 0) {
        const recent = profile.Last50Scores[0];
        const recentMods = osuDroidModel.formatDroidMods(recent.Mods);
        const recentPp = formatDecimal(recent.MapPP || 0, locale, 1);
        const recentAcc = formatDecimal((recent.MapAccuracy || 0) * 100, locale, 2);
        const recentTime = recent.PlayedDate ? `<t:${Math.floor(new Date(recent.PlayedDate).getTime() / 1000)}:R>` : '';

        embed.addFields({
            name: t(locale, 'droid.recent_play_title') || '⚡ Última Jugada',
            value: `**${recent.Filename || 'Beatmap'}**\n└ ${recent.MapRank || 'A'} \`${recentMods}\` • **${recentPp}pp** (${recentAcc}%, ${recent.MapCombo || 0}x) ${recentTime}`,
            inline: false
        });
    }

    embed.setFooter({
        text: `osu!droid UID: ${profile.UserId} • Sengo Droid Engine`,
        iconURL: avatarUrl
    }).setTimestamp();

    return {
        embeds: [embed],
        components: [buildDroidProfileButtons(profile.UserId, locale)]
    };
}

/**
 * Construye el embed de la jugada reciente de osu!droid
 * @param {object} message 
 * @param {object} profile 
 * @param {object} score 
 * @param {object|null} beatmapInfo Metadatos de Bancho resueltos por MD5
 * @param {string} locale 
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
function doDroidRecentEmbed(message, profile, score, beatmapInfo = null, locale = 'es') {
    const avatarUrl = osuDroidModel.getAvatarUrl(profile.UserId);
    const embedColor = getEmbedColor(message) || '#00c2ff';
    const modsStr = osuDroidModel.formatDroidMods(score.Mods);
    const gradeEmoji = getGradeEmoji(score.MapRank || 'A', score.MapRank !== 'F');

    const title = beatmapInfo
        ? `${beatmapInfo.beatmapset.title} [${beatmapInfo.version}]`
        : (score.Filename || 'Beatmap de osu!droid');

    const mapUrl = beatmapInfo
        ? `https://osu.ppy.sh/b/${beatmapInfo.id}`
        : `https://osudroid.moe/profile.php?uid=${profile.UserId}`;

    const coverUrl = beatmapInfo?.beatmapset?.covers?.['list@2x']
        || beatmapInfo?.beatmapset?.covers?.cover
        || avatarUrl;

    const pp = formatDecimal(score.MapPP || 0, locale, 2);
    const accuracy = formatDecimal((score.MapAccuracy || 0) * 100, locale, 2);
    const mapScore = formatNumber(score.MapScore || 0, locale);
    const playedTimestamp = score.PlayedDate ? Math.floor(new Date(score.PlayedDate).getTime() / 1000) : null;

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: t(locale, 'droid.recent_title', { username: profile.Username }) || `${profile.Username} • Jugada Reciente en osu!droid`,
            iconURL: avatarUrl,
            url: `https://osudroid.moe/profile.php?uid=${profile.UserId}`
        })
        .setTitle(title)
        .setURL(mapUrl)
        .setThumbnail(coverUrl);

    const lines = [
        `${gradeEmoji} **\`${modsStr}\`** • **${pp}pp** • **${accuracy}%** • **${score.MapCombo || 0}x**`,
        `🎯 **${t(locale, 'droid.score') || 'Puntuación'}:** \`${mapScore}\``,
        `🔢 **${t(locale, 'droid.hits') || 'Hits'}:** \`300:\` **${score.MapPerfect || 0}** | \`100:\` **${score.MapGood || 0}** | \`50:\` **${score.MapBad || 0}** | \`Miss:\` **${score.MapMiss || 0}** ❌`
    ];

    // Sliders de osu!droid
    if (score.SliderHeadHit !== null && score.SliderHeadHit !== undefined) {
        lines.push(`🌀 **${t(locale, 'droid.sliders') || 'Sliders'}:** Head: **${score.SliderHeadHit}** | Tick: **${score.SliderTickHit || 0}** | Repeat: **${score.SliderRepeatHit || 0}** | End: **${score.SliderEndHit || 0}**`);
    }

    if (playedTimestamp) {
        lines.push(`📅 **${t(locale, 'droid.played_at') || 'Jugado'}:** <t:${playedTimestamp}:R> (<t:${playedTimestamp}:d>)`);
    }

    embed.setDescription(lines.join('\n'));
    embed.setFooter({
        text: `Score ID: ${score.ScoreId} • osu!droid UID: ${profile.UserId}`,
        iconURL: avatarUrl
    }).setTimestamp();

    return {
        embeds: [embed],
        components: [buildDroidRecentButtons(score.ScoreId, profile.UserId, locale)]
    };
}

/**
 * Construye el embed paginado de las mejores jugadas (Top 50 Plays)
 * @param {object} message 
 * @param {object} profile 
 * @param {number} page 0-indexed
 * @param {number} pageSize Por defecto 5
 * @param {string} locale 
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
function doDroidTopEmbed(message, profile, page = 0, pageSize = 5, locale = 'es') {
    const avatarUrl = osuDroidModel.getAvatarUrl(profile.UserId);
    const embedColor = getEmbedColor(message) || '#00c2ff';
    const topPlays = profile.Top50Plays || [];

    const totalPlays = topPlays.length;
    const maxPages = Math.max(1, Math.ceil(totalPlays / pageSize));
    const safePage = Math.max(0, Math.min(page, maxPages - 1));

    const startIndex = safePage * pageSize;
    const currentPlays = topPlays.slice(startIndex, startIndex + pageSize);

    // Calcular suma ponderada acumulada del top 50 (0.95^n)
    let totalWeightedPP = 0;
    topPlays.forEach((p, idx) => {
        const rawPp = p.MapPP || 0;
        totalWeightedPP += rawPp * Math.pow(0.95, idx);
    });

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: t(locale, 'droid.top_title', { username: profile.Username, page: safePage + 1, maxPages }) || `🏆 Mejores Jugadas de ${profile.Username} (${safePage + 1}/${maxPages})`,
            iconURL: avatarUrl,
            url: `https://osudroid.moe/profile.php?uid=${profile.UserId}`
        })
        .setThumbnail(avatarUrl);

    if (currentPlays.length === 0) {
        embed.setDescription(t(locale, 'droid.no_top', { user: profile.Username }) || '❌ No hay jugadas registradas en el Top de osu!droid.');
    } else {
        const playEntries = currentPlays.map((p, idx) => {
            const absoluteIndex = startIndex + idx + 1;
            const mods = osuDroidModel.formatDroidMods(p.Mods);
            const pp = formatDecimal(p.MapPP || 0, locale, 2);
            const weightMultiplier = Math.pow(0.95, absoluteIndex - 1);
            const weightedPp = formatDecimal((p.MapPP || 0) * weightMultiplier, locale, 1);
            const acc = formatDecimal((p.MapAccuracy || 0) * 100, locale, 2);
            const playedTime = p.PlayedDate ? `<t:${Math.floor(new Date(p.PlayedDate).getTime() / 1000)}:R>` : '';

            return `**\`#${absoluteIndex}\`** [**${p.Filename || 'Beatmap'}**](https://osudroid.moe/profile.php?uid=${profile.UserId})\n` +
                `└ ${p.MapRank || 'SH'} \`${mods}\` • **${pp}pp** (pond: \`${weightedPp}pp\`) • **${acc}%** • **${p.MapCombo || 0}x** • misses: **${p.MapMiss || 0}** ${playedTime}`;
        });

        const weightedSummary = t(locale, 'droid.top_weighted', { weighted: formatDecimal(totalWeightedPP, locale, 2) }) || `PP Ponderado Total: **${formatDecimal(totalWeightedPP, locale, 2)}pp**`;
        embed.setDescription(`**${weightedSummary}**\n\n` + playEntries.join('\n\n'));
    }

    embed.setFooter({
        text: `osu!droid UID: ${profile.UserId} • Página ${safePage + 1} de ${maxPages}`,
        iconURL: avatarUrl
    }).setTimestamp();

    return {
        embeds: [embed],
        components: [buildDroidTopButtons(profile.UserId, safePage, maxPages, locale)]
    };
}

/**
 * Construye el embed del Leaderboard de un Beatmap en osu!droid
 * @param {object} message 
 * @param {string} hash 
 * @param {object} lbData Respuesta de la API de leaderboard
 * @param {object|null} beatmapInfo Metadatos de Bancho
 * @param {number} page 1-indexed
 * @param {string} locale 
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
function doDroidLeaderboardEmbed(message, hash, lbData, beatmapInfo = null, page = 1, locale = 'es') {
    const embedColor = getEmbedColor(message) || '#00c2ff';
    const plays = lbData?.Top50Plays || [];
    const pageSize = 5;
    const maxPages = Math.max(1, Math.ceil(plays.length / pageSize));
    const safePage = Math.max(1, Math.min(page, maxPages));
    const startIndex = (safePage - 1) * pageSize;
    const currentPlays = plays.slice(startIndex, startIndex + pageSize);

    const title = beatmapInfo
        ? `${beatmapInfo.beatmapset.title} [${beatmapInfo.version}]`
        : `Beatmap MD5: \`${hash.substring(0, 10)}...\``;

    const mapUrl = beatmapInfo
        ? `https://osu.ppy.sh/b/${beatmapInfo.id}`
        : `https://new.osudroid.moe/api2/game/leaderboard/?hash=${hash}`;

    const coverUrl = beatmapInfo?.beatmapset?.covers?.['list@2x']
        || beatmapInfo?.beatmapset?.covers?.cover
        || null;

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`🌌 Leaderboard de osu!droid: ${title}`)
        .setURL(mapUrl);

    if (coverUrl) {
        embed.setThumbnail(coverUrl);
    }

    if (currentPlays.length === 0) {
        embed.setDescription(t(locale, 'droid.lb_empty') || '❌ No se encontraron jugadas en osu!droid para este mapa.');
    } else {
        const lines = currentPlays.map(p => {
            const mods = osuDroidModel.formatDroidMods(p.Mods);
            const pp = formatDecimal(p.MapPP || 0, locale, 2);
            const acc = formatDecimal((p.MapAccuracy || 0) * 100, locale, 2);
            const score = formatNumber(p.MapTotalScore || 0, locale);

            return `**\`#${p.Rank || '?'}\`** **${p.Username}**\n` +
                `└ ${p.MapRank || 'SH'} \`${mods}\` • **${pp}pp** • **${acc}%** • **${p.MapCombo || 0}x** • Score: \`${score}\``;
        });

        embed.setDescription(lines.join('\n\n'));
    }

    embed.setFooter({
        text: `osu!droid Leaderboard • Página ${safePage} de ${maxPages}`,
        iconURL: 'https://osudroid.moe/favicon.ico'
    }).setTimestamp();

    return {
        embeds: [embed],
        components: [buildDroidLeaderboardButtons(hash, safePage, maxPages, locale)]
    };
}

module.exports = {
    getCountryFlag,
    buildDroidProfileButtons,
    buildDroidRecentButtons,
    buildDroidTopButtons,
    buildDroidLeaderboardButtons,
    doDroidProfileEmbed,
    doDroidRecentEmbed,
    doDroidTopEmbed,
    doDroidLeaderboardEmbed
};
