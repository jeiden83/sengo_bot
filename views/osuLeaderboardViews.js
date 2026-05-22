const { EmbedBuilder } = require("discord.js");
const emoji_mods = require("../src/emoji_mods.json");
const emoji_grades = require("../src/emoji_grades.json");

/**
 * Convierte el código de país a un emoji real usando Unicode.
 * @param {string} countryCode Código de país (ej. "US", "CL")
 * @returns {string} Emoji de la bandera o bandera por defecto
 */
const getFlagEmoji = (countryCode) => {
    if (!countryCode || typeof countryCode !== 'string') return "🏴";
    return countryCode
        .toUpperCase()
        .replace(/./g, char => String.fromCodePoint(0x1F1E6 - 65 + char.charCodeAt()));
};

/**
 * Renderiza el embed para el comando gap (usuarios vinculados en el beatmap)
 */
function doOsuGapEmbed(message, user_scores, beatmap_metadata, startIndex = 0, total_plays = 0) {
    let embed_description = '';
    let position = startIndex + 1;

    user_scores.forEach(score => {
        const flag = getFlagEmoji((score.user && score.user.country_code) ? score.user.country_code : "XX");
        const username = score.user ? score.user.username : score.username;
        const username_link = `[${username}](https://osu.ppy.sh/users/${score.user_id})`;

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

        const raw_total_score = (score.legacy_total_score && score.legacy_total_score > 0) ? score.legacy_total_score :
                              (score.classic_total_score && score.classic_total_score > 0) ? score.classic_total_score :
                              score.total_score || score.score || 0;
        const total_score = raw_total_score.toLocaleString('es-ES');
        let accuracy = (score.accuracy * 100).toFixed(2);
    
        const max_combo = score.max_combo;
        const beatmap_max_combo = beatmap_metadata.max_combo;
 
        const stats = score.statistics || {};
        const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
        const ok = stats.ok !== undefined ? stats.ok : (stats.count_100 || 0);
        const meh = stats.meh !== undefined ? stats.meh : (stats.count_50 || 0);
        const miss = stats.miss !== undefined ? stats.miss : (stats.count_miss || 0);
        const perfect = stats.perfect !== undefined ? stats.perfect : (stats.count_geki || 0);
        const good = stats.good !== undefined ? stats.good : (stats.count_katu || 0);
        let statistics = "";
        let ratio_str = "";
        if (beatmap_metadata.mode === 'mania') {
            statistics = `\`[${perfect}/${great}/${good}/${ok}/${meh}/${miss}]\``;
            const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
            ratio_str = ` - ${ratio}:1`;
        } else if (beatmap_metadata.mode === 'taiko') {
            statistics = `\`[${great}/${ok}/${miss}]\``;
        } else {
            statistics = `\`[${great}/${ok}/${meh}/${miss}]\``;
        }
        accuracy = `${accuracy}%${ratio_str}`;
    
        const pp = `${score.pp ? score.pp.toFixed(2) : 0}`;
        const time_set = `<t:${Math.floor((new Date(score.ended_at || score.created_at)).getTime() / 1000)}:R>`;
    
        let grade_emoji = emoji_grades[!score.passed ? "F" : score.rank];
        grade_emoji = grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}: (${(score.map_completion*100).toFixed(2)}%)` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`;
 
        const mods_used = score.mods ? score.mods.reduce((acc, mod) => {
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
        }, '') : '';

        const isFirstGlobal = position === 1;
        embed_description = embed_description.concat(isFirstGlobal ?
            `#**${position++}** - ${flag} **${username_link}** - ${time_set} - ${grade_emoji}
            **${total_score}** - **${accuracy}** - **x${max_combo}/${beatmap_max_combo}** - ${statistics} - **${pp}PP** - ${mods_used}\n\n`
            :
            `#${position++} - ${flag} ${username_link} - ${time_set} - ${grade_emoji}
            ${total_score} - ${accuracy} - x${max_combo}/${beatmap_max_combo} - ${statistics} - ${pp}PP - ${mods_used}\n\n`
        );
    });
    
    const embed = new EmbedBuilder()
        .setDescription(embed_description)
        .setFooter({
            text: `SengoBot • Mostrando posiciones ${startIndex + 1}-${startIndex + user_scores.length} de ${total_plays}`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

/**
 * Genera el string de contenido de encabezado para el comando gap
 */
function doOsuGapContent(beatmap_metadata, user_scores, sorted_user_scores, page = 1, max_pages = 1) {
    const { title } = beatmap_metadata.beatmapset;
    const { difficulty_rating, version, url} = beatmap_metadata;

    const mapa = `[${title} [${version}] - ${difficulty_rating + '★'} ](${url})`;
    let content = `**De \`${user_scores.length}\` usuarios, \`${sorted_user_scores.length}\` tienen una score en: \n${mapa}**`;

    if (sorted_user_scores.length > 5) {
        content = content.concat(`\n**Página \`${page}/${max_pages}\`**`);
    }

    return content;
}

/**
 * Renderiza el embed para el comando lb (tabla de clasificación de beatmap)
 */
function doOsuLbEmbed(message, scores_chunk, beatmap_metadata, startIndex = 0, total_plays = 0, page = 1, max_pages = 1, parsed_args = {}, usedSupporter = null) {
    let embed_description = '';

    const isFiltered = (parsed_args.modFilter !== null && parsed_args.modFilter !== undefined) || 
                       (parsed_args.modContainFilter !== null && parsed_args.modContainFilter !== undefined) ||
                       (parsed_args.friendsFilter !== null && parsed_args.friendsFilter !== undefined) ||
                       (parsed_args.country !== null && parsed_args.country !== undefined) ||
                       (usedSupporter && usedSupporter.fallback === false);

    scores_chunk.forEach((score, i) => {
        const globalIndex = startIndex + i + 1;
        const flag = getFlagEmoji(score.user ? score.user.country_code : "");
        const username = score.user ? score.user.username : 'Usuario';
        const userId = score.user ? score.user.id : score.user_id;
        const userUrl = `https://osu.ppy.sh/users/${userId}`;
        const userLink = `[${username}](${userUrl})`;

        // Asegurar que si no es en lazer (!isLazer), se le agregue el mod CL si no lo tiene
        const isLazer = score.build_id !== null && score.build_id !== undefined;
        if (!isLazer) {
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

        const raw_legacy_score = (score.legacy_total_score && score.legacy_total_score > 0) ? score.legacy_total_score :
                                 (score.classic_total_score && score.classic_total_score > 0) ? score.classic_total_score :
                                 score.total_score || score.score || 0;
        const legacy_score = raw_legacy_score.toLocaleString('es-ES');
        const accuracy = (score.accuracy * 100).toFixed(2);
        const max_combo = score.max_combo;
        const beatmap_max_combo = beatmap_metadata.max_combo;

        const stats = score.statistics || {};
        const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
        const ok = stats.ok !== undefined ? stats.ok : (stats.count_100 || 0);
        const meh = stats.meh !== undefined ? stats.meh : (stats.count_50 || 0);
        const miss = stats.miss !== undefined ? stats.miss : (stats.count_miss || 0);
        const perfect = stats.perfect !== undefined ? stats.perfect : (stats.count_geki || 0);
        const good = stats.good !== undefined ? stats.good : (stats.count_katu || 0);

        let stats_str = "";
        let ratio_str = "";
        if (beatmap_metadata.mode === 'mania') {
            stats_str = `[${perfect}/${great}/${good}/${ok}/${meh}/${miss}]`;
            const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
            ratio_str = ` ▸ **${ratio}:1**`;
        } else if (beatmap_metadata.mode === 'taiko') {
            stats_str = `[${great}/${ok}/${miss}]`;
        } else {
            stats_str = `[${great}/${ok}/${meh}/${miss}]`;
        }

        const pp = score.pp ? score.pp.toFixed(2) : "0.00";
        const time_set = `<t:${Math.floor((new Date(score.ended_at || score.created_at)).getTime() / 1000)}:R>`;

        let grade_emoji = emoji_grades[!score.passed ? "F" : score.rank];
        grade_emoji = grade_emoji ? (grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}:` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`) : '❓';

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

        const isFirst = globalIndex === 1;
        const rank_pos = isFirst ? `**#${globalIndex}**` : `#${globalIndex}`;
        const global_rank = isFiltered ? ` (🌐 #${score.leaderboardRank})` : "";

        const formatted_score = isFirst ? `**${legacy_score}**` : `${legacy_score}`;
        const formatted_accuracy = isFirst ? `**${accuracy}%**` : `${accuracy}%`;
        const formatted_pp = isFirst ? `__**${pp}pp**__` : `__${pp}pp__`;
        const formatted_combo = isFirst ? `**x${max_combo}**` : `x${max_combo}`;

        const score_line = `${rank_pos}${global_rank} ▸ ${flag} ${userLink} ▸ ${formatted_score} ▸ ${formatted_accuracy}${ratio_str} ▸ ${formatted_pp} ▸ ${formatted_combo}/${beatmap_max_combo} ▸ +${mods_used}\n ▸ ${time_set} ▸ ${stats_str}\n\n`;

        embed_description = embed_description.concat(score_line);
    });

    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ffffff';

    const beatmap_cover = beatmap_metadata.beatmapset.covers["list@2x"] || beatmap_metadata.beatmapset.covers.cover;

    let footerText = `SengoBot • Mostrando posiciones ${startIndex + 1}-${startIndex + scores_chunk.length} de ${total_plays} (Página ${page}/${max_pages})`;
    if (usedSupporter) {
        footerText += ` • Pool: ${usedSupporter.username}${usedSupporter.fallback ? ' (global)' : ''}`;
    }

    const embed = new EmbedBuilder()
        .setDescription(embed_description)
        .setColor(embedColor)
        .setThumbnail(beatmap_cover)
        .setFooter({
            text: footerText,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

/**
 * Genera el string de contenido de encabezado para el comando lb
 */
function doOsuLbContent(beatmap_metadata, targetGamemode, countryCode = null, friendsUsername = null) {
    const { title } = beatmap_metadata.beatmapset;
    const { difficulty_rating, version, url } = beatmap_metadata;
    const displayMode = targetGamemode === 'osu' ? 'std' : (targetGamemode === 'fruits' ? 'ctb' : targetGamemode);

    const mapa = `[${title} [${version}] - ${difficulty_rating + '★'} ](${url})`;
    let titleText = `**Tabla de clasificación (leaderboard) en osu!${displayMode} para:**`;
    if (countryCode) {
        titleText = `**Tabla de clasificación nacional (${countryCode.toUpperCase()}) en osu!${displayMode} para:**`;
    } else if (friendsUsername) {
        titleText = `**Tabla de clasificación de amigos de ${friendsUsername} en osu!${displayMode} para:**`;
    }
    return `${titleText}\n${mapa}`;
}

module.exports = {
    doOsuGapEmbed,
    doOsuGapContent,
    doOsuLbEmbed,
    doOsuLbContent
};
