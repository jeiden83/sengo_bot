const { EmbedBuilder } = require("discord.js");
const {
    getEmbedColor,
    getFormattedScore,
    getGradeEmoji,
    formatMods,
    getStatsString,
    getPlainStatsString,
    buildAnsiBlock
} = require("./osuViewHelpers.js");
const { colorear } = require("../commands/utils/admin.js");
const emoji_mods = require("../src/emoji_mods.json");

/**
 * Renderiza el embed para una única jugada reciente de osu!
 * @param {object} message Mensaje de Discord de origen (para extraer colores/roles)
 * @param {object} recent_scores Objeto de la jugada devuelto por la API de osu!/Gatari
 * @param {object} pre_calculated Atributos calculados previamente (PP, combo, estrellas)
 * @returns {Promise<EmbedBuilder>} EmbedBuilder configurado para Discord
 */
async function doOsuEmbed(message, recent_scores, pre_calculated) {
    const username = recent_scores.user.username;
    const user_url = recent_scores.user.server === 'gatari' ? `https://osu.gatari.pw/u/${recent_scores.user.id}` : `https://osu.ppy.sh/users/${recent_scores.user.id}`;
    const avatar_url = recent_scores.user.avatar_url;

    const song_title = recent_scores.beatmapset.title;
    const beatmap_difficulty = recent_scores.beatmap.version;
    const beatmap_url = `https://osu.ppy.sh/b/${recent_scores.beatmap.id}`;
    const beatmap_cover = recent_scores.beatmapset.covers["cover@2x"];

    const isLazer = recent_scores.build_id !== null && recent_scores.build_id !== undefined;
    const score = getFormattedScore(recent_scores);
    const accuracy = (recent_scores.accuracy * 100).toFixed(2);
    const user_max_combo = recent_scores.max_combo;
    const beatmap_max_combo = pre_calculated.beatmap_max_combo;
    const user_pp = `${pre_calculated.pp.toFixed(2)}`;
    const difficulty = pre_calculated.maxAttrs.difficulty.stars.toFixed(2);
    const embedColor = getEmbedColor(message);

    const stats = recent_scores.statistics || {};
    const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
    const perfect = stats.perfect !== undefined ? stats.perfect : (stats.count_geki || 0);

    const grade_emoji = getGradeEmoji(recent_scores.rank, recent_scores.passed);
    const mods_used = formatMods(recent_scores.mods, isLazer);
    const map_completion = recent_scores.passed ? `` : `(${((pre_calculated.map_completion) * 100).toFixed(2)}%)`;

    const stats_str = getStatsString(stats, recent_scores.beatmap.mode);
    let ratio_str = "";
    if (recent_scores.beatmap.mode === 'mania') {
        const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
        ratio_str = ` ▸ ${ratio}:1`;
    }

    let leaderboard_pos = null;
    let user_top_pos = null;
    if (recent_scores.passed) {
        if (recent_scores.user.server !== 'gatari') {
            try {
                const { v2 } = require('osu-api-extended');
                const unrankedWithoutLeaderboard = new Set(['pending', 'wip', 'graveyard']);
                const hasLeaderboard = recent_scores.beatmap.status && !unrankedWithoutLeaderboard.has(recent_scores.beatmap.status);

                const [best, topScores] = await Promise.all([
                    hasLeaderboard ? v2.scores.list({
                        type: 'user_beatmap_best',
                        beatmap_id: recent_scores.beatmap.id,
                        user_id: recent_scores.user.id,
                        mode: recent_scores.beatmap.mode
                    }).catch(() => null) : null,
                    v2.scores.list({
                        type: 'user_best',
                        user_id: recent_scores.user.id,
                        mode: recent_scores.beatmap.mode,
                        limit: 100
                    }).catch(() => null)
                ]);

                if (best && best.score) {
                    const isRecentPlayBest = (
                        new Date(best.score.ended_at || best.score.created_at).getTime() === new Date(recent_scores.ended_at || recent_scores.created_at).getTime() ||
                        best.score.total_score === recent_scores.total_score ||
                        best.score.legacy_total_score === recent_scores.legacy_total_score ||
                        (recent_scores.id && best.score.id === recent_scores.id)
                    );
                    if (isRecentPlayBest) {
                        leaderboard_pos = best.position;
                    }
                }

                if (topScores && Array.isArray(topScores)) {
                    const topIndex = topScores.findIndex(s => {
                        return (recent_scores.id && s.id === recent_scores.id) ||
                            (new Date(s.ended_at || s.created_at).getTime() === new Date(recent_scores.ended_at || recent_scores.created_at).getTime() &&
                                (s.legacy_total_score === recent_scores.legacy_total_score || s.total_score === recent_scores.total_score));
                    });
                    if (topIndex !== -1) {
                        user_top_pos = topIndex + 1;
                    }
                }
            } catch (e) {
                console.error("Error fetching beatmap best score position / top scores:", e);
            }
        } else {
            try {
                const modeMap = { 'osu': 0, 'taiko': 1, 'fruits': 2, 'mania': 3 };
                const m = modeMap[recent_scores.beatmap.mode || 'osu'];
                const response = await fetch(`https://api.gatari.pw/user/scores/best?id=${recent_scores.user.id}&mode=${m}&l=100`);
                const data = await response.json();
                if (data && Array.isArray(data.scores)) {
                    const topIndex = data.scores.findIndex(s => {
                        const recentTime = Math.floor(new Date(recent_scores.ended_at || recent_scores.created_at).getTime() / 1000);
                        const scoreVal = recent_scores.legacy_total_score || recent_scores.total_score || 0;
                        return s.beatmap.beatmap_id === recent_scores.beatmap.id &&
                            Math.abs(s.score - scoreVal) < 100 &&
                            Math.abs(s.time - recentTime) < 5;
                    });
                    if (topIndex !== -1) {
                        user_top_pos = topIndex + 1;
                    }
                }
            } catch (e) {
                console.error("Error fetching gatari best scores:", e);
            }
        }
    }

    let footerText = "Sengo";
    if (recent_scores.beatmap.mode === 'mania') {
        const ratioVal = great > 0 ? (perfect / great) : null;
        if (ratioVal !== null && ratioVal < 10) {
            footerText = "ratio de virgo";
        }
    }

    const ansiBlock = buildAnsiBlock(stats_str, user_pp, pre_calculated.maxAttrs.pp, pre_calculated.pp_fc, accuracy, ratio_str, user_max_combo, beatmap_max_combo);

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Puntuación Reciente de ${username} en ${recent_scores.beatmap.mode}!`,
            url: user_url,
            iconURL: `${avatar_url}`,
        })
        .setTitle(`${song_title} [${beatmap_difficulty}] - ${difficulty + '★'} `)
        .setURL(beatmap_url)
        .setDescription(`**Puntuación**: \`${score}\` **▸** ${grade_emoji} ${map_completion} **▸** ${mods_used}${leaderboard_pos ? ` **▸** 🌐 \`#${leaderboard_pos}\`` : ''}${user_top_pos ? ` **▸** 🏆 \`#${user_top_pos}\`` : ''}
