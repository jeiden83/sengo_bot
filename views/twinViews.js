const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getEmbedColor, formatNumber } = require("./osuViewHelpers.js");
const { colorear } = require("../commands/utils/admin.js");
const { t } = require("../utils/i18n.js");

const MOD_KEYS = ['DT', 'HD', 'HR', 'NM', 'FL', 'EZ'];

/**
 * Convierte un código de país en emoji de bandera para Discord
 */
function getCountryEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) return '🌐';
    return `:flag_${countryCode.toLowerCase()}:`;
}

/**
 * Genera una barra visual de progreso/afinidad (ej: [████████░░] 80%)
 */
function buildAffinityBar(pct, totalBlocks = 10) {
    const filled = Math.min(totalBlocks, Math.max(0, Math.round((pct / 100) * totalBlocks)));
    const empty = totalBlocks - filled;
    return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}

/**
 * Genera el bloque ANSI con la comparativa de mods lado a lado
 */
function buildModComparisonAnsi(userA, twinCandidate, statsA = {}, statsB = {}) {
    const nameA = (userA.username || 'Tú').padEnd(10).slice(0, 10);
    const nameB = (twinCandidate.username || 'Gemelo').padEnd(10).slice(0, 10);

    let lines = [];
    lines.push(`MOD   ${nameA}   ${nameB}   DIF`);
    lines.push(`---------------------------------`);

    for (const m of MOD_KEYS) {
        const valA = Number(statsA[m] || 0);
        const valB = Number(statsB[m] || 0);
        const diff = valB - valA;

        const strA = `${valA}%`.padStart(5);
        const strB = `${valB}%`.padStart(5);

        let diffStr = '';
        let diffColor = 'blanco';

        if (diff > 0) {
            diffStr = `+${diff}%`.padStart(6);
            diffColor = 'verde';
        } else if (diff < 0) {
            diffStr = `${diff}%`.padStart(6);
            diffColor = 'rojo';
        } else {
            diffStr = `  =0%`.padStart(6);
            diffColor = 'cyan';
        }

        const modName = m.padEnd(4);
        const line = `${colorear(modName, 'amarillo')}  ${colorear(strA, 'blanco')}   ${colorear(strB, 'cyan')}  ${colorear(diffStr, diffColor)}`;
        lines.push(line);
    }

    return `\`\`\`ansi\n${lines.join('\n')}\n\`\`\``;
}

/**
 * Página 1: Embed principal de afinidad y comparación de mods
 */
function doTwinMainEmbed(message, userA, twinCandidate, statsA, statsB, options = {}, locale = 'es') {
    const embedColor = getEmbedColor(message);
    const flagA = getCountryEmoji(userA.country_code || userA.country?.code);
    const flagB = getCountryEmoji(twinCandidate.country_code);

    const rankA = userA.statistics?.global_rank ? `#${formatNumber(userA.statistics.global_rank, locale)}` : '-';
    const rankB = twinCandidate.global_rank ? `#${formatNumber(twinCandidate.global_rank, locale)}` : '-';
    const ppA = userA.statistics?.pp ? `${formatNumber(Math.round(userA.statistics.pp), locale)}pp` : '-';
    const ppB = twinCandidate.pp ? `${formatNumber(Math.round(twinCandidate.pp), locale)}pp` : '-';

    const affinityPct = twinCandidate.affinityPct || 0;
    const bar = buildAffinityBar(affinityPct, 12);

    const ansiTable = buildModComparisonAnsi(userA, twinCandidate, statsA, statsB);

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`👯‍♂️ ${t(locale, 'twins.title_main', { userA: userA.username, userB: twinCandidate.username, pct: affinityPct })}`)
        .setURL(`https://osu.ppy.sh/users/${twinCandidate.osu_id}`)
        .setThumbnail(`https://a.ppy.sh/${twinCandidate.osu_id}`)
        .setDescription(
            `**${t(locale, 'twins.affinity')}:** \`[${bar}]\` **${affinityPct}%**\n\n` +
            `👤 **${userA.username}** ${flagA} | Rango: **${rankA}** | **${ppA}**\n` +
            `🎯 **${twinCandidate.username}** ${flagB} | Rango: **${rankB}** | **${ppB}**\n\n` +
            `📊 **${t(locale, 'twins.mod_breakdown')}:**\n` +
            ansiTable
        )
        .setFooter({
            text: t(locale, 'twins.footer_main', {
                index: (options.currentIndex || 0) + 1,
                total: options.totalCandidates || 1,
                mode: options.gamemode || 'osu'
            })
        });

    return embed;
}

/**
 * Página 2: Embed de comparación de mapas compartidos en Tops
 */
