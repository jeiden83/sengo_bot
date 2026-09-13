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
 * Genera el bloque ANSI con la comparativa de habilidades (Skills) lado a lado
 */
function buildSkillComparisonAnsi(userA, twinCandidate, skillsA = {}, skillsB = {}) {
    const nameA = (userA.username || 'Tú').padEnd(10).slice(0, 10);
    const nameB = (twinCandidate.username || 'Gemelo').padEnd(10).slice(0, 10);

    let lines = [];
    lines.push(`SKILL      ${nameA}   ${nameB}   DIF`);
    lines.push(`---------------------------------`);

    const skills = [
        { key: 'aim', label: 'AIM' },
        { key: 'speed', label: 'SPEED' },
        { key: 'acc', label: 'ACC' },
        { key: 'reading', label: 'READING' },
        { key: 'stamina', label: 'STAMINA' }
    ];

    for (const s of skills) {
        const valA = Number(skillsA[s.key] || 0);
        const valB = Number(skillsB[s.key] || 0);
        if (valA === 0 && valB === 0) continue;

        const diff = Number((valB - valA).toFixed(1));
        const strA = valA.toFixed(1).padStart(5);
        const strB = valB.toFixed(1).padStart(5);

        let diffStr = '';
        let diffColor = 'blanco';

        if (diff > 0) {
            diffStr = `+${diff}`.padStart(6);
            diffColor = 'verde';
        } else if (diff < 0) {
            diffStr = `${diff}`.padStart(6);
            diffColor = 'rojo';
        } else {
            diffStr = `  =0`.padStart(6);
            diffColor = 'cyan';
        }

        const skillName = s.label.padEnd(8);
        const line = `${colorear(skillName, 'amarillo')}  ${colorear(strA, 'blanco')}   ${colorear(strB, 'cyan')}  ${colorear(diffStr, diffColor)}`;
        lines.push(line);
    }

    return `\`\`\`ansi\n${lines.join('\n')}\n\`\`\``;
}

/**
 * Página 1: Embed principal de afinidad y comparación de mods / skills
 */