${ansiBlock}
		`)
        .setImage(beatmap_cover)
        .setColor(embedColor)
        .setFooter({
            text: footerText,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp(new Date(recent_scores.ended_at || recent_scores.created_at));

    return embed;
}

/**
 * Renderiza el embed para la lista de jugadas recientes de osu! (-l)
 * @param {object} message Mensaje de Discord de origen
 * @param {object} parsed_args Argumentos analizados
 * @param {Array} recent_scores_chunk Subconjunto de jugadas
 * @param {number} startIndex Índice inicial
 * @param {number} total_plays Total de jugadas disponibles
 * @param {number|null} loadingIndex Índice de la jugada que se está calculando
 * @returns {Promise<EmbedBuilder>} EmbedBuilder configurado para Discord
 */
async function doOsuListEmbed(message, parsed_args, recent_scores_chunk, startIndex, total_plays, loadingIndex = null) {
    let embed_description = '';

    for (let i = 0; i < recent_scores_chunk.length; i++) {
        const score = recent_scores_chunk[i];
        const globalIndex = startIndex + i + 1;

        const grade_emoji = getGradeEmoji(score.rank, score.passed);
        const isLazer = score.build_id !== null && score.build_id !== undefined;
        const mods_used = formatMods(score.mods, isLazer);
        const accuracy = (score.accuracy * 100).toFixed(2);
        const max_combo = score.max_combo;

        let map_completion = "";
        if (score.calculatedPassPercent !== undefined) {
            if (!score.passed && score.calculatedPassPercent > 0) {
                map_completion = `*(${score.calculatedPassPercent.toFixed(1)}% pass)*`;
            }
        } else if (!score.passed) {
            const count_circles = score.beatmap.count_circles || 0;
            const count_sliders = score.beatmap.count_sliders || 0;
            const count_spinners = score.beatmap.count_spinners || 0;
            const total_objects = count_circles + count_sliders + count_spinners;
            if (total_objects > 0) {
                const stats = score.statistics || {};
                const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
                const ok = stats.ok !== undefined ? stats.ok : (stats.count_100 || 0);
                const meh = stats.meh !== undefined ? stats.meh : (stats.count_50 || 0);
                const miss = stats.miss !== undefined ? stats.miss : (stats.count_miss || 0);
                map_completion = `*(${((great + ok + meh + miss) / total_objects * 100).toFixed(1)}% pass)*`;
            }
        }

        const stats_str = `\`${getPlainStatsString(score.statistics, score.beatmap.mode)}\``;
        const gamemode = score.beatmap.mode || parsed_args.gamemode || 'osu';
        let ratio_str = "";
        if (gamemode === 'mania') {
            const stats = score.statistics || {};
            const perfect = stats.perfect !== undefined ? stats.perfect : (stats.count_geki || 0);
            const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
            const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
            ratio_str = ` ▸ **${ratio}:1**`;
        }

        let ppVal = score.calculatedPP !== undefined ? score.calculatedPP : score.pp;
        let pp = `${ppVal ? ppVal.toFixed(2) + "pp" : "⏳ pp"}`;

        let starsVal = score.calculatedStars !== undefined ? score.calculatedStars : score.beatmap.difficulty_rating;
        const stars = starsVal ? `${starsVal.toFixed(2)}★` : "";

        let time_set = `<t:${Math.floor((new Date(score.ended_at || score.created_at)).getTime() / 1000)}:R>`;
        const map_link = `[${score.beatmapset.title} [${score.beatmap.version}]](https://osu.ppy.sh/b/${score.beatmap.id})`;

        const score_line = `**#${globalIndex}** ▸ ${map_link} +${mods_used} [${stars}]\n` +
            ` ▸ ${grade_emoji} ▸ **${pp}** ▸ **${accuracy}%**${ratio_str} ▸ x${max_combo} ▸ ${stats_str} ▸ ${time_set} ${map_completion != "" ? `▸ ${map_completion}` : ""}\n\n`;

        embed_description = embed_description.concat(score_line);
    }

    const username = recent_scores_chunk[0].user.username;
    const user_url = recent_scores_chunk[0].user.server === 'gatari' ? `https://osu.gatari.pw/u/${recent_scores_chunk[0].user.id}` : `https://osu.ppy.sh/users/${recent_scores_chunk[0].user.id}`;
    const avatar_url = recent_scores_chunk[0].user.avatar_url;
    const embedColor = getEmbedColor(message);

    let footerText = `Mostrando jugadas ${startIndex + 1}-${startIndex + recent_scores_chunk.length} de ${total_plays} recientes`;
    if (loadingIndex !== null) {
        footerText = `⏳ Calculando pp de la play #${loadingIndex} de ${total_plays}...`;
    }

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Puntuaciones recientes de ${username} en osu!${parsed_args.gamemode || 'std'}`,
            url: user_url,
            iconURL: avatar_url
        })
        .setDescription(embed_description)
        .setColor(embedColor)
        .setFooter({
            text: footerText,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

/**
 * Renderiza el embed para una única jugada del Top de PP de osu!
 */
async function doOsuTopSingleEmbed(message, score, pre_calculated, index, total_plays, parsed_args, ppThresholdCount) {
    const username = score.user.username;
    const user_url = score.user.server === 'gatari' ? `https://osu.gatari.pw/u/${score.user.id}` : `https://osu.ppy.sh/users/${score.user.id}`;
    const avatar_url = score.user.avatar_url;

    const song_title = score.beatmapset.title;
    const beatmap_difficulty = score.beatmap.version;
    const beatmap_url = `https://osu.ppy.sh/b/${score.beatmap.id}`;
    const beatmap_cover = score.beatmapset.covers["cover@2x"];

    const isLazer = score.build_id !== null && score.build_id !== undefined;
    const score_val = getFormattedScore(score);
    const accuracy = (score.accuracy * 100).toFixed(2);
    const user_max_combo = score.max_combo;
    const beatmap_max_combo = pre_calculated.beatmap_max_combo;
    const user_pp = `${pre_calculated.pp.toFixed(2)}`;
    const difficulty = pre_calculated.maxAttrs.difficulty.stars.toFixed(2);
    const embedColor = getEmbedColor(message);

    const grade_emoji = getGradeEmoji(score.rank, score.passed);
    const mods_used = formatMods(score.mods, isLazer);
    const map_completion = score.passed ? `` : `(${((pre_calculated.map_completion) * 100).toFixed(2)}%)`;

    const stats = score.statistics || {};
    const stats_str = getStatsString(stats, score.beatmap.mode);

    let ratio_str = "";
    if (score.beatmap.mode === 'mania') {
        const perfect = stats.perfect !== undefined ? stats.perfect : (stats.count_geki || 0);
        const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
        const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
        ratio_str = ` ▸ ${ratio}:1`;
    }

    let prefix_desc = '';
    if (parsed_args.ppThreshold !== null) {
        let filterText = '';
        if (parsed_args.modFilter) filterText += ` con mods exactos ${parsed_args.modFilter}`;
        if (parsed_args.modContainFilter) filterText += ` con ${parsed_args.modContainFilter}`;
        if (parsed_args.searchFilter) filterText += ` que coinciden con "${parsed_args.searchFilter}"`;
        prefix_desc += `📈 **${username}** tiene **${ppThresholdCount}** ${ppThresholdCount === 1 ? 'jugada' : 'jugadas'} de **${parsed_args.ppThreshold} pp** o más${filterText} en su top.\n\n`;
    }

    let active_filters = [];
    if (parsed_args.modFilter !== null) active_filters.push(`mods exactos: ${parsed_args.modFilter}`);
    if (parsed_args.modContainFilter !== null) active_filters.push(`contiene mods: ${parsed_args.modContainFilter}`);
    if (parsed_args.searchFilter !== null) active_filters.push(`búsqueda: "${parsed_args.searchFilter}"`);
    if (parsed_args.recentSort) active_filters.push(`orden: más recientes ⏱️`);
    if (parsed_args.comboSort) active_filters.push(`orden: combo 📏`);
    if (parsed_args.accSort) active_filters.push(`orden: precisión 🎯`);

    if (active_filters.length > 0) {
        prefix_desc += `🔍 *Filtros activos: ${active_filters.join(" | ")}*\n\n`;
    }

    const ansiBlock = buildAnsiBlock(stats_str, user_pp, pre_calculated.maxAttrs.pp, pre_calculated.pp_fc, accuracy, ratio_str, user_max_combo, beatmap_max_combo);

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Puntuación #${score.originalRank || index} en el Top de PP de ${username}`,
            url: user_url,
            iconURL: `${avatar_url}`,
        })
        .setTitle(`${song_title} [${beatmap_difficulty}] - ${difficulty + '★'} `)
        .setURL(beatmap_url)
        .setDescription(`${prefix_desc}**Puntuación**: \`${score_val}\` **▸** ${grade_emoji} ${map_completion} **▸** ${mods_used}
${ansiBlock}
        `)
        .setImage(beatmap_cover)
        .setColor(embedColor)
        .setFooter({
            text: `Sengo • Jugada #${index} de ${total_plays} del Top de PP`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

/**
 * Renderiza el embed para la lista de jugadas del Top de PP de osu!
 */
async function doOsuTopListEmbed(message, parsed_args, top_scores_chunk, startIndex, total_plays, ppThresholdCount, calculated_stars) {
    let embed_description = '';
    const username = top_scores_chunk[0].user.username;

    if (parsed_args.ppThreshold !== null) {
        let filterText = '';
        if (parsed_args.modFilter) filterText += ` con mods exactos ${parsed_args.modFilter}`;
        if (parsed_args.modContainFilter) filterText += ` con ${parsed_args.modContainFilter}`;
        if (parsed_args.searchFilter) filterText += ` que coinciden con "${parsed_args.searchFilter}"`;
        embed_description += `📈 **${username}** tiene **${ppThresholdCount}** ${ppThresholdCount === 1 ? 'jugada' : 'jugadas'} de **${parsed_args.ppThreshold} pp** o más${filterText} en su top.\n\n`;
    }

    let active_filters = [];
    if (parsed_args.modFilter !== null) active_filters.push(`mods exactos: ${parsed_args.modFilter}`);
    if (parsed_args.modContainFilter !== null) active_filters.push(`contiene mods: ${parsed_args.modContainFilter}`);
    if (parsed_args.searchFilter !== null) active_filters.push(`búsqueda: "${parsed_args.searchFilter}"`);
    if (parsed_args.recentSort) active_filters.push(`orden: más recientes ⏱️`);
    if (parsed_args.comboSort) active_filters.push(`orden: combo 📏`);
    if (parsed_args.accSort) active_filters.push(`orden: precisión 🎯`);

    if (active_filters.length > 0) {
        embed_description += `🔍 *Filtros activos: ${active_filters.join(" | ")}*\n\n`;
    }

    for (let i = 0; i < top_scores_chunk.length; i++) {
        const score = top_scores_chunk[i];
        const globalIndex = startIndex + i + 1;

        const grade_emoji = getGradeEmoji(score.rank, score.passed);
        const isLazer = score.build_id !== null && score.build_id !== undefined;
        const mods_used = formatMods(score.mods, isLazer);
        const accuracy = (score.accuracy * 100).toFixed(2);
        const max_combo = score.max_combo;

        const stats_str = `\`${getPlainStatsString(score.statistics, score.beatmap.mode)}\``;
        const gamemode = score.beatmap.mode || parsed_args.gamemode || 'osu';
        let ratio_str = "";
        if (gamemode === 'mania') {
            const stats = score.statistics || {};
            const perfect = stats.perfect !== undefined ? stats.perfect : (stats.count_geki || 0);
            const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
            const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
            ratio_str = ` ▸ **${ratio}:1**`;
        }

        let pp = `${score.pp ? score.pp.toFixed(2) + "pp" : "0.00pp"}`;
        let starsVal = calculated_stars[i];
        const stars = starsVal ? `${starsVal.toFixed(2)}★` : "";
        let time_set = `<t:${Math.floor((new Date(score.ended_at || score.created_at)).getTime() / 1000)}:R>`;
        const map_link = `[${score.beatmapset.title} [${score.beatmap.version}]](https://osu.ppy.sh/b/${score.beatmap.id})`;

        const score_line = `**#${score.originalRank || globalIndex}** ▸ ${map_link} +${mods_used} [${stars}]\n` +
            ` ▸ ${grade_emoji} ▸ **${pp}** ▸ **${accuracy}%**${ratio_str} ▸ x${max_combo} ▸ ${stats_str}\n ▸ ${time_set}\n\n`;

        embed_description = embed_description.concat(score_line);
    }

    const user_url = top_scores_chunk[0].user.server === 'gatari' ? `https://osu.gatari.pw/u/${top_scores_chunk[0].user.id}` : `https://osu.ppy.sh/users/${top_scores_chunk[0].user.id}`;
    const avatar_url = top_scores_chunk[0].user.avatar_url;
    const embedColor = getEmbedColor(message);

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Mejores puntuaciones de ${username} en osu!${parsed_args.gamemode || 'std'}`,
            url: user_url,
            iconURL: avatar_url
        })
        .setThumbnail(avatar_url)
        .setDescription(embed_description)
        .setColor(embedColor)
        .setFooter({
            text: `Mostrando jugadas ${startIndex + 1}-${startIndex + top_scores_chunk.length} de ${total_plays} mejores`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

/**
 * Renderiza el embed para comparar una única score en un mapa específico (c.js)
 */
async function doOsuCompareSingleEmbed(message, score, pre_calculated, index, total_plays, parsed_args, beatmap_metadata) {
    const username = score.user?.username || parsed_args.username[0] || 'Usuario';
    const user_url = score.user?.server === 'gatari' ? `https://osu.gatari.pw/u/${score.user.id}` : `https://osu.ppy.sh/users/${score.user?.id || score.user_id}`;
    const avatar_url = score.user?.avatar_url || `https://a.ppy.sh/${score.user_id || score.user?.id}`;

    const song_title = beatmap_metadata.beatmapset.title;
    const beatmap_difficulty = beatmap_metadata.version;
    const beatmap_url = `https://osu.ppy.sh/b/${beatmap_metadata.id}`;
    const beatmap_cover = beatmap_metadata.beatmapset.covers["cover@2x"];

    const isLazer = score.build_id !== null && score.build_id !== undefined;
    const score_val = getFormattedScore(score);
    const accuracy = (score.accuracy * 100).toFixed(2);
    const user_max_combo = score.max_combo;

    const beatmap_max_combo = pre_calculated.beatmap_max_combo;
    const user_pp = `${pre_calculated.pp.toFixed(2)}`;
    const difficulty = pre_calculated.maxAttrs.difficulty.stars.toFixed(2);
    const embedColor = getEmbedColor(message);

    const grade_emoji = getGradeEmoji(score.rank, score.passed);
    const mods_used = formatMods(score.mods, isLazer);

    let compVal = pre_calculated.map_completion;
    if (compVal < 1.0) compVal = compVal * 100;
    const map_completion = score.passed ? `` : `(${compVal.toFixed(2)}%)`;

    const stats = score.statistics || {};
    const stats_str = getStatsString(stats, beatmap_metadata.mode);

    let ratio_str = "";
    if (beatmap_metadata.mode === 'mania') {
        const perfect = stats.perfect !== undefined ? stats.perfect : (stats.count_geki || 0);
        const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
        const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
        ratio_str = ` ▸ ${ratio}:1`;
    }

    let active_filters = [];
    if (parsed_args.modFilter !== null) active_filters.push(`mods exactos: ${parsed_args.modFilter}`);
    if (parsed_args.modContainFilter !== null) active_filters.push(`contiene mods: ${parsed_args.modContainFilter}`);
    if (parsed_args.ppThreshold !== null) active_filters.push(`PP >= ${parsed_args.ppThreshold}`);

    let prefix_desc = '';
    if (active_filters.length > 0) {
        prefix_desc += `🔍 *Filtros activos: ${active_filters.join(" | ")}*\n\n`;
    }

    const ansiBlock = buildAnsiBlock(stats_str, user_pp, pre_calculated.maxAttrs.pp, pre_calculated.pp_fc, accuracy, ratio_str, user_max_combo, beatmap_max_combo);

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Comparación de score #${score.originalRank || index} para ${username}`,
            url: user_url,
            iconURL: `${avatar_url}`,
        })
        .setTitle(`${song_title} [${beatmap_difficulty}] - ${difficulty + '★'} `)
        .setURL(beatmap_url)
        .setDescription(`${prefix_desc}**Puntuación**: \`${score_val}\` **▸** ${grade_emoji} ${map_completion} **▸** ${mods_used}
${ansiBlock}
        `)
        .setImage(beatmap_cover)
        .setColor(embedColor)
        .setFooter({
            text: `Sengo • Jugada #${index} de ${total_plays} comparadas`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp(new Date(score.ended_at || score.created_at));

    return embed;
}

/**
 * Renderiza el embed para la lista de puntuaciones comparadas (c.js)
 */
async function doOsuCompareListEmbed(message, parsed_args, user_scores_chunk, startIndex, total_plays, beatmap_metadata) {
    let embed_description = '';

    let active_filters = [];
    if (parsed_args.modFilter !== null) active_filters.push(`mods exactos: ${parsed_args.modFilter}`);
    if (parsed_args.modContainFilter !== null) active_filters.push(`contiene mods: ${parsed_args.modContainFilter}`);
    if (parsed_args.ppThreshold !== null) active_filters.push(`PP >= ${parsed_args.ppThreshold}`);

    if (active_filters.length > 0) {
        embed_description += `🔍 *Filtros activos: ${active_filters.join(" | ")}*\n\n`;
    }

    for (let i = 0; i < user_scores_chunk.length; i++) {
        const score = user_scores_chunk[i];
        const globalIndex = startIndex + i + 1;

        const grade_emoji = getGradeEmoji(score.rank, score.passed);
        const isLazer = score.build_id !== null && score.build_id !== undefined;
        const mods_used = formatMods(score.mods, isLazer);
        const legacy_score = getFormattedScore(score);
        const accuracy = (score.accuracy * 100).toFixed(2);
        const max_combo = score.max_combo;

        let map_completion = "";
        if (score.map_completion !== undefined && !score.passed) {
            let compVal = score.map_completion;
            if (compVal < 1.0) compVal = compVal * 100;
            map_completion = `*(${compVal.toFixed(1)}% pass)*`;
        }

        const stats_str = `\`${getPlainStatsString(score.statistics, beatmap_metadata.mode)}\``;
        const gamemode = beatmap_metadata.mode || parsed_args.gamemode || 'osu';
        let ratio_str = "";
        if (gamemode === 'mania') {
            const stats = score.statistics || {};
            const perfect = stats.perfect !== undefined ? stats.perfect : (stats.count_geki || 0);
            const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
            const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
            ratio_str = ` ▸ **${ratio}:1**`;
        }

        let pp = `${score.pp ? score.pp.toFixed(2) + "pp" : "0.00pp"}`;
        let time_set = `<t:${Math.floor((new Date(score.ended_at || score.created_at)).getTime() / 1000)}:R>`;

        const isFirst = globalIndex === 1;
        const rank_pos = isFirst ? `**#${score.originalRank || globalIndex}**` : `#${score.originalRank || globalIndex}`;

        const formatted_score = isFirst ? `**${legacy_score}**` : `${legacy_score}`;
        const formatted_accuracy = isFirst ? `**${accuracy}%**` : `${accuracy}%`;
        const formatted_pp = isFirst ? `__**${pp}**__` : `__${pp}__`;
        const formatted_combo = isFirst ? `**x${max_combo}**` : `x${max_combo}`;

        const score_line = `${rank_pos} ▸ ${grade_emoji} ▸ ${formatted_score} ▸ ${formatted_accuracy}${ratio_str} ▸ ${formatted_pp} ▸ ${formatted_combo} ▸ +${mods_used} ${map_completion}\n ▸ ${time_set} ▸ ${stats_str}\n\n`;

        embed_description = embed_description.concat(score_line);
    }

    const avatar_url = user_scores_chunk[0]?.user?.avatar_url || `https://a.ppy.sh/${parsed_args.username[0]}`;
    const embedColor = getEmbedColor(message);

    const embed = new EmbedBuilder()
        .setDescription(embed_description)
        .setColor(embedColor)
        .setThumbnail(avatar_url)
        .setFooter({
            text: `Mostrando puntuaciones ${startIndex + 1}-${startIndex + user_scores_chunk.length} de ${total_plays} totales`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

/**
 * Renderiza el embed para la confirmación de subida manual de score
 */
function doOsuSubirEmbed(message, recent_scores, pre_calculated, parsedData, user_id, beatmap_id) {
    const embedColor = getEmbedColor(message);
    const grade_emoji = getGradeEmoji(recent_scores.rank, recent_scores.passed);
    const isLazer = recent_scores.build_id !== null && recent_scores.build_id !== undefined;
    const mods_used = formatMods(recent_scores.mods, isLazer);
    const map_completion = recent_scores.passed ? `` : `(${((pre_calculated.map_completion) * 100).toFixed(2)}%)`;

    const stats = recent_scores.statistics || {};
    let stats_str = getStatsString(stats, recent_scores.beatmap.mode);
    if (recent_scores.beatmap.mode === 'fruits') {
        const { small_tick_miss = 0 } = stats;
        const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
        const ok = stats.ok !== undefined ? stats.ok : (stats.count_100 || 0);
        const meh = stats.meh !== undefined ? stats.meh : (stats.count_50 || 0);
        const miss = stats.miss !== undefined ? stats.miss : (stats.count_miss || 0);
        stats_str = `[${colorear(great, "azul")}/${colorear(ok, "verde")}/${colorear(meh, "amarillo")}/${colorear(miss, "rojo")}/${colorear(small_tick_miss, "magenta")}]`;
    }

    const formatted_score_val = getFormattedScore(recent_scores);
    const accuracy = (recent_scores.accuracy * 100).toFixed(2);
    const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
    const perfect = stats.perfect !== undefined ? stats.perfect : (stats.count_geki || 0);

    let ratio_str = "";
    if (recent_scores.beatmap.mode === 'mania') {
        const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
        ratio_str = ` ▸ ${ratio}:1`;
    }

    const ansiBlock = buildAnsiBlock(stats_str, pre_calculated.pp.toFixed(2), pre_calculated.maxAttrs.pp, pre_calculated.pp_fc, accuracy, ratio_str, recent_scores.max_combo, pre_calculated.beatmap_max_combo);

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Score manual guardada para ${parsedData.player_name}`,
            url: `https://osu.ppy.sh/users/${user_id}`,
            iconURL: recent_scores.user.avatar_url
        })
        .setTitle(`${recent_scores.beatmapset.title} [${recent_scores.beatmap.version}] - ${pre_calculated.maxAttrs.difficulty.stars.toFixed(2) + '★'} `)
        .setURL(`https://osu.ppy.sh/b/${beatmap_id}`)
        .setDescription(`**Puntuación**: \`${formatted_score_val}\` **▸** ${grade_emoji} ${map_completion} **▸** ${mods_used}
${ansiBlock}
        `)
        .setImage(recent_scores.beatmapset.covers["cover@2x"])
        .setColor(embedColor)
        .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp(new Date(recent_scores.ended_at));

    return embed;
}

/**
 * Renderiza el embed para el comando s.m (detalles de mapa)
 */
function doOsuMapEmbed({
    beatmap,
    activeMode,
    isConverted,
    stars,
    baseStars,
    statusName,
    embedColor,
    ppValues,
    attributes,
    objectsValue,
    userTags
}) {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

    // Emojis de mods para título
    let modsStr = attributes.modsStr || "";
    const mods_emoji_str = modsStr ? modsStr.match(/.{1,2}/g).reduce((acc, mod) => {
        return `${acc}<:${mod}:${emoji_mods[mod] || '123'}>`;
    }, ' +') : '';

    const mode_names = {
        'osu': 'osu!',
        'taiko': 'osu!taiko',
        'fruits': 'osu!catch',
        'mania': 'osu!mania'
    };

    const formatLength = (seconds) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    let tagsToDisplay = userTags;
    if (!tagsToDisplay || tagsToDisplay.length === 0) {
        if (beatmap.beatmapset.tags) {
            tagsToDisplay = beatmap.beatmapset.tags.split(/\s+/).filter(t => t.length > 0);
        }
    }
    const userTagsStr = tagsToDisplay && tagsToDisplay.length > 0
        ? `\n▸ **Etiquetas:** ${tagsToDisplay.slice(0, 3).map(t => `\`${t}\``).join(', ')}`
        : '';

    const ppSSColor = `\u001b[1;32m${ppValues.ppSS}pp\u001b[0m`;
    const pp99Color = `\u001b[1;33m${ppValues.pp99}pp\u001b[0m`;
    const pp98Color = `\u001b[1;36m${ppValues.pp98}pp\u001b[0m`;
    const ppAnsiBlock = `\`\`\`ansi\n${ppSSColor}/100% - ${pp99Color}/99% - ${pp98Color}/98%\n\`\`\``;

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Creado por ${beatmap.beatmapset.creator}`,
            iconURL: `https://a.ppy.sh/${beatmap.beatmapset.user_id}`,
            url: `https://osu.ppy.sh/users/${beatmap.beatmapset.user_id}`
        })
        .setTitle(`${beatmap.beatmapset.artist} - ${beatmap.beatmapset.title} [${beatmap.version}]${mods_emoji_str}`)
        .setURL(`https://osu.ppy.sh/b/${beatmap.id}`)
        .setDescription(`
▸ **Modo:** \`${mode_names[activeMode] || activeMode}\`${isConverted ? ' *(Convertido)*' : ''} ▸ **Dificultad:** \`${stars.toFixed(2)}★\` ${Math.abs(stars - baseStars) > 0.01 ? `*(Base: ${baseStars.toFixed(2)}★)*` : ''} ▸ **Estado:** \`${statusName}\`

▸ **BPM:** \`${attributes.bpm}\` ${attributes.speedMultiplier !== 1.0 ? `*(Base: ${attributes.baseBpm})*` : ''} ▸ **Duración:** \`${formatLength(attributes.totalLength)}\` *(Drain: ${formatLength(attributes.hitLength)})* ▸ **Combo:** \`x${attributes.maxCombo}\`
▸ **${attributes.csLabel}:** \`${activeMode === 'mania' ? attributes.cs.toFixed(0) : attributes.cs.toFixed(1)}\`${Math.abs(attributes.cs - attributes.baseCs) > 0.01 ? `*(${activeMode === 'mania' ? attributes.baseCs.toFixed(0) : attributes.baseCs.toFixed(1)})*` : ''} ▸ **AR:** \`${attributes.ar.toFixed(1)}\`${Math.abs(attributes.ar - attributes.baseAr) > 0.01 ? `*(${attributes.baseAr.toFixed(1)})*` : ''} ▸ **OD:** \`${attributes.od.toFixed(1)}\`${Math.abs(attributes.od - attributes.baseOd) > 0.01 ? `*(${attributes.baseOd.toFixed(1)})*` : ''} ▸ **HP:** \`${attributes.hp.toFixed(1)}\`${Math.abs(attributes.hp - attributes.baseHp) > 0.01 ? `*(${attributes.baseHp.toFixed(1)})*` : ''}

▸ **Objetos:** ${objectsValue}

▸ **Valores de PP recomendados:**
${ppAnsiBlock}${userTagsStr}
        `)
        .setImage(beatmap.beatmapset.covers["cover@2x"])
        .setColor(embedColor)
        .setFooter({
            text: `Sengo • Beatmap ID: ${beatmap.id}`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    const redirectBase = process.env.RENDER_EXTERNAL_URL || 'https://stoppable-passcode-riot.ngrok-free.dev';
    const osuDirectPCUrl = `${redirectBase}/osu/${beatmap.beatmapset_id}`;

    // Construir la fila de botones de descarga
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setLabel('Lanzar osu!')
                .setStyle(ButtonStyle.Link)
                .setURL(osuDirectPCUrl),
            new ButtonBuilder()
                .setLabel('osu.direct (Web)')
                .setStyle(ButtonStyle.Link)
                .setURL(`https://osu.direct/d/${beatmap.beatmapset_id}`),
            new ButtonBuilder()
                .setLabel('Nerinyan')
                .setStyle(ButtonStyle.Link)
                .setURL(`https://api.nerinyan.moe/d/${beatmap.beatmapset_id}?novideo=1`),
            new ButtonBuilder()
                .setLabel('Sayobot')
                .setStyle(ButtonStyle.Link)
                .setURL(`https://txy1.sayobot.cn/beatmaps/download/novideo/${beatmap.beatmapset_id}`)
        );

    return { embed, components: [row] };
}

/**
 * Renderiza el embed para el comando s.snipes (tops nacionales / snipe.huismetbenen.nl)
 */
function doOsuSnipesEmbed(message, sniped_userdata, osu_userdata) {
    if (osu_userdata.playmode != 'osu') {
        return `> El servicio de snipes solo funciona para **osu!std**`;
    }
    if (!sniped_userdata) {
        return `**El usuario \`${osu_userdata.username}\` **no tiene tops nacionales.**`;
    }

    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ffffff';
    const icon_url = osu_userdata.team ? osu_userdata.team.flag_url : osu_userdata.avatar_url;

    const mod_mas_usado = Object.entries(sniped_userdata.mods_count ?? {})
        .reduce((max, entry) => entry[1] > max[1] ? entry : max, ['N/A', -1]);

    const mostSnipes_year = Object.entries(sniped_userdata.dates_set ?? {})
        .reduce((max, entry) => entry[1] > max[1] ? entry : max, ['N/A', -1]);

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `${osu_userdata.team ? `[${osu_userdata.team.short_name}]` : ""} ${osu_userdata.username}: ${osu_userdata.statistics.pp}pp`,
            url: `https://osu.ppy.sh/users/${osu_userdata.id}`,
            iconURL: icon_url
        })
        .setDescription(`**• Total de #1:** \`#${sniped_userdata.count_total}\`
**• PP promedio :** \`${Math.round(sniped_userdata.average_pp * 100) / 100}\`
**• Mod mas usado:** \`[${mod_mas_usado[0]}] = ${mod_mas_usado[1]}\`
**• Año con mas snipes:** \`[${mostSnipes_year[0]}] = ${mostSnipes_year[1]}\`
`)
        .setColor(embedColor)
        .setFooter({
            text: "Sengo",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return { embeds: [embed] };
}

function checkOsuData(osu_userdata) {
    const global_ranking = osu_userdata.statistics.global_rank || 0;
    const peak_ranking = osu_userdata.rank_highest ? osu_userdata.rank_highest.rank : 0;
    const discord_last_peak = osu_userdata.rank_highest ? `<t:${Math.floor((new Date(osu_userdata.rank_highest.updated_at)).getTime() / 1000)}:R>` : `\`nunca jugado\``;
    const country_rank = osu_userdata.statistics.rank.country || 0;

    return {
        global_ranking, discord_last_peak, peak_ranking, country_rank
    };
}

/**
 * Renderiza el embed para el perfil de osu! (s.osu)
 */
function doOsuProfileEmbed(message, osu_userdata, osu_mode, is_detailed = false, osuworld_data = null) {
    const { global_ranking, discord_last_peak, peak_ranking, country_rank } = checkOsuData(osu_userdata);

    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ffffff';
    const icon_url = osu_userdata.team ? osu_userdata.team.flag_url : osu_userdata.avatar_url;

    const join_date = `<t:${Math.floor(new Date(osu_userdata.join_date).getTime() / 1000)}:R>`;

    let top_ranking_str = osu_userdata.server === 'gatari' ? "" : `**• Top ranking:** \`#${peak_ranking}\`  ${discord_last_peak}\n`;

    let rankedPlayStr = "";
    if (osu_userdata.server !== 'gatari') {
        const matchmaking = osu_userdata.matchmaking_stats?.find(m => m.pool && m.pool.type === 'ranked_play') || osu_userdata.matchmaking_stats?.[0];
        if (matchmaking && matchmaking.rank) {
            rankedPlayStr = `**• Ranked Play:** \`#${matchmaking.rank.toLocaleString('es-ES')}\` (Rating: ${(matchmaking.rating || 0).toLocaleString('es-ES')})\n`;
        }
    }

    const isSupporter = !!osu_userdata.is_supporter;
    let supporterEmoji = "";
    if (isSupporter) {
        const level = osu_userdata.support_level || 1;
        if (level === 2) {
            supporterEmoji = "<:supporter2:1507587013220503633> ";
        } else if (level === 3) {
            supporterEmoji = "<:supporter3:1507587014680383529> ";
        } else {
            supporterEmoji = "<:supporter:1507587101481242704> ";
        }
    }

    let regionalRankStr = "";
    if (osuworld_data && osuworld_data.region_id && osuworld_data.placement) {
        try {
            const iso = require("iso-3166-2");
            const subdivision = iso.subdivision(osuworld_data.region_id);
            const regionName = (subdivision && subdivision.name) ? subdivision.name : osuworld_data.region_id;
            const urlRegionName = regionName.replace(/[\s,]+/g, "_");
            regionalRankStr = ` / **[#${osuworld_data.placement}](https://osuworld.octo.moe/#${urlRegionName})**`;
        } catch (e) {
            // Silencioso
        }
    }

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Perfil osu!${osu_mode} de ${osu_userdata.team ? `[${osu_userdata.team.short_name}]` : ""} ${osu_userdata.username}`,
            url: osu_userdata.server === 'gatari' ? `https://osu.gatari.pw/u/${osu_userdata.id}` : `https://osu.ppy.sh/users/${osu_userdata.id}`,
            iconURL: icon_url
        })
        .setDescription(`**• Ranking global:** \`#${global_ranking}\`\n${top_ranking_str}**• Ranking por pais:** :flag_${osu_userdata.country_code.toLowerCase()}: ${supporterEmoji}\`#${country_rank}\`${regionalRankStr}\n${rankedPlayStr}${osu_userdata.team ? `**• Team: [[${osu_userdata.team.short_name}] ${osu_userdata.team.name}](https://osu.ppy.sh/teams/${osu_userdata.team.id})**\n` : ``}**• Fecha de inicio: **${join_date}`)
        .addFields(
            {
                name: "Medallas",
                value: `\`${osu_userdata.user_achievements.length}\``,
                inline: true
            },
            {
                name: "Tiempo de juego",
                value: `\`${Math.floor(osu_userdata.statistics.play_time / 3600)} h\``,
                inline: true
            },
            {
                name: "Nivel",
                value: `\`${osu_userdata.statistics.level.current}.${osu_userdata.statistics.level.progress}\``,
                inline: true
            },
            {
                name: "PP",
                value: `\`${Math.round(osu_userdata.statistics.pp)}\``,
                inline: true
            },
            {
                name: "Precision",
                value: `\`${osu_userdata.statistics.hit_accuracy.toFixed(2)}%\``,
                inline: true
            },
            {
                name: "Jugadas totales",
                value: `\`${osu_userdata.statistics.play_count}\``,
                inline: true
            }
        )
        .setImage(osu_userdata.cover_url)
        .setThumbnail(osu_userdata.avatar_url)
        .setColor(embedColor)
        .setFooter({
            text: "Sengo",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    if (!is_detailed) {
        return { embeds: [embed] };
    }

    // Embed detallado (Doble página)
    const emoji_grades = require("../src/emoji_grades.json");
    const getGradeEmoji = (gradeKey) => {
        const data = emoji_grades[gradeKey];
        if (!data) return gradeKey;
        return `<:${data[0]}:${data[1]}>`;
    };

    const grades = osu_userdata.statistics.grade_counts;
    const grades_str =
        `${getGradeEmoji("XH")} \`${(grades.ssh || 0).toLocaleString('es-ES')}\`   ` +
        `${getGradeEmoji("X")} \`${(grades.ss || 0).toLocaleString('es-ES')}\`   ` +
        `${getGradeEmoji("SH")} \`${(grades.sh || 0).toLocaleString('es-ES')}\`   ` +
        `${getGradeEmoji("S")} \`${(grades.s || 0).toLocaleString('es-ES')}\`   ` +
        `${getGradeEmoji("A")} \`${(grades.a || 0).toLocaleString('es-ES')}\``;

    // --- CÁLCULOS PARA EL ANÁLISIS RÁPIDO ---
    const total_grades = (grades.ssh || 0) + (grades.ss || 0) + (grades.sh || 0) + (grades.s || 0) + (grades.a || 0);
    const ss_percent = total_grades > 0 ? (((grades.ssh || 0) + (grades.ss || 0)) / total_grades * 100).toFixed(1) : "0.0";
    const s_percent = total_grades > 0 ? (((grades.sh || 0) + (grades.s || 0)) / total_grades * 100).toFixed(1) : "0.0";
    const a_percent = total_grades > 0 ? ((grades.a || 0) / total_grades * 100).toFixed(1) : "0.0";

    const joinDate = new Date(osu_userdata.join_date);
    const diffDays = Math.max(1, Math.ceil(Math.abs(Date.now() - joinDate) / (1000 * 60 * 60 * 24)));
    const avg_playcount_day = (osu_userdata.statistics.play_count / diffDays).toFixed(1);

    const playcountVal = osu_userdata.statistics.play_count || 0;
    const pp_per_1k = playcountVal > 0 ? (osu_userdata.statistics.pp / (playcountVal / 1000)).toFixed(1) : "0.0";
    const hits_per_play = playcountVal > 0 ? (osu_userdata.statistics.total_hits / playcountVal).toFixed(1) : "0.0";
    const hits_per_min = osu_userdata.statistics.play_time > 0 ? Math.round(osu_userdata.statistics.total_hits / (osu_userdata.statistics.play_time / 60)) : 0;

    let matchmakingSection = "";
    if (osu_userdata.server !== 'gatari') {
        const matchmaking = osu_userdata.matchmaking_stats?.find(m => m.pool && m.pool.type === 'ranked_play') || osu_userdata.matchmaking_stats?.[0];
        if (matchmaking) {
            matchmakingSection = `🏆 **Ranked Play Detallado (lazer):**\n` +
                ` ▸ **Temporada:** \`${matchmaking.pool?.name || 'N/A'}\`\n` +
                ` ▸ **Rango:** \`#${matchmaking.rank ? matchmaking.rank.toLocaleString('es-ES') : 'Sin clasificar'}\`\n` +
                ` ▸ **Rating:** \`${matchmaking.rating ? matchmaking.rating.toLocaleString('es-ES') : 0}\` rating\n` +
                ` ▸ **Victorias:** \`${matchmaking.first_placements || 0}\` wins\n` +
                ` ▸ **Partidas:** \`${matchmaking.plays || 0}\` plays\n` +
                ` ▸ **Provisional:** \`${matchmaking.is_rating_provisional ? 'Sí' : 'No'}\`\n\n`;
        }
    }

    const analysis_desc =
        `**Grados Obtenidos:**\n${grades_str}\n\n` +
        `📊 **Perfil de Precisión (Ratios):**\n` +
        ` ▸ **SS Ranks (FC Perfecto):** \`${ss_percent}%\` del total\n` +
        ` ▸ **S Ranks (FC/Buen Acc):** \`${s_percent}%\` del total\n` +
        ` ▸ **A Ranks (Pass/Bajo Acc):** \`${a_percent}%\` del total\n\n` +
        `⚡ **Análisis Rápido de Rendimiento:**\n` +
        ` ▸ **Antigüedad de la cuenta:** \`${diffDays.toLocaleString('es-ES')}\` días\n` +
        ` ▸ **Ritmo de Juego:** \`${avg_playcount_day}\` playcount/día\n` +
        ` ▸ **Eficiencia de PP:** \`${pp_per_1k}\` PP por cada 1,000 plays\n` +
        ` ▸ **Consistencia de Hits:** \`${hits_per_play}\` hits promedio por jugada\n\n` +
        matchmakingSection +
        `**Estadísticas de Puntuación:**`;

    const embed2 = new EmbedBuilder()
        .setAuthor({
            name: `Rendimiento Detallado de ${osu_userdata.username}`,
            url: osu_userdata.server === 'gatari' ? `https://osu.gatari.pw/u/${osu_userdata.id}` : `https://osu.ppy.sh/users/${osu_userdata.id}`,
            iconURL: icon_url
        })
        .setDescription(analysis_desc)
        .addFields(
            {
                name: "Puntuación Clasificada",
                value: `\`${(osu_userdata.statistics.ranked_score || 0).toLocaleString('es-ES')}\``,
                inline: true
            },
            {
                name: "Puntuación Total",
                value: `\`${(osu_userdata.statistics.total_score || 0).toLocaleString('es-ES')}\``,
                inline: true
            },
            {
                name: "Combo Máximo",
                value: `\`x${(osu_userdata.statistics.maximum_combo || 0).toLocaleString('es-ES')}\``,
                inline: true
            },
            {
                name: "Hits Totales",
                value: `\`${(osu_userdata.statistics.total_hits || 0).toLocaleString('es-ES')}\``,
                inline: true
            },
            {
                name: "Replays Vistas por Otros",
                value: `\`${(osu_userdata.statistics.replays_watched_by_others || 0).toLocaleString('es-ES')}\``,
                inline: true
            },
            {
                name: "Hits por Minuto",
                value: `\`${hits_per_min.toLocaleString('es-ES')}\``,
                inline: true
            }
        )
        .setColor(embedColor)
        .setFooter({
            text: "Sengo • Página 2 de 2 • Estadísticas Detalladas",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return { embeds: [embed, embed2] };
}

function getOsuCompareContent(parsed_args, username, beatmap_metadata) {
    const { title } = beatmap_metadata.beatmapset;
    const { difficulty_rating, version, url } = beatmap_metadata;

    let mapa = `[${title} [${version}] - ${difficulty_rating + '★'} ](${url})`;
    const displayMode = parsed_args.gamemode === 'osu' ? 'std' : (parsed_args.gamemode === 'fruits' ? 'ctb' : parsed_args.gamemode);
    return `**Puntuaciones de \`${username}\` en \`osu!${displayMode}\`: \n${mapa}**`;
}


function diffString(diff) {
    if (diff > 0) return `+${diff.toFixed(2)}`;
    if (diff < 0) return `${diff.toFixed(2)}`;
    return `0.00`;
}

async function doOsuReworkMapEmbed(message, beatmap, livePPValues, reworkResult, rework, modsStr) {
    const embedColor = getEmbedColor(message);
    const beatmap_url = `https://osu.ppy.sh/b/${beatmap.id}`;
    const beatmap_cover = beatmap.beatmapset.covers["cover@2x"];

    const diffPPColor = (diff) => {
        if (diff > 0) return `\u001b[1;32m+${diff.toFixed(2)}\u001b[0m`;
        if (diff < 0) return `\u001b[1;31m${diff.toFixed(2)}\u001b[0m`;
        return `\u001b[1;37m0.00\u001b[0m`;
    };

    const ppSSColor = `\u001b[1;37mSS:\u001b[0m  ${livePPValues.ppSS.toFixed(2)}pp -> ${reworkResult.ppSS.toFixed(2)}pp (${diffPPColor(reworkResult.ppSS - livePPValues.ppSS)})`;
    const pp99Color = `\u001b[1;37m99%:\u001b[0m ${livePPValues.pp99.toFixed(2)}pp -> ${reworkResult.pp99.toFixed(2)}pp (${diffPPColor(reworkResult.pp99 - livePPValues.pp99)})`;
    const pp98Color = `\u001b[1;37m98%:\u001b[0m ${livePPValues.pp98.toFixed(2)}pp -> ${reworkResult.pp98.toFixed(2)}pp (${diffPPColor(reworkResult.pp98 - livePPValues.pp98)})`;
    const pp95Color = `\u001b[1;37m95%:\u001b[0m ${livePPValues.pp95.toFixed(2)}pp -> ${reworkResult.pp95.toFixed(2)}pp (${diffPPColor(reworkResult.pp95 - livePPValues.pp95)})`;
    const ppAnsiBlock = `\`\`\`ansi\n${ppSSColor}\n${pp99Color}\n${pp98Color}\n${pp95Color}\n\`\`\``;

    let modsDisplay = modsStr ? `+${modsStr.toUpperCase()}` : "Nomod";
    let statusText = "";
    if (!reworkResult.hasScores) {
        statusText = "💡 *Nota: Este mapa no tiene puntuaciones en este rework. Se muestran valores estimativos iguales a Live.*";
    } else if (reworkResult.hasExactMatch) {
        statusText = `✅ *Coincidencia exacta de mods en las jugadas del rework. (Ratio: ${(reworkResult.ratio * 100).toFixed(1)}%)*`;
    } else {
        statusText = `⚠️ *No hay jugadas con esta combinación de mods en el rework. Estimación basada en el promedio del mapa. (Ratio: ${(reworkResult.ratio * 100).toFixed(1)}%)*`;
    }

    const diffSR = reworkResult.stars - livePPValues.baseStars;
    const srDiffStr = diffSR > 0 ? `+${diffSR.toFixed(2)}` : diffSR.toFixed(2);
    const srDisplay = `${livePPValues.baseStars.toFixed(2)}★ -> ${reworkResult.stars.toFixed(2)}★ (${srDiffStr})`;

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Estimación de PP en Rework: ${rework.name}`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTitle(`${beatmap.beatmapset.artist} - ${beatmap.beatmapset.title} [${beatmap.version}]`)
        .setURL(beatmap_url)
        .setImage(beatmap_cover)
        .setColor(embedColor)
        .setDescription(`
**• Mods:** \`${modsDisplay}\`
**• Dificultad:** \`${srDisplay}\`
**• Rework:** \`${rework.name}\` (\`${rework.code}\` / ID: \`${rework.id}\`)

**Valores de PP recalculados (Estimación):**
${ppAnsiBlock}
${statusText}
        `)
        .setFooter({
            text: "Sengo • PP Rework Beatmap Calc",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

async function doOsuReworkUserEmbed(message, osuUser, reworkUser, rework, scores = [], isLoading = false) {
    const embedColor = getEmbedColor(message);
    const user_url = osuUser.server === 'gatari' ? `https://osu.gatari.pw/u/${osuUser.id}` : `https://osu.ppy.sh/users/${osuUser.id}`;

    // pp_change_relative es por ejemplo 0.938963 (lo cual es -6.10%)
    const pctChange = ((reworkUser.pp_change_relative - 1) * 100).toFixed(2);
    const pctSign = pctChange > 0 ? "+" : "";

    const diffPPColor = (diff) => {
        if (diff > 0) return `\u001b[1;32m+${diff.toFixed(2)}\u001b[0m`;
        if (diff < 0) return `\u001b[1;31m${diff.toFixed(2)}\u001b[0m`;
        return `\u001b[1;30m0.00\u001b[0m`;
    };

    let statsBlock = "";
    let breakdownTitle = "Desglose de PP ponderado en Rework:";

    if (isLoading) {
        breakdownTitle = "Impacto de PP por Mods (Top Rework):";
        statsBlock = `\`\`\`ansi\n⏳ Calculando impacto de mods...\n\`\`\``;
    } else if (scores && scores.length > 0) {
        breakdownTitle = "Impacto de PP por Mods (Top Rework):";
        const modChangesMap = {};
        const modOrder = ["NF", "EZ", "TD", "HD", "HR", "DT", "NC", "HT", "FL", "SO", "SD", "PF"];

        // 1. Determinar el rango original (old_rank) ordenando por live_pp descendente
        const sortedByLive = [...scores]
            .filter(s => s.values && typeof s.values.live_pp === 'number')
            .sort((a, b) => (b.values.live_pp || 0) - (a.values.live_pp || 0));

        const oldRankMap = new Map();
        sortedByLive.forEach((score, idx) => {
            if (score.score_id) {
                oldRankMap.set(score.score_id, idx + 1);
            } else if (score.beatmap && score.beatmap.id) {
                oldRankMap.set(score.beatmap.id, idx + 1);
            }
        });

        // 2. Determinar el nuevo rango (new_rank) ordenando por local_pp descendente
        const sortedByLocal = [...scores]
            .filter(s => s.values && typeof s.values.local_pp === 'number')
            .sort((a, b) => (b.values.local_pp || 0) - (a.values.local_pp || 0));

        for (let idx = 0; idx < sortedByLocal.length; idx++) {
            const score = sortedByLocal[idx];
            const newRank = idx + 1;
            const oldRank = (score.score_id && oldRankMap.has(score.score_id))
                ? oldRankMap.get(score.score_id)
                : (score.beatmap && score.beatmap.id && oldRankMap.has(score.beatmap.id))
                ? oldRankMap.get(score.beatmap.id)
                : (score.old_rank || 101);

            const localPP = score.values.local_pp || 0;
            const livePP = score.values.live_pp || 0;

            // Calcular el PP ponderado (sólo aportan los primeros 100 puestos)
            const weightedLocal = newRank <= 100 ? localPP * Math.pow(0.95, newRank - 1) : 0;
            const weightedLive = oldRank <= 100 ? livePP * Math.pow(0.95, oldRank - 1) : 0;
            const weightedDiff = weightedLocal - weightedLive;

            const filteredMods = score.mods ? score.mods.map(m => m.acronym).filter(a => a !== 'CL') : [];
            filteredMods.sort((a, b) => {
                let idxA = modOrder.indexOf(a);
                let idxB = modOrder.indexOf(b);
                if (idxA === -1) idxA = 999;
                if (idxB === -1) idxB = 999;
                return idxA - idxB;
            });

            const modStr = filteredMods.length > 0 ? filteredMods.join("") : "NM";
            if (!modChangesMap[modStr]) {
                modChangesMap[modStr] = 0;
            }
            modChangesMap[modStr] += weightedDiff;
        }

        const modChangesArray = Object.entries(modChangesMap).map(([mods, change]) => ({
            mods,
            change
        }));

        const positives = modChangesArray.filter(x => x.change > 0).sort((a, b) => b.change - a.change).slice(0, 3);
        const negatives = modChangesArray.filter(x => x.change < 0).sort((a, b) => a.change - b.change).slice(0, 3);

        const formatChange = (val) => {
            const sign = val >= 0 ? "+" : "";
            if (val > 0) return `\u001b[1;32m${sign}${val.toFixed(2)}pp\u001b[0m`;
            if (val < 0) return `\u001b[1;31m${val.toFixed(2)}pp\u001b[0m`;
            return `\u001b[1;30m0.00pp\u001b[0m`;
        };

        const formatModList = (list) => {
            if (list.length === 0) return " \u001b[1;30mNinguno\u001b[0m\n";
            return list.map(item => {
                const labelText = item.mods === "NM" ? "NM" : `+${item.mods}`;
                const label = ` \u001b[1;37m${labelText.padEnd(12)}\u001b[1;30m:\u001b[0m`;
                return `${label} ${formatChange(item.change)}`;
            }).join("\n") + "\n";
        };

        let blockText = "";
        blockText += `\u001b[1;32m▲ Aportan más:\u001b[0m\n`;
        blockText += formatModList(positives);
        blockText += `\n\u001b[1;31m▼ Quitan más:\u001b[0m\n`;
        blockText += formatModList(negatives);

        statsBlock = `\`\`\`ansi\n${blockText}\`\`\``;
    } else {
        const aimPP = `\u001b[1;37mWeighted Aim\u001b[1;30m:\u001b[0m     ${(reworkUser.weighted_aim_pp || 0).toFixed(2)}pp`;
        const tapPP = `\u001b[1;37mWeighted Tap\u001b[1;30m:\u001b[0m     ${(reworkUser.weighted_tap_pp || 0).toFixed(2)}pp`;
        const accPP = `\u001b[1;37mWeighted Acc\u001b[1;30m:\u001b[0m     ${(reworkUser.weighted_acc_pp || 0).toFixed(2)}pp`;
        const readPP = `\u001b[1;37mWeighted Reading\u001b[1;30m:\u001b[0m ${(reworkUser.weighted_reading_pp || 0).toFixed(2)}pp`;
        statsBlock = `\`\`\`ansi\n${aimPP}\n${tapPP}\n${accPP}\n${readPP}\n\`\`\``;
    }

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Detalles de PP en Rework para ${osuUser.username}!`,
            url: user_url,
            iconURL: osuUser.avatar_url,
        })
        .setThumbnail(osuUser.avatar_url)
        .setColor(embedColor)
        .setDescription(`
**• Rework:** \`${rework.name}\` (\`${rework.code}\` / ID: \`${rework.id}\`)
**• Precisión Promedio:** \`${(reworkUser.overall_accuracy || 0).toFixed(2)}%\`

**Comparación de PP:**
▸ **PP Live:** \`${reworkUser.old_pp.toFixed(2)} pp\`
▸ **PP Rework:** \`${reworkUser.new_pp_incl_bonus.toFixed(2)} pp\`
▸ **Cambio:** \`${diffString(reworkUser.pp_change)} pp (${pctSign}${pctChange}%)\`

**${breakdownTitle}**
${statsBlock}
        `)
        .setFooter({
            text: "Sengo • PP Rework User Profile",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

async function doOsuReworkListEmbed(message, reworks) {
    const embedColor = getEmbedColor(message);

    // Agrupar por categoría
    const confirmed = reworks.filter(r => r.category === 'CONFIRMED');
    const proposed = reworks.filter(r => r.category === 'PROPOSED');
    const wip = reworks.filter(r => r.category === 'WIP');

    const formatCategory = (list) => {
        if (list.length === 0) return "*Ninguno*";
        return list.slice(0, 15).map(r => {
            const modeNames = ["std", "taiko", "ctb", "mania"];
            const mode = modeNames[r.gamemode] || "std";
            return `• \`${r.id}\` | **${r.name}** (\`${r.code}\` - *osu!${mode}*)`;
        }).join("\n");
    };

    const embed = new EmbedBuilder()
        .setTitle("Lista de Reworks Próximos y Propuestos")
        .setColor(embedColor)
        .setDescription(`
Aquí puedes ver la lista de reworks disponibles en pp.huismetbenen.nl.
Usa \`.rework -rework <nombre/id>\` para calcular con respecto a un rework específico.

### 🔴 Confirmados para el próximo deploy (${confirmed.length})
${formatCategory(confirmed)}

### 🟡 Propuestos (${proposed.length})
${formatCategory(proposed)}

### 🔵 En Progreso (WIP) (${wip.length})
${formatCategory(wip)}
        `)
        .setFooter({
            text: "Sengo • Rework List",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

async function doOsuReworkTopEmbed(message, osuUser, sortedScores, rework, startIndex = 0) {
    const embedColor = getEmbedColor(message);
    const total_plays = sortedScores.length;
    const topScores = sortedScores.slice(startIndex, startIndex + 5);

    let description = `Aquí tienes las mejores jugadas recalculadas para **${osuUser.username}** bajo el rework **${rework.name}** (\`${rework.code}\`).\n\n`;

    topScores.forEach((score, index) => {
        const beatmap = score.beatmap || {};
        const values = score.values || {};
        const localPP = values.local_pp || 0;
        const livePP = values.live_pp || 0;
        const diff = localPP - livePP;
        const diffSign = diff >= 0 ? "+" : "";

        // Formatear mods
        const modsStr = score.mods && score.mods.length > 0
            ? `+${score.mods.map(m => m.acronym).filter(a => a !== 'CL').join("")}`
            : "";

        const mapName = `${beatmap.artist} - ${beatmap.title} [${beatmap.diff_name}]`;
        const mapUrl = `https://osu.ppy.sh/b/${beatmap.id}`;

        const emoji = diff >= 0 ? "🟢" : "🔴";
        const diffString = `${emoji} ${diffSign}${diff.toFixed(2)}pp`;

        const oldRank = score.old_rank || "-";
        const newRank = score.new_rank || (startIndex + index + 1);

        description += `**${startIndex + index + 1}.** [${mapName}](${mapUrl}) **${modsStr}**\n`;
        description += ` ▸ **PP:** \`${livePP.toFixed(1)} pp\` ➔ **\`${localPP.toFixed(1)} pp\`** (${diffString})\n`;
        description += ` ▸ **Acc:** \`${score.accuracy.toFixed(2)}%\` | **Rank:** \`#${oldRank}\` ➔ \`#${newRank}\`\n\n`;
    });

    const embed = new EmbedBuilder()
        .setTitle(`Top Rework de PP - ${osuUser.username}`)
        .setColor(embedColor)
        .setThumbnail(osuUser.avatar_url || `https://a.ppy.sh/${osuUser.id}`)
        .setDescription(description)
        .setFooter({
            text: `Sengo • PP Rework Top Plays (${startIndex + 1}-${Math.min(total_plays, startIndex + 5)} de ${total_plays}) Birb`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

async function doOsuReworkTopSingleEmbed(message, osuUser, score, rework, index, total_plays) {
    const embedColor = getEmbedColor(message);
    const user_url = osuUser.server === 'gatari' ? `https://osu.gatari.pw/u/${osuUser.id}` : `https://osu.ppy.sh/users/${osuUser.id}`;
    const avatar_url = osuUser.avatar_url || `https://a.ppy.sh/${osuUser.id}`;

    const beatmap = score.beatmap || {};
    const values = score.values || {};
    const localPP = values.local_pp || 0;
    const livePP = values.live_pp || 0;
    const diff = localPP - livePP;
    const diffSign = diff >= 0 ? "+" : "";
    const emoji = diff >= 0 ? "🟢" : "🔴";
    const diffString = `${emoji} ${diffSign}${diff.toFixed(2)}pp`;

    // Formatear mods
    const modsStr = score.mods && score.mods.length > 0
        ? `+${score.mods.map(m => m.acronym).filter(a => a !== 'CL').join("")}`
        : "";

    const mapName = `${beatmap.artist} - ${beatmap.title} [${beatmap.diff_name}]`;
    const mapUrl = `https://osu.ppy.sh/b/${beatmap.id}`;

    const oldRank = score.old_rank || "-";
    const newRank = score.new_rank || index;

    // Calcular/mostrar estrellas si están disponibles
    const liveSR = beatmap.star_rating || 0;
    const reworkSR = values.sr || liveSR;
    const srDiff = reworkSR - liveSR;
    const srDiffSign = srDiff >= 0 ? "+" : "";
    const srDisplay = `${liveSR.toFixed(2)}★ -> ${reworkSR.toFixed(2)}★ (${srDiffSign}${srDiff.toFixed(2)})`;

    // Desglose de PP en Rework
    const aimPP = `\\u001b[1;30mWeighted Aim:\\u001b[0m     ${(values.aim_pp || 0).toFixed(2)}pp`;
    const tapPP = `\\u001b[1;30mWeighted Tap:\\u001b[0m     ${(values.tap_pp || 0).toFixed(2)}pp`;
    const accPP = `\\u001b[1;30mWeighted Acc:\\u001b[0m     ${(values.acc_pp || 0).toFixed(2)}pp`;
    const readPP = `\\u001b[1;30mWeighted Reading:\\u001b[0m ${(values.reading_pp || 0).toFixed(2)}pp`;
    const statsBlock = `\`\`\`ansi\n${aimPP}\n${tapPP}\n${accPP}\n${readPP}\n\`\`\``;

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Puntuación #${index} en el Rework para ${osuUser.username}`,
            url: user_url,
            iconURL: avatar_url
        })
        .setTitle(mapName)
        .setURL(mapUrl)
        .setColor(embedColor)
        .setDescription(`
**• Mods:** \`${modsStr || 'None'}\`
**• Dificultad:** \`${srDisplay}\`
**• Rework:** \`${rework.name}\` (\`${rework.code}\` / ID: ${rework.id})

**Comparación de PP:**
▸ **PP Live:** \`${livePP.toFixed(2)} pp\`
▸ **PP Rework:** \`${localPP.toFixed(2)} pp\`
▸ **Cambio:** \`${diffString}\`
▸ **Precisión:** \`${score.accuracy ? score.accuracy.toFixed(2) : '0.00'}%\`
▸ **Rango en Top:** \`#${oldRank}\` ➔ \`#${newRank}\`

**Desglose de PP ponderado en Rework:**
${statsBlock}
        `)
        .setFooter({
            text: `Sengo • PP Rework Top Play #${index} de ${total_plays}`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

module.exports = {
    doOsuEmbed,
    doOsuListEmbed,
    doOsuTopSingleEmbed,
    doOsuTopListEmbed,
    doOsuCompareSingleEmbed,
    doOsuCompareListEmbed,
    getOsuCompareContent,
    doOsuSubirEmbed,
    doOsuMapEmbed,
    doOsuSnipesEmbed,
    doOsuProfileEmbed,
    doOsuReworkMapEmbed,
    doOsuReworkUserEmbed,
    doOsuReworkListEmbed,
    doOsuReworkTopEmbed,
    doOsuReworkTopSingleEmbed
};

