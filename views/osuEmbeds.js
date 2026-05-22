const { EmbedBuilder } = require("discord.js");
const { colorear } = require("../commands/utils/admin.js");
const emoji_mods = require("../src/emoji_mods.json");
const emoji_grades = require("../src/emoji_grades.json");

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

    // Asegurar que si no es en lazer (!isLazer), se le agregue el mod CL si no lo tiene
    const isLazer = recent_scores.build_id !== null && recent_scores.build_id !== undefined;
    if (!isLazer && recent_scores.mods) {
        const hasCL = recent_scores.mods.some(m => (m.acronym || m) === 'CL');
        if (!hasCL) {
            const isObjectMod = recent_scores.mods.length > 0 && typeof recent_scores.mods[0] === 'object';
            if (isObjectMod) {
                recent_scores.mods.push({ acronym: 'CL' });
            } else {
                recent_scores.mods.push('CL');
            }
        }
    }

    const raw_score = (recent_scores.legacy_total_score && recent_scores.legacy_total_score > 0) ? recent_scores.legacy_total_score :
                      (recent_scores.classic_total_score && recent_scores.classic_total_score > 0) ? recent_scores.classic_total_score :
                      recent_scores.total_score || recent_scores.score || 0;
    const score = raw_score.toLocaleString('es-ES');
    
    const accuracy = (recent_scores.accuracy * 100).toFixed(2);
    const user_max_combo = recent_scores.max_combo;

    const beatmap_max_combo = pre_calculated.beatmap_max_combo;

    const user_pp = `${pre_calculated.pp.toFixed(2)}`

    const difficulty = pre_calculated.maxAttrs.difficulty.stars.toFixed(2);

    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ffffff';

    const stats = recent_scores.statistics || {};
    const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
    const ok = stats.ok !== undefined ? stats.ok : (stats.count_100 || 0);
    const meh = stats.meh !== undefined ? stats.meh : (stats.count_50 || 0);
    const miss = stats.miss !== undefined ? stats.miss : (stats.count_miss || 0);
    const perfect = stats.perfect !== undefined ? stats.perfect : (stats.count_geki || 0);
    const good = stats.good !== undefined ? stats.good : (stats.count_katu || 0);

    let grade_emoji = emoji_grades[!recent_scores.passed ? "F" : recent_scores.rank];
    grade_emoji = grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}:` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`;

    const mods_used = recent_scores.mods.length > 0 ? recent_scores.mods.reduce((acc, mod) => {
        let settings_str = '';
        if (mod.settings) {
            if (mod.acronym === 'DT' || mod.acronym === 'NC' || mod.acronym === 'HT') {
                if (mod.settings.speed_change) settings_str = `(${mod.settings.speed_change}x)`;
            } else if (mod.acronym === 'DA') {
                let da_changes = [];
                if (mod.settings.circle_size !== undefined) da_changes.push(`CS${mod.settings.circle_size}`);
                if (mod.settings.approach_rate !== undefined) da_changes.push(`AR${mod.settings.approach_rate}`);
                if (mod.settings.overall_difficulty !== undefined) da_changes.push(`OD${mod.settings.overall_difficulty}`);
                if (mod.settings.drain_rate !== undefined) da_changes.push(`HP${mod.settings.drain_rate}`);
                if (da_changes.length > 0) settings_str = `(${da_changes.join(' ')})`;
            }
        }
        const modAcronym = mod.acronym || mod;
        return `${acc}<:${modAcronym}:${emoji_mods[modAcronym] || '123'}>${settings_str}`;
    }, '') : `<:NM:${emoji_mods["NM"]}>`;

    const map_completion = recent_scores.passed ? `` : `(${((pre_calculated.map_completion)*100).toFixed(2)}%)`;

    let stats_str = "";
    let ratio_str = "";
    if (recent_scores.beatmap.mode === 'mania') {
        stats_str = `[${colorear(perfect, "cyan")}/${colorear(great, "amarillo")}/${colorear(good, "verde")}/${colorear(ok, "azul")}/${colorear(meh, "magenta")}/${colorear(miss, "rojo")}]`;
        const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
        ratio_str = ` ▸ ${ratio}:1`;
    } else if (recent_scores.beatmap.mode === 'taiko') {
        stats_str = `[${colorear(great, "azul")}/${colorear(ok, "verde")}/${colorear(miss, "rojo")}]`;
    } else {
        stats_str = `[${colorear(great, "azul")}/${colorear(ok, "verde")}/${colorear(meh, "amarillo")}/${colorear(miss, "rojo")}]`;
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

    let footerText = "SengoBot";
    if (recent_scores.beatmap.mode === 'mania') {
        const ratioVal = great > 0 ? (perfect / great) : null;
        if (ratioVal !== null && ratioVal < 10) {
            footerText = "ratio de virgo";
        }
    }

    // Construccion del embed
    let pp_fc_str = "";
    if (pre_calculated.pp_fc) {
        pp_fc_str = ` ${colorear("if(" + pre_calculated.pp_fc.toFixed(2) + "PP)", "amarillo")}`;
    }

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Puntuación Reciente de ${username} en ${recent_scores.beatmap.mode}!`,
            url: user_url,
            iconURL: `${avatar_url}`,
        })
        .setTitle(`${song_title} [${beatmap_difficulty}] - ${difficulty + '★'} `)
        .setURL(beatmap_url)
        .setDescription(`**Puntuación**: \`${score}\` **▸** ${grade_emoji} ${map_completion} **▸** ${mods_used}${leaderboard_pos ? ` **▸** 🌐 \`#${leaderboard_pos}\`` : ''}${user_top_pos ? ` **▸** 🏆 \`#${user_top_pos}\`` : ''}