function doTwinSharedEmbed(message, userA, twinCandidate, comparison, locale = 'es') {
    const embedColor = getEmbedColor(message);
    const flagA = getCountryEmoji(userA.country_code || userA.country?.code);
    const flagB = getCountryEmoji(twinCandidate.country_code);

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`🗺️ ${t(locale, 'twins.title_shared', { userA: userA.username, userB: twinCandidate.username })}`)
        .setThumbnail(`https://a.ppy.sh/${twinCandidate.osu_id}`)
        .setDescription(
            `📊 **${t(locale, 'twins.shared_stats_header')}:**\n` +
            `• 🤝 **${t(locale, 'twins.shared_maps')}:** **${comparison.sharedCount}** ${t(locale, 'twins.maps')}\n` +
            `• 🔒 **${userA.username}** ${flagA} ${t(locale, 'twins.unique')}: **${comparison.uniqueCountA}**\n` +
            `• 🔒 **${twinCandidate.username}** ${flagB} ${t(locale, 'twins.unique')}: **${comparison.uniqueCountB}**\n\n` +
            `📈 **${t(locale, 'twins.overlap')}:** **${comparison.percentageA}%** ${t(locale, 'twins.of_user_a', { user: userA.username })} | **${comparison.percentageB}%** ${t(locale, 'twins.of_user_b', { user: twinCandidate.username })}\n`
        );

    if (comparison.sharedCount > 0) {
        let mapsList = '';
        const topShared = comparison.shared.slice(0, 5);

        topShared.forEach((item, idx) => {
            const b = item.beatmap;
            const bs = item.beatmapset;
            const mapTitle = bs ? `${bs.artist} - ${bs.title} [${b.version}]` : `Beatmap ${item.beatmapId}`;
            const mapUrl = `https://osu.ppy.sh/b/${item.beatmapId}`;

            const modsA = Array.isArray(item.scoreA.mods) && item.scoreA.mods.length > 0 ? `+${item.scoreA.mods.map(m => m.acronym || m).join('')}` : 'NM';
            const modsB = Array.isArray(item.scoreB.mods) && item.scoreB.mods.length > 0 ? `+${item.scoreB.mods.map(m => m.acronym || m).join('')}` : 'NM';

            mapsList += `**${idx + 1}. [${mapTitle}](${mapUrl})**\n`;
            mapsList += `↳ **${userA.username}:** \`${Math.round(item.scoreA.pp)}pp\` (${item.scoreA.acc}%) \`${modsA}\`\n`;
            mapsList += `↳ **${twinCandidate.username}:** \`${Math.round(item.scoreB.pp)}pp\` (${item.scoreB.acc}%) \`${modsB}\`\n\n`;
        });

        embed.addFields({
            name: `🌟 ${t(locale, 'twins.top_shared_plays')} (Top ${Math.min(5, comparison.sharedCount)})`,
            value: mapsList.trim()
        });
    } else {
        embed.addFields({
            name: `💡 ${t(locale, 'twins.no_shared_title')}`,
            value: t(locale, 'twins.no_shared_desc', { userA: userA.username, userB: twinCandidate.username })
        });
    }

    embed.setFooter({
        text: t(locale, 'twins.footer_shared', { userB: twinCandidate.username })
    });

    return embed;
}

/**
 * Página 3: Embed con los Top Plays del Gemelo
 */
function doTwinTopPlaysEmbed(message, twinCandidate, scores = [], locale = 'es') {
    const embedColor = getEmbedColor(message);
    const flag = getCountryEmoji(twinCandidate.country_code);

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`🏆 ${t(locale, 'twins.title_top_plays', { user: twinCandidate.username })} ${flag}`)
        .setURL(`https://osu.ppy.sh/users/${twinCandidate.osu_id}`)
        .setThumbnail(`https://a.ppy.sh/${twinCandidate.osu_id}`);

    if (!scores || scores.length === 0) {
        embed.setDescription(t(locale, 'twins.err_no_scores_twin', { user: twinCandidate.username }));
        return embed;
    }

    const top5 = scores.slice(0, 5);
    let desc = '';

    top5.forEach((s, idx) => {
        const b = s.beatmap;
        const bs = s.beatmapset;
        const title = bs ? `${bs.artist} - ${bs.title} [${b.version}]` : `Beatmap ${b.id}`;
        const mapUrl = `https://osu.ppy.sh/b/${b.id}`;
        const mods = Array.isArray(s.mods) && s.mods.length > 0 ? `+${s.mods.map(m => m.acronym || m).join('')}` : 'NM';
        const acc = s.accuracy ? (s.accuracy * 100).toFixed(2) : '100.00';
        const pp = Math.round(Number(s.pp || 0));

        desc += `**${idx + 1}. [${title}](${mapUrl})**\n`;
        desc += `↳ \`${pp}pp\` • \`${acc}%\` • \`${mods}\` • Combo: \`${s.max_combo || '-'}x\`\n\n`;
    });

    embed.setDescription(desc.trim());
    embed.setFooter({
        text: t(locale, 'twins.footer_top_plays', { user: twinCandidate.username })
    });

    return embed;
}

/**
 * Genera la fila de botones interactivos para Discord
 */
function buildTwinActionRow(currentPage = 1, currentIdx = 0, totalCandidates = 1, twinUsername = 'Gemelo', locale = 'es') {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('twin_page_main')
            .setLabel(t(locale, 'twins.btn_profile'))
            .setEmoji('📊')
            .setStyle(currentPage === 1 ? ButtonStyle.Primary : ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId('twin_page_shared')
            .setLabel(t(locale, 'twins.btn_shared'))
            .setEmoji('🗺️')
            .setStyle(currentPage === 2 ? ButtonStyle.Primary : ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId('twin_page_top')
            .setLabel(t(locale, 'twins.btn_top', { user: twinUsername.slice(0, 15) }))
            .setEmoji('🏆')
            .setStyle(currentPage === 3 ? ButtonStyle.Primary : ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId('twin_prev')
            .setEmoji('◀️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentIdx <= 0),

        new ButtonBuilder()
            .setCustomId('twin_next')
            .setEmoji('▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentIdx >= totalCandidates - 1)
    );

    return row;
}

module.exports = {
    doTwinMainEmbed,
    doTwinSharedEmbed,
    doTwinTopPlaysEmbed,
    buildTwinActionRow
};