function doTwinMainEmbed(message, userA, twinCandidate, statsA, statsB, options = {}, locale = 'es') {
    const embedColor = getEmbedColor(message);
    const flagA = getCountryEmoji(userA.country_code || userA.country?.code);
    const flagB = getCountryEmoji(twinCandidate.country_code);

    const rankA = userA.statistics?.global_rank ? `#${formatNumber(userA.statistics.global_rank, locale)}` : '-';
    const rankB = twinCandidate.global_rank ? `#${formatNumber(twinCandidate.global_rank, locale)}` : '-';
    const ppA = userA.statistics?.pp ? `${formatNumber(Math.round(userA.statistics.pp), locale)}pp` : '-';
    const ppB = twinCandidate.pp ? `${formatNumber(Math.round(twinCandidate.pp), locale)}pp` : '-';

    const diffPPStr = twinCandidate.ppDiffSigned != null
        ? ` (${twinCandidate.ppDiffSigned >= 0 ? '+' : ''}${Math.round(twinCandidate.ppDiffSigned)}pp)`
        : '';

    const affinityPct = twinCandidate.affinityPct || 0;
    const bar = buildAffinityBar(affinityPct, 12);

    let comparisonSection = '';
    if (options.skillFilter) {
        const skillsA = options.userSkills || {};
        const ansiTable = buildSkillComparisonAnsi(userA, twinCandidate, skillsA, twinCandidate);
        comparisonSection = `⚡ **${t(locale, 'twins.skills_breakdown')}:**\n${ansiTable}`;
    } else {
        const ansiTable = buildModComparisonAnsi(userA, twinCandidate, statsA, statsB);
        comparisonSection = `📊 **${t(locale, 'twins.mod_breakdown')}:**\n${ansiTable}`;
    }

    let filterTag = '';
    if (options.requestedMods && options.requestedMods.length > 0) {
        filterTag = ` [Mods: ${options.requestedMods.join('')}]`;
    } else if (options.skillFilter) {
        filterTag = ` [Skill: ${options.skillFilter.toUpperCase()}]`;
    } else if (options.sortByPP) {
        filterTag = ` [PP]`;
    }

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`👯‍♂️ ${t(locale, 'twins.title_main', { userA: userA.username, userB: twinCandidate.username, pct: affinityPct })}${filterTag}`)
        .setURL(`https://osu.ppy.sh/users/${twinCandidate.osu_id}`)
        .setThumbnail(`https://a.ppy.sh/${twinCandidate.osu_id}`)
        .setDescription(
            `**${t(locale, 'twins.affinity')}:** \`[${bar}]\` **${affinityPct}%**\n\n` +
            `👤 **${userA.username}** ${flagA} | Rango: **${rankA}** | **${ppA}**\n` +
            `🎯 **${twinCandidate.username}** ${flagB} | Rango: **${rankB}** | **${ppB}**${options.sortByPP ? ` \`${diffPPStr}\`` : ''}\n\n` +
            comparisonSection
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
 * Embed en vista de lista compacta (-l) mostrando 5 gemelos por página
 */
function doTwinListEmbed(message, userA, candidates = [], page = 1, totalPages = 1, options = {}, locale = 'es') {
    const embedColor = getEmbedColor(message);
    const flagA = getCountryEmoji(userA.country_code || userA.country?.code);
    const mode = options.gamemode || userA.playmode || 'osu';

    const startIndex = (page - 1) * 5;
    const pageCandidates = candidates.slice(startIndex, startIndex + 5);

    let filterBadges = [];
    if (options.requestedMods && options.requestedMods.length > 0) {
        filterBadges.push(`🎯 Mods: \`${options.requestedMods.join('')}\``);
    }
    if (options.sortByPP) {
        filterBadges.push(`⚖️ ${t(locale, 'twins.badge_pp')}`);
    }
    if (options.skillFilter) {
        filterBadges.push(`⚡ ${t(locale, 'twins.badge_skill', { skill: options.skillFilter.toUpperCase() })}`);
    }
    if (options.country) {
        filterBadges.push(`🌍 ${options.country.toUpperCase()}`);
    } else if (options.prioritizeCountry) {
        filterBadges.push(`📍 ${t(locale, 'twins.badge_prio_country', { country: options.runnerCountry || '' })}`);
    }

    const badgeStr = filterBadges.length > 0 ? `*${filterBadges.join(' • ')}*\n\n` : '';

    let listText = '';
    pageCandidates.forEach((c, idx) => {
        const absIdx = startIndex + idx + 1;
        const flag = getCountryEmoji(c.country_code);
        const rank = c.global_rank ? `#${formatNumber(c.global_rank, locale)}` : '-';
        const pp = `${formatNumber(Math.round(c.pp), locale)}pp`;
        const diffStr = c.ppDiffSigned != null ? ` (${c.ppDiffSigned >= 0 ? '+' : ''}${Math.round(c.ppDiffSigned)}pp)` : '';

        let detailLine = '';
        if (options.skillFilter) {
            const sf = options.skillFilter.toUpperCase();
            if (sf === 'ACC' || sf === 'ACCURACY') {
                detailLine = `Acc: **${c.acc || 0}** (Tú: ${options.userSkills?.acc || 0})`;
            } else if (sf === 'AIM') {
                detailLine = `Aim: **${c.aim || 0}** (Tú: ${options.userSkills?.aim || 0})`;
            } else if (sf === 'SPEED') {
                detailLine = `Speed: **${c.speed || 0}** (Tú: ${options.userSkills?.speed || 0})`;
            } else if (sf === 'READING') {
                detailLine = `Reading: **${c.reading || 0}** (Tú: ${options.userSkills?.reading || 0})`;
            } else {
                detailLine = `Aim: **${c.aim || 0}** • Speed: **${c.speed || 0}** • Acc: **${c.acc || 0}**`;
            }
        } else if (options.requestedMods && options.requestedMods.length > 0) {
            const mParts = options.requestedMods.map(m => `${m}: **${c.modStats[m] || 0}%** (Tú: ${options.userModStats?.[m] || 0}%)`);
            detailLine = mParts.join(' • ');
        } else {
            const sortedMods = Object.entries(c.modStats || {})
                .filter(([, v]) => v > 0)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([m, v]) => `${m} ${v}%`);
            detailLine = sortedMods.length > 0 ? sortedMods.join(' • ') : 'NM 100%';
        }

        listText += `**${absIdx}. [${c.username}](https://osu.ppy.sh/users/${c.osu_id})** ${flag} • \`${c.affinityPct}%\`\n`;
        listText += `↳ \`${rank}\` • \`${pp}\`${options.sortByPP ? ` \`${diffStr}\`` : ''} • ${detailLine}\n\n`;
    });

    if (!listText) {
        listText = t(locale, 'twins.err_no_twins');
    }

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`👯‍♂️ ${t(locale, 'twins.list_title', { username: userA.username })} ${flagA}`)
        .setURL(`https://osu.ppy.sh/users/${userA.id || userA.osu_id}`)
        .setThumbnail(`https://a.ppy.sh/${userA.id || userA.osu_id}`)
        .setDescription(`${badgeStr}${listText.trim()}`)
        .setFooter({
            text: t(locale, 'twins.list_footer', {
                page,
                totalPages,
                from: startIndex + 1,
                to: Math.min(candidates.length, startIndex + pageCandidates.length),
                total: candidates.length,
                mode
            })
        });

    return embed;
}