\`\`\`ansi
${stats_str} ${colorear(user_pp + 'PP')}/${pre_calculated.maxAttrs.pp.toFixed(2)}PP${pp_fc_str} ${accuracy}%${ratio_str} x${user_max_combo}/${colorear(beatmap_max_combo)}
\`\`\`
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
        const globalIndex = startIndex + i + 1; // 1-indexed for display

        let grade_emoji = emoji_grades[!score.passed ? "F" : score.rank];
        grade_emoji = grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}:` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`;

        const stats = score.statistics || {};
        const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
        const ok = stats.ok !== undefined ? stats.ok : (stats.count_100 || 0);
        const meh = stats.meh !== undefined ? stats.meh : (stats.count_50 || 0);
        const miss = stats.miss !== undefined ? stats.miss : (stats.count_miss || 0);
        const perfect = stats.perfect !== undefined ? stats.perfect : (stats.count_geki || 0);
        const good = stats.good !== undefined ? stats.good : (stats.count_katu || 0);

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
                map_completion = `*(${((score.statistics.great + score.statistics.ok + score.statistics.meh + score.statistics.miss) / total_objects * 100).toFixed(1)}% pass)*`;
            }
        }
        
        // Asegurar que si no es en lazer (!isLazer), se le agregue el mod CL si no lo tiene
        const isLazer = score.build_id !== null && score.build_id !== undefined;
        if (!isLazer && score.mods) {
            const hasCL = score.mods.some(m => (m.acronym || m) === 'CL');
            if (!hasCL) {
                const isObjectMod = score.mods.length > 0 && typeof score.mods[0] === 'object';
                if (isObjectMod) {
                    score.mods.push({ acronym: 'CL' });
                } else {
                    score.mods.push('CL');
                }
            }
        }

        let raw_legacy_score = (score.legacy_total_score && score.legacy_total_score > 0) ? score.legacy_total_score :
                               (score.classic_total_score && score.classic_total_score > 0) ? score.classic_total_score :
                               score.total_score || score.score || 0;
        let legacy_score = raw_legacy_score.toLocaleString('es-ES');
        let accuracy = (score.accuracy * 100).toFixed(2);
        let max_combo = score.max_combo;

        let stats_str = "";
        let ratio_str = "";
        const gamemode = score.beatmap.mode || parsed_args.gamemode || 'osu';
        if (gamemode === 'mania') {
            stats_str = `\`[${perfect}/${great}/${good}/${ok}/${meh}/${miss}]\``;
            const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
            ratio_str = ` ▸ **${ratio}:1**`;
        } else if (gamemode === 'taiko') {
            stats_str = `\`[${great}/${ok}/${miss}]\``;
        } else {
            stats_str = `\`[${great}/${ok}/${meh}/${miss}]\``;
        }

        let ppVal = score.calculatedPP !== undefined ? score.calculatedPP : score.pp;
        let pp = `${ppVal ? ppVal.toFixed(2) + "pp" : "⏳ pp"}`;
        
        let starsVal = score.calculatedStars !== undefined ? score.calculatedStars : score.beatmap.difficulty_rating;
        const stars = starsVal ? `${starsVal.toFixed(2)}★` : "";
        
        let time_set = `<t:${Math.floor((new Date(score.ended_at || score.created_at)).getTime() / 1000)}:R>`;

        const mods_used = score.mods.length > 0 ? score.mods.reduce((acc, mod) => {
            let settings_str = '';
            if (mod.settings) {
                if (mod.acronym === 'DT' || mod.acronym === 'NC' || mod.acronym === 'HT') {
                    if (mod.settings.speed_change) settings_str = `(${mod.settings.speed_change}x)`;
                } else if (mod.acronym === 'DA') {
                    let da_changes = [];
                    if (mod.settings.circle_size !== undefined) da_changes.push(`CS${mod.settings.circle_size}`);
                    if (mod.settings.approach_rate !== undefined) da_changes.push(`AR${mod.settings.approach_rate}`);
                    if (mod.settings.overall_difficulty !== undefined) da_changes.push(`OD${mod.settings.overall_difficulty}`);
                    if (mod.settings.drain_rate !== undefined) da_changes.push(`HP${mod.settings.drain_rate}`);
                    if (da_changes.length > 0) settings_str = `(${da_changes.join(' ')})`;
                }
            }
            const modAcronym = mod.acronym || mod;
            return `${acc}<:${modAcronym}:${emoji_mods[modAcronym] || '123'}>${settings_str}`;
        }, '') : `<:NM:${emoji_mods["NM"]}>`;

        const map_link = `[${score.beatmapset.title} [${score.beatmap.version}]](https://osu.ppy.sh/b/${score.beatmap.id})`;

        const score_line = `**#${globalIndex}** ▸ ${map_link} +${mods_used} [${stars}]\n` +
            ` ▸ ${grade_emoji} ▸ **${pp}** ▸ **${accuracy}%**${ratio_str} ▸ x${max_combo} ▸ ${stats_str} ▸ ${time_set} ${map_completion != "" ? `▸ ${map_completion}` : ""}\n\n`;

        embed_description = embed_description.concat(score_line);
    }

    const username = recent_scores_chunk[0].user.username;
    const user_url = recent_scores_chunk[0].user.server === 'gatari' ? `https://osu.gatari.pw/u/${recent_scores_chunk[0].user.id}` : `https://osu.ppy.sh/users/${recent_scores_chunk[0].user.id}`;
    const avatar_url = recent_scores_chunk[0].user.avatar_url;

    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ffffff';

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

module.exports = {
    doOsuEmbed,
    doOsuListEmbed
};
