const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUnrankedBeatmapUserAllScores, argsParser, getBeatmapUserAllScores, findBeatmapInChannel, getBeatmap, getOsuUser } = require("../../utils/osu.js");
const { colorear } = require("../../utils/admin.js");

async function doOsuSingleEmbed(message, score, pre_calculated, index, total_plays, parsed_args, beatmap_metadata) {
    const username = score.user?.username || parsed_args.username[0] || 'Usuario';
    const user_url = score.user?.server === 'gatari' ? `https://osu.gatari.pw/u/${score.user.id}` : `https://osu.ppy.sh/users/${score.user?.id || score.user_id}`;
    const avatar_url = score.user?.avatar_url || `https://a.ppy.sh/${score.user_id || score.user?.id}`;

    const song_title = beatmap_metadata.beatmapset.title;
    const beatmap_difficulty = beatmap_metadata.version;
    const beatmap_url = `https://osu.ppy.sh/b/${beatmap_metadata.id}`;
    const beatmap_cover = beatmap_metadata.beatmapset.covers["cover@2x"];

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

    const raw_score_val = (score.legacy_total_score && score.legacy_total_score > 0) ? score.legacy_total_score :
                          (score.classic_total_score && score.classic_total_score > 0) ? score.classic_total_score :
                          score.total_score || score.score || 0;
    const score_val = raw_score_val.toLocaleString('es-ES');
    
    const accuracy = (score.accuracy * 100).toFixed(2);
    const user_max_combo = score.max_combo;

    const beatmap_max_combo = pre_calculated.beatmap_max_combo;
    const user_pp = `${pre_calculated.pp.toFixed(2)}`;
    const difficulty = pre_calculated.maxAttrs.difficulty.stars.toFixed(2);

    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ffffff';

    const { perfect = 0, great = 0, good = 0, ok = 0, meh = 0, miss = 0 } = score.statistics;

    const emoji_mods = require("../../../src/emoji_mods.json");
    const emoji_grades = require("../../../src/emoji_grades.json");

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

    let compVal = pre_calculated.map_completion;
    if (compVal < 1.0) compVal = compVal * 100;
    const map_completion = score.passed ? `` : `(${compVal.toFixed(2)}%)`;

    let stats_str = "";
    let ratio_str = "";
    if (beatmap_metadata.mode === 'mania') {
        stats_str = `[${colorear(perfect, "cyan")}/${colorear(great, "amarillo")}/${colorear(good, "verde")}/${colorear(ok, "azul")}/${colorear(meh, "magenta")}/${colorear(miss, "rojo")}]`;
        const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
        ratio_str = ` ▸ ${ratio}:1`;
    } else if (beatmap_metadata.mode === 'taiko') {
        stats_str = `[${colorear(great, "azul")}/${colorear(ok, "verde")}/${colorear(miss, "rojo")}]`;
    } else {
        stats_str = `[${colorear(great, "azul")}/${colorear(ok, "verde")}/${colorear(meh, "amarillo")}/${colorear(miss, "rojo")}]`;
    }

    let active_filters = [];
    if (parsed_args.modFilter !== null) active_filters.push(`mods exactos: ${parsed_args.modFilter}`);
    if (parsed_args.modContainFilter !== null) active_filters.push(`contiene mods: ${parsed_args.modContainFilter}`);
    if (parsed_args.ppThreshold !== null) active_filters.push(`PP >= ${parsed_args.ppThreshold}`);

    let prefix_desc = '';
    if (active_filters.length > 0) {
        prefix_desc += `🔍 *Filtros activos: ${active_filters.join(" | ")}*\n\n`;
    }

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Comparación de score #${score.originalRank || index} para ${username}`,
            url: user_url,
            iconURL: `${avatar_url}`,
        })
        .setTitle(`${song_title} [${beatmap_difficulty}] - ${difficulty + '★'} `)
        .setURL(beatmap_url)
        .setDescription(`${prefix_desc}**Puntuación**: \`${score_val}\` **▸** ${grade_emoji} ${map_completion} **▸** ${mods_used}
\`\`\`ansi
${stats_str} ${colorear(user_pp + 'PP')}/${pre_calculated.maxAttrs.pp.toFixed(2)}PP ${accuracy}%${ratio_str} x${user_max_combo}/${colorear(beatmap_max_combo)}
\`\`\`
        `)
        .setImage(beatmap_cover)
        .setColor(embedColor)
        .setFooter({
            text: `SengoBot • Jugada #${index} de ${total_plays} comparadas`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp(new Date(score.ended_at));

    return embed;
}

async function doOsuListEmbed(message, parsed_args, user_scores_chunk, startIndex, total_plays, beatmap_metadata) {
    const emoji_mods = require("../../../src/emoji_mods.json");
    const emoji_grades = require("../../../src/emoji_grades.json");

    let embed_description = '';
    const username = user_scores_chunk[0]?.user?.username || parsed_args.username[0] || 'Usuario';

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

        let grade_emoji = emoji_grades[!score.passed ? "F" : score.rank];
        grade_emoji = grade_emoji ? (grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}:` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`) : '❓';

        let map_completion = "";
        if (score.map_completion !== undefined && !score.passed) {
            let compVal = score.map_completion;
            if (compVal < 1.0) compVal = compVal * 100;
            map_completion = `*(${compVal.toFixed(1)}% pass)*`;
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
        let statistics = score.statistics;

        const perfect = statistics.perfect || 0;
        const great = statistics.great || 0;
        const good = statistics.good || 0;
        const ok = statistics.ok || 0;
        const meh = statistics.meh || 0;
        const miss = statistics.miss || 0;

        let stats_str = "";
        let ratio_str = "";
        const gamemode = beatmap_metadata.mode || parsed_args.gamemode || 'osu';
        if (gamemode === 'mania') {
            stats_str = `\`[${perfect}/${great}/${good}/${ok}/${meh}/${miss}]\``;
            const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
            ratio_str = ` ▸ **${ratio}:1**`;
        } else if (gamemode === 'taiko') {
            stats_str = `\`[${great}/${ok}/${miss}]\``;
        } else {
            stats_str = `\`[${great}/${ok}/${meh}/${miss}]\``;
        }

        let pp = `${score.pp ? score.pp.toFixed(2) + "pp" : "0.00pp"}`;
        let time_set = `<t:${Math.floor((new Date(score.ended_at)).getTime() / 1000)}:R>`;

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
        const rank_pos = isFirst ? `**#${score.originalRank || globalIndex}**` : `#${score.originalRank || globalIndex}`;
        
        const formatted_score = isFirst ? `**${legacy_score}**` : `${legacy_score}`;
        const formatted_accuracy = isFirst ? `**${accuracy}%**` : `${accuracy}%`;
        const formatted_pp = isFirst ? `__**${pp}**__` : `__${pp}__`;
        const formatted_combo = isFirst ? `**x${max_combo}**` : `x${max_combo}`;

        const score_line = `${rank_pos} ▸ ${grade_emoji} ▸ ${formatted_score} ▸ ${formatted_accuracy}${ratio_str} ▸ ${formatted_pp} ▸ ${formatted_combo} ▸ +${mods_used} ${map_completion}\n ▸ ${time_set} ▸ ${stats_str}\n\n`;

        embed_description = embed_description.concat(score_line);
    }

    const user_url = user_scores_chunk[0]?.user?.server === 'gatari' ? `https://osu.gatari.pw/u/${user_scores_chunk[0]?.user.id}` : `https://osu.ppy.sh/users/${user_scores_chunk[0]?.user?.id || parsed_args.username[0]}`;
    const avatar_url = user_scores_chunk[0]?.user?.avatar_url || `https://a.ppy.sh/${parsed_args.username[0]}`;

    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ffffff';

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

async function doContent(parsed_args, user_found, beatmap_metadata, scores) {
    const { title } = beatmap_metadata.beatmapset;
    const { difficulty_rating, version, url } = beatmap_metadata;

    const username = scores[0]?.user?.username || (await getOsuUser(parsed_args)).username || 'Usuario';

    let mapa = `[${title} [${version}] - ${difficulty_rating + '★'} ](${url})`;
    const displayMode = parsed_args.gamemode === 'osu' ? 'std' : (parsed_args.gamemode === 'fruits' ? 'ctb' : parsed_args.gamemode);
    const content = `**Puntuaciones de \`${username}\` en \`osu!${displayMode}\`: \n${mapa}**`;

    return content;
}

async function run(messages, args) {
    const { message, res, reply, logger } = messages;

    let beatmap_url = null;
    let found_index = -1;
    let detected_gamemode = null;

    const extractId = str =>
        str?.match(/#(?:osu|taiko|fruits|mania)\/(\d+)/)?.[1] ||
        str?.match(/osu\.ppy\.sh\/b(?:eatmaps)?\/(\d+)/)?.[1] ||
        null;

    if (args && Array.isArray(args)) {
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (typeof arg === 'string') {
                const id = extractId(arg);
                if (id) {
                    beatmap_url = id;
                    found_index = i;
                    break;
                }
            }
        }
        if (found_index !== -1) {
            args.splice(found_index, 1);
        }
    }

    if (!beatmap_url) {
        if (logger) logger.process("Buscando beatmap reciente en el canal");
        const result = reply ? await findBeatmapInChannel(reply, true) : await findBeatmapInChannel(message, false);
        beatmap_url = result.beatmap_url;
        detected_gamemode = result.gamemode;
        if (!beatmap_url) return result.bad_response;
    }

    // Para revisar si es graveyard o no
    if (logger) logger.process("Obteniendo metadatos del beatmap");
    const beatmap_metadata = await getBeatmap(beatmap_url);
    const unranked_statuses = new Set(['pending', 'graveyard', 'wip']);

    // Si detectamos el modo de juego de la última play mostrada en el canal, lo priorizamos frente al nativo del beatmap
    const targetGamemode = detected_gamemode || beatmap_metadata.mode;

    if (logger) logger.process("Consultando puntuaciones en el beatmap");
    const { fn_response, parsed_args, user_found } = await argsParser(args,                  // Si es un mapa unranked lo mandamos a buscar los scores locales, sino los rankeados
        { 
            "message": message, 
            "res": res, 
            "beatmap_url": beatmap_url, 
            "gamemode": targetGamemode, 
            "ignore_main_gamemode": true,
            "command_function": unranked_statuses.has(beatmap_metadata.status) ? getUnrankedBeatmapUserAllScores : getBeatmapUserAllScores 
        });

    if (typeof fn_response === 'string') return fn_response;
    
    let scores = fn_response;
    const filterPass = parsed_args.filterPass;
    if (filterPass) {
        scores = scores.filter(score => score.passed);
        if (scores.length == 0) return `El usuario no tiene scores que no sean fallidas en el mapa.`;
    } else if (scores.length == 0) {
        return `El usuario no tiene scores en el mapa.`;
    }

    // Asignamos el índice original
    scores.forEach((score, idx) => {
        score.originalRank = idx + 1;
    });

    // APLICAR FILTROS SOLICITADOS
    let filtered_scores = scores;

    // 1. Filtrar por mods exactos (-m) o (+mods en args)
    let modsStr = parsed_args.modFilter || parsed_args.modContainFilter || "";
    if (!modsStr && args && Array.isArray(args)) {
        for (const arg of args) {
            if (arg && typeof arg === 'string' && arg.startsWith("+")) {
                modsStr = arg.slice(1).toUpperCase();
                parsed_args.modFilter = modsStr;
                break;
            }
        }
    }

    if (parsed_args.modFilter !== null) {
        const filterStr = parsed_args.modFilter;
        const hasExplicitCL = filterStr.includes("CL");

        filtered_scores = filtered_scores.filter(score => {
            const scoreAcronyms = score.mods.map(m => m.acronym);
            const filteredScoreAcronyms = hasExplicitCL ? scoreAcronyms : scoreAcronyms.filter(mod => mod !== 'CL');

            if (filterStr === "NM" || filterStr === "NONE") {
                return filteredScoreAcronyms.length === 0;
            }

            const getModChunks = (str) => {
                const chunks = [];
                for (let j = 0; j < str.length; j += 2) {
                    chunks.push(str.slice(j, j + 2));
                }
                return chunks.sort().join("").toUpperCase();
            };
            const filterNormalized = getModChunks(filterStr);
            const scoreNormalized = filteredScoreAcronyms.sort().join("").toUpperCase();
            return scoreNormalized === filterNormalized;
        });
    }

    // 2. Filtrar por mods contenidos (-mx)
    if (parsed_args.modContainFilter !== null) {
        const filterStr = parsed_args.modContainFilter;
        const hasExplicitCL = filterStr.includes("CL");

        const filterChunks = [];
        for (let j = 0; j < filterStr.length; j += 2) {
            filterChunks.push(filterStr.slice(j, j + 2));
        }

        filtered_scores = filtered_scores.filter(score => {
            const scoreAcronyms = score.mods.map(m => m.acronym);
            const filteredScoreAcronyms = hasExplicitCL ? scoreAcronyms : scoreAcronyms.filter(mod => mod !== 'CL');

            if (filterStr === "NM" || filterStr === "NONE") {
                return filteredScoreAcronyms.length === 0;
            }

            return filterChunks.every(mod => filteredScoreAcronyms.includes(mod));
        });
    }

    // 3. Filtrar por PP (-g o -pp)
    if (parsed_args.ppThreshold !== null) {
        const threshold = parsed_args.ppThreshold;
        filtered_scores = filtered_scores.filter(score => (score.pp || 0) >= threshold);
    }

    if (filtered_scores.length === 0) {
        const username = scores[0]?.user?.username || parsed_args.username[0] || 'Usuario';
        let errorMsg = `No se encontraron puntuaciones de **${username}** con los filtros aplicados:`;
        if (parsed_args.modFilter !== null) errorMsg += `\n ▸ Mods exactos: \`${parsed_args.modFilter}\``;
        if (parsed_args.modContainFilter !== null) errorMsg += `\n ▸ Contiene mods: \`${parsed_args.modContainFilter}\``;
        if (parsed_args.ppThreshold !== null) errorMsg += `\n ▸ PP >= \`${parsed_args.ppThreshold}\``;
        return errorMsg;
    }

    // Calcular PP para los scores filtrados si no tienen
    let needsPP = filtered_scores.some(s => !s.pp);
    if (needsPP || beatmap_metadata.status === 'loved') {
        if (logger) logger.process("Simulando PP en el beatmap");
        const { getBeatmap_osu, calculatePP } = require("../../utils/osu.js");
        let map;
        try {
            map = await getBeatmap_osu(beatmap_metadata.beatmapset_id, beatmap_metadata.id, beatmap_metadata);
            for (let score of filtered_scores) {
                if (!score.pp) {
                    try {
                        const ppResult = calculatePP(score, map);
                        score.pp = ppResult.pp;
                    } catch (e) {
                        score.pp = 0;
                    }
                }
            }
            map.free();
        } catch (e) {
            console.error("Error cargando beatmap para simulación de PP:", e);
        }
    }

    // ----------------------------------------------------
    // Modo 1: Single Play Display (-i <index>)
    // ----------------------------------------------------
    if (parsed_args.explicitIndex) {
        let index = parsed_args.index || 1;
        let content_msg = '';

        if (index > filtered_scores.length) {
            content_msg = `⚠️ Solo se encontraron **${filtered_scores.length}** puntuaciones con los filtros activos. Mostrando la última (#${filtered_scores.length}):`;
            index = filtered_scores.length;
        } else if (index < 1) {
            content_msg = `⚠️ Índice inválido. Mostrando la mejor (#1):`;
            index = 1;
        } else {
            content_msg = `Mostrando la puntuación **#${index}** de **${filtered_scores.length}** comparadas:`;
        }

        async function processScore(scoreIndex) {
            const score = filtered_scores[scoreIndex - 1];
            const { great = 0, ok = 0, meh = 0, miss = 0 } = score.statistics;
            const total_hits = great + ok + meh + miss;
            const { getBeatmap_osu, calculatePP } = require("../../utils/osu.js");
            let map = await getBeatmap_osu(beatmap_metadata.beatmapset_id, beatmap_metadata.id, beatmap_metadata);
            const maxAttrs = calculatePP(score, map, "maximo_pp");

            const pre_calculated = {
                "map": map,
                "map_completion": score.passed ? 1.0 : (map.nObjects > 0 ? total_hits / map.nObjects : score.map_completion || 0),
                "maxAttrs": maxAttrs,
                "pp": score.pp ? score.pp : calculatePP(score, map, null, maxAttrs).pp,
                "beatmap_max_combo": beatmap_metadata.max_combo,
            };

            const embed = await doOsuSingleEmbed(message, score, pre_calculated, scoreIndex, filtered_scores.length, parsed_args, beatmap_metadata);
            map.free();
            return embed;
        }

        const initialEmbed = await processScore(index);

        const getSingleButtonsRow = (curr, max) => {
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('c_single_first')
                    .setLabel('<<')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(curr <= 1),
                new ButtonBuilder()
                    .setCustomId('c_single_prev')
                    .setLabel('<')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(curr <= 1),
                new ButtonBuilder()
                    .setCustomId('c_single_next')
                    .setLabel('>')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(curr >= max),
                new ButtonBuilder()
                    .setCustomId('c_single_last')
                    .setLabel('>>')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(curr >= max)
            );
        };

        const sent_message = await message.channel.send({
            content: content_msg,
            embeds: [initialEmbed],
            components: [getSingleButtonsRow(index, filtered_scores.length)]
        });

        const filter = btnInt => btnInt.user.id === message.author.id;
        const collector = sent_message.createMessageComponentCollector({
            filter,
            idle: 30000
        });

        collector.on('collect', async i => {
            try {
                await i.deferUpdate();

                if (i.customId === 'c_single_first') {
                    index = 1;
                } else if (i.customId === 'c_single_prev') {
                    index = Math.max(1, index - 1);
                } else if (i.customId === 'c_single_next') {
                    index = Math.min(filtered_scores.length, index + 1);
                } else if (i.customId === 'c_single_last') {
                    index = filtered_scores.length;
                }

                content_msg = `Mostrando la puntuación **#${index}** de **${filtered_scores.length}** comparadas:`;
                const embed = await processScore(index);

                await i.editReply({
                    content: content_msg,
                    embeds: [embed],
                    components: [getSingleButtonsRow(index, filtered_scores.length)]
                });
            } catch (err) {
                console.error("Error al navegar single compare score:", err);
            }
        });

        collector.on('end', async () => {
            try {
                await sent_message.edit({ components: [] });
            } catch (e) {}
        });

        return;
    }

    // ----------------------------------------------------
    // Modo 2: List Mode Display (Paginación de 10 scores por página)
    // ----------------------------------------------------
    let page = parsed_args.page || 1;
    const max_pages = Math.ceil(filtered_scores.length / 10);
    if (page > max_pages) page = max_pages;
    if (page < 1) page = 1;

    let startIndex = (page - 1) * 10;

    const initialListEmbed = await doOsuListEmbed(message, parsed_args, filtered_scores.slice(startIndex, startIndex + 10), startIndex, filtered_scores.length, beatmap_metadata);
    const content = await doContent(parsed_args, user_found, beatmap_metadata, scores);

    const getListButtonsRow = (start, total) => {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('c_first')
                .setLabel('<<')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start <= 0),
            new ButtonBuilder()
                .setCustomId('c_prev')
                .setLabel('<')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start <= 0),
            new ButtonBuilder()
                .setCustomId('c_next')
                .setLabel('>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start + 10 >= total),
            new ButtonBuilder()
                .setCustomId('c_last')
                .setLabel('>>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start + 10 >= total)
        );
    };

    const sent_message = await message.channel.send({
        content: content,
        embeds: [initialListEmbed],
        components: [getListButtonsRow(startIndex, filtered_scores.length)]
    });

    const filter = btnInt => btnInt.user.id === message.author.id;
    const collector = sent_message.createMessageComponentCollector({
        filter,
        idle: 30000
    });

    collector.on('collect', async i => {
        try {
            await i.deferUpdate();

            if (i.customId === 'c_first') {
                startIndex = 0;
            } else if (i.customId === 'c_prev') {
                startIndex = Math.max(0, startIndex - 10);
            } else if (i.customId === 'c_next') {
                startIndex = startIndex + 10;
            } else if (i.customId === 'c_last') {
                startIndex = Math.floor((filtered_scores.length - 1) / 10) * 10;
            }

            const chunk = filtered_scores.slice(startIndex, startIndex + 10);
            const embed = await doOsuListEmbed(message, parsed_args, chunk, startIndex, filtered_scores.length, beatmap_metadata);

            await i.editReply({
                embeds: [embed],
                components: [getListButtonsRow(startIndex, filtered_scores.length)]
            });
        } catch (err) {
            console.error("Error al navegar la lista de comparación:", err);
        }
    });

    collector.on('end', async () => {
        try {
            await sent_message.edit({ components: [] });
        } catch (e) {}
    });

    return;
}

run.alias = {
    "comparar": {
        "args": ""
    },
    "compara": {
        "args": ""
    },
    "compare": {
        "args": ""
    },
    "cm": {
        "args": "-mania"
    },
    "cc": {
        "args": "-ctb"
    },
    "ct": {
        "args": "-taiko"
    }
}

run.description = {
    'header': "El >c de toda la vida",
    'body': 'Compara una score en el ultimo mapa que consigue el Sengo. La score puede ser del usuario del comando u otro jugador',
    'usage': `s.c : Compara la score del usuario linkeado al bot \ns.c 'usuario' : Compara la score del usuario en el argumento. \ns.c -p 2 : Muestra la página 2 de la lista de puntuaciones. \ns.c -m HD : Filtra por mods exactos. \ns.c -g 200 : Filtra por jugadas de 200 pp o más. \ns.c -i 1 : Muestra un embed detallado de la mejor score (similar a .rs).`
}

module.exports = { run, "description": run.description }