/**
 * Fila de botones para la vista de lista compacta (-l)
 */
function buildTwinListActionRow(currentPage = 1, totalPages = 1, locale = 'es') {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('twin_list_prev')
            .setEmoji('◀️')
            .setLabel(t(locale, 'twins.btn_prev_page'))
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage <= 1),

        new ButtonBuilder()
            .setCustomId('twin_list_inspect')
            .setEmoji('🔍')
            .setLabel(t(locale, 'twins.btn_details'))
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId('twin_list_next')
            .setEmoji('▶️')
            .setLabel(t(locale, 'twins.btn_next_page'))
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage >= totalPages)
    );
    return [row];
}

/**
 * Genera las filas de botones interactivos para la vista detallada de Discord
 */
function buildTwinActionRow(currentPage = 1, currentIdx = 0, totalCandidates = 1, twinUsername = 'Gemelo', locale = 'es', hasListView = true) {
    const row1Components = [
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
            .setStyle(currentPage === 3 ? ButtonStyle.Primary : ButtonStyle.Secondary)
    ];

    if (hasListView) {
        row1Components.push(
            new ButtonBuilder()
                .setCustomId('twin_back_to_list')
                .setLabel(t(locale, 'twins.btn_list'))
                .setEmoji('📜')
                .setStyle(ButtonStyle.Secondary)
        );
    }

    const row1 = new ActionRowBuilder().addComponents(row1Components);

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('twin_prev')
            .setEmoji('◀️')
            .setLabel(t(locale, 'twins.btn_prev_twin'))
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentIdx <= 0),

        new ButtonBuilder()
            .setCustomId('twin_next')
            .setEmoji('▶️')
            .setLabel(t(locale, 'twins.btn_next_twin'))
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentIdx >= totalCandidates - 1)
    );

    return [row1, row2];
}

module.exports = {
    doTwinMainEmbed,
    doTwinSharedEmbed,
    doTwinTopPlaysEmbed,
    doTwinListEmbed,
    buildTwinActionRow,
    buildTwinListActionRow,
    buildSkillComparisonAnsi
};
