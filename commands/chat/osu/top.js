const { getBeatmap_osu, getUserTopScores, argsParser, getBeatmap, calculatePP } = require("../../utils/osu.js");
const { colorear } = require("../../utils/admin.js");
const { EmbedBuilder } = require("discord.js");

async function doOsuSingleEmbed(message, score, pre_calculated, index, total_plays, parsed_args, ppThresholdCount) {
    const username = score.user.username;
    const user_url = score.user.server === 'gatari' ? `https://osu.gatari.pw/u/${score.user.id}` : `https://osu.ppy.sh/users/${score.user.id}`;
    const avatar_url = score.user.avatar_url;

    const song_title = score.beatmapset.title;

    const beatmap_difficulty = score.beatmap.version;
    const beatmap_url = `https://osu.ppy.sh/b/${score.beatmap.id}`;
    const beatmap_cover = score.beatmapset.covers["cover@2x"];

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
    grade_emoji = grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}:` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`;

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

    const map_completion = score.passed ? `` : `(${((pre_calculated.map_completion)*100).toFixed(2)}%)`;

    let stats_str = "";
    let ratio_str = "";
    if (score.beatmap.mode === 'mania') {
        stats_str = `[${colorear(perfect, "cyan")}/${colorear(great, "amarillo")}/${colorear(good, "verde")}/${colorear(ok, "azul")}/${colorear(meh, "magenta")}/${colorear(miss, "rojo")}]`;
        const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
        ratio_str = ` ▸ ${ratio}:1`;
    } else if (score.beatmap.mode === 'taiko') {
        stats_str = `[${colorear(great, "azul")}/${colorear(ok, "verde")}/${colorear(miss, "rojo")}]`;
    } else {
        stats_str = `[${colorear(great, "azul")}/${colorear(ok, "verde")}/${colorear(meh, "amarillo")}/${colorear(miss, "rojo")}]`;
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

    let pp_fc_str = "";
    if (pre_calculated.pp_fc) {
        pp_fc_str = ` ${colorear("if(" + pre_calculated.pp_fc.toFixed(2) + "PP)", "amarillo")}`;
    }

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Puntuación #${score.originalRank || index} en el Top de PP de ${username}`,
            url: user_url,
            iconURL: `${avatar_url}`,
        })
        .setTitle(`${song_title} [${beatmap_difficulty}] - ${difficulty + '★'} `)
        .setURL(beatmap_url)
        .setDescription(`${prefix_desc}**Puntuación**: \`${score_val}\` **▸** ${grade_emoji} ${map_completion} **▸** ${mods_used}
\`\`\`ansi
${stats_str} ${colorear(user_pp + 'PP')}/${pre_calculated.maxAttrs.pp.toFixed(2)}PP${pp_fc_str} ${accuracy}%${ratio_str} x${user_max_combo}/${colorear(beatmap_max_combo)}
\`\`\`
        `)
        .setImage(beatmap_cover)
        .setColor(embedColor)
        .setFooter({
            text: `SengoBot • Jugada #${index} de ${total_plays} del Top de PP`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

async function doOsuListEmbed(message, parsed_args, top_scores_chunk, startIndex, total_plays, ppThresholdCount) {
    const emoji_mods = require("../../../src/emoji_mods.json");
    const emoji_grades = require("../../../src/emoji_grades.json");

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

    // Calcular en paralelo las estrellas reales de los 5 scores de la página
    const calculated_stars = await Promise.all(top_scores_chunk.map(async (score) => {
        if (score.mods.length === 0) {
            return score.beatmap.difficulty_rating;
        }
        try {
            const beatmap = await getBeatmap(score.beatmap.id);
            const map = await getBeatmap_osu(score.beatmap.beatmapset_id, score.beatmap.id, beatmap);
            const maxAttrs = calculatePP(score, map, "maximo_pp");
            const stars = maxAttrs.difficulty.stars;
            map.free();
            return stars;
        } catch (e) {
            return score.beatmap.difficulty_rating;
        }
    }));

    for (let i = 0; i < top_scores_chunk.length; i++) {
        const score = top_scores_chunk[i];
        const globalIndex = startIndex + i + 1; // 1-indexed for display

        let grade_emoji = emoji_grades[!score.passed ? "F" : score.rank];
        grade_emoji = grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}:` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`;

        const { perfect = 0, great = 0, good = 0, ok = 0, meh = 0, miss = 0 } = score.statistics;

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

        let pp = `${score.pp ? score.pp.toFixed(2) + "pp" : "0.00pp"}`;
        
        let starsVal = calculated_stars[i];
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

        const score_line = `**#${score.originalRank || globalIndex}** ▸ ${map_link} +${mods_used} [${stars}]\n` +
            ` ▸ ${grade_emoji} ▸ **${pp}** ▸ **${accuracy}%**${ratio_str} ▸ x${max_combo} ▸ ${stats_str}\n ▸ ${time_set}\n\n`;

        embed_description = embed_description.concat(score_line);
    }

    const user_url = top_scores_chunk[0].user.server === 'gatari' ? `https://osu.gatari.pw/u/${top_scores_chunk[0].user.id}` : `https://osu.ppy.sh/users/${top_scores_chunk[0].user.id}`;
    const avatar_url = top_scores_chunk[0].user.avatar_url;

    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ffffff';

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

async function run(messages, args) {
    const { message, res } = messages;

    // Parseamos args
    const parser_res = await argsParser(args, {
        "message": message,
        "res": res,
        "command_function": getUserTopScores
    });

    if (typeof parser_res.fn_response === 'string') return parser_res.fn_response;
    if (!Array.isArray(parser_res.fn_response) || parser_res.fn_response.length === 0) {
        return `Pero si no tienes puntuaciones registradas`;
    }
    // Asignar el top PP original a cada score (1-indexed)
    parser_res.fn_response.forEach((score, idx) => {
        score.originalRank = idx + 1;
    });

    // APLICAR FILTROS SOLICITADOS
    let filtered_scores = parser_res.fn_response;

    // 1. Filtrar por mods exactos (-m)
    if (parser_res.parsed_args.modFilter !== null) {
        const filterStr = parser_res.parsed_args.modFilter;
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
    if (parser_res.parsed_args.modContainFilter !== null) {
        const filterStr = parser_res.parsed_args.modContainFilter;
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

    // 3. Filtrar por nombre de mapa, artista o dificultad (-?)
    if (parser_res.parsed_args.searchFilter !== null) {
        const query = parser_res.parsed_args.searchFilter;
        filtered_scores = filtered_scores.filter(score => {
            const title = (score.beatmapset.title || "").toLowerCase();
            const artist = (score.beatmapset.artist || "").toLowerCase();
            const version = (score.beatmap.version || "").toLowerCase();
            return title.includes(query) || artist.includes(query) || version.includes(query);
        });
    }

    // 4. Filtrar por PP y contar (-g)
    let ppThresholdCount = 0;
    if (parser_res.parsed_args.ppThreshold !== null) {
        const threshold = parser_res.parsed_args.ppThreshold;
        // Filtramos para mostrar solo esas jugadas
        filtered_scores = filtered_scores.filter(score => (score.pp || 0) >= threshold);
        ppThresholdCount = filtered_scores.length;
    }

    // 5. Ordenar por fecha/reciente (-r) si se solicita
    if (parser_res.parsed_args.recentSort) {
        filtered_scores.sort((a, b) => new Date(b.ended_at || b.created_at) - new Date(a.ended_at || a.created_at));
    }

    // 6. Ordenar por combo (-c) si se solicita
    if (parser_res.parsed_args.comboSort) {
        filtered_scores.sort((a, b) => (b.max_combo || 0) - (a.max_combo || 0));
    }

    // 7. Ordenar por precisión (-acc) si se solicita
    if (parser_res.parsed_args.accSort) {
        filtered_scores.sort((a, b) => (b.accuracy || 0) - (a.accuracy || 0));
    }

    // Si no quedan jugadas tras aplicar los filtros
    if (filtered_scores.length === 0) {
        const username = parser_res.fn_response[0].user.username;
        let errorMsg = `No se encontraron jugadas en el top de **${username}** con los filtros aplicados:`;
        if (parser_res.parsed_args.modFilter !== null) errorMsg += `\n ▸ Mods exactos: \`${parser_res.parsed_args.modFilter}\``;
        if (parser_res.parsed_args.modContainFilter !== null) errorMsg += `\n ▸ Contiene mods: \`${parser_res.parsed_args.modContainFilter}\``;
        if (parser_res.parsed_args.searchFilter !== null) errorMsg += `\n ▸ Búsqueda: \`${parser_res.parsed_args.searchFilter}\``;
        if (parser_res.parsed_args.ppThreshold !== null) errorMsg += `\n ▸ PP >= \`${parser_res.parsed_args.ppThreshold}\``;
        return errorMsg;
    }

    const total_plays = filtered_scores.length;

    // ----------------------------------------------------
    // Modo 1: Single Play Display (-i <index>)
    // ----------------------------------------------------
    if (parser_res.parsed_args.explicitIndex) {
        let index = parser_res.parsed_args.index || 1;
        let content_msg = '';

        if (index > total_plays) {
            content_msg = `⚠️ Solo se encontraron **${total_plays}** mejores jugadas con los filtros activos. Mostrando la última (#${total_plays}):`;
            index = total_plays;
        } else if (index < 1) {
            content_msg = `⚠️ Índice inválido. Mostrando la mejor (#1):`;
            index = 1;
        } else {
            content_msg = `Mostrando la mejor jugada **#${index}** de **${total_plays}** del Top de PP:`;
        }

        // Función auxiliar para procesar y construir el embed de un score determinado
        async function processScore(scoreIndex) {
            const score = filtered_scores[scoreIndex - 1];
            const { great = 0, ok = 0, meh = 0, miss = 0 } = score.statistics;
            const total_hits = great + ok + meh + miss;
            const beatmap = await getBeatmap(score.beatmap.id);
            const map = await getBeatmap_osu(score.beatmap.beatmapset_id, score.beatmap.id, beatmap);
            const maxAttrs = calculatePP(score, map, "maximo_pp");

            const user_pp = score.pp ? score.pp : calculatePP(score, map, null, maxAttrs).pp;
            const beatmap_max_combo = beatmap.max_combo || (maxAttrs && maxAttrs.difficulty ? maxAttrs.difficulty.maxCombo : 0);

            let pp_fc = null;
            const isFC = score.perfect || (miss === 0 && score.max_combo >= beatmap_max_combo - 2);
            if (!isFC) {
                try {
                    const fc_statistics = {
                        ...score.statistics,
                        great: (score.statistics.great || 0) + miss,
                        miss: 0
                    };
                    const fc_score = {
                        ...score,
                        max_combo: beatmap_max_combo,
                        statistics: fc_statistics
                    };
                    pp_fc = calculatePP(fc_score, map, null, maxAttrs).pp;
                } catch (err) {
                    console.error("Error calculating pp_fc:", err);
                }
            }

            const pre_calculated = {
                "map": map,
                "map_completion": score.passed ? 100 : total_hits / map.nObjects,
                "maxAttrs": maxAttrs,
                "pp": user_pp,
                "beatmap_max_combo": beatmap_max_combo,
                "pp_fc": pp_fc
            };

            const embed = await doOsuSingleEmbed(message, score, pre_calculated, scoreIndex, total_plays, parser_res.parsed_args, ppThresholdCount);
            map.free();
            return embed;
        }

        const initialEmbed = await processScore(index);

        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

        const getSingleButtonsRow = (curr, max) => {
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('top_first')
                    .setLabel('<<')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(curr <= 1),
                new ButtonBuilder()
                    .setCustomId('top_prev')
                    .setLabel('<')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(curr <= 1),
                new ButtonBuilder()
                    .setCustomId('top_next')
                    .setLabel('>')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(curr >= max),
                new ButtonBuilder()
                    .setCustomId('top_last')
                    .setLabel('>>')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(curr >= max)
            );
        };

        const sent_message = await message.channel.send({
            content: content_msg,
            embeds: [initialEmbed],
            components: [getSingleButtonsRow(index, total_plays)]
        });

        const filter = btnInt => btnInt.user.id === message.author.id;
        const collector = sent_message.createMessageComponentCollector({
            filter,
            idle: 30000
        });

        collector.on('collect', async i => {
            try {
                await i.deferUpdate();

                if (i.customId === 'top_first') {
                    index = 1;
                } else if (i.customId === 'top_prev') {
                    index = Math.max(1, index - 1);
                } else if (i.customId === 'top_next') {
                    index = Math.min(total_plays, index + 1);
                } else if (i.customId === 'top_last') {
                    index = total_plays;
                }

                content_msg = `Mostrando la mejor jugada **#${index}** de **${total_plays}** del Top de PP:`;
                const embed = await processScore(index);

                await i.editReply({
                    content: content_msg,
                    embeds: [embed],
                    components: [getSingleButtonsRow(index, total_plays)]
                });
            } catch (err) {
                console.error("Error al navegar single top score:", err);
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
    // Modo 2: List Mode Display (Por defecto, paginación con -p)
    // ----------------------------------------------------
    let page = parser_res.parsed_args.page || 1;
    const max_pages = Math.ceil(total_plays / 5);
    if (page > max_pages) page = max_pages;
    if (page < 1) page = 1;

    let startIndex = (page - 1) * 5;

    const initialListEmbed = await doOsuListEmbed(message, parser_res.parsed_args, filtered_scores.slice(startIndex, startIndex + 5), startIndex, total_plays, ppThresholdCount);

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

    const getListButtonsRow = (start, total) => {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('rsl_first')
                .setLabel('<<')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start <= 0),
            new ButtonBuilder()
                .setCustomId('rsl_prev')
                .setLabel('<')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start <= 0),
            new ButtonBuilder()
                .setCustomId('rsl_next')
                .setLabel('>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start + 5 >= total),
            new ButtonBuilder()
                .setCustomId('rsl_last')
                .setLabel('>>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start + 5 >= total)
        );
    };

    const sent_message = await message.channel.send({
        embeds: [initialListEmbed],
        components: [getListButtonsRow(startIndex, total_plays)]
    });

    const filter = btnInt => btnInt.user.id === message.author.id;
    const collector = sent_message.createMessageComponentCollector({
        filter,
        idle: 30000
    });

    collector.on('collect', async i => {
        try {
            await i.deferUpdate();

            if (i.customId === 'rsl_first') {
                startIndex = 0;
            } else if (i.customId === 'rsl_prev') {
                startIndex = Math.max(0, startIndex - 5);
            } else if (i.customId === 'rsl_next') {
                startIndex = startIndex + 5;
            } else if (i.customId === 'rsl_last') {
                startIndex = Math.floor((total_plays - 1) / 5) * 5;
            }

            const chunk = filtered_scores.slice(startIndex, startIndex + 5);
            const embed = await doOsuListEmbed(message, parser_res.parsed_args, chunk, startIndex, total_plays, ppThresholdCount);

            await i.editReply({
                embeds: [embed],
                components: [getListButtonsRow(startIndex, total_plays)]
            });
        } catch (err) {
            console.error("Error al navegar la lista de mejores scores:", err);
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
    "maniatop" : {
        "args" : "-mania"
    },
    "ctbtop" : {
        "args" : "-ctb"
    },
    "taikotop" : {
        "args" : "-taiko"
    },
    "osutop" : {
        "args" : ""
    },
}

run.description = {
    'header' : 'Obtén el top 200 de jugadas de PP',
    'body' : `Muestra una lista paginada de las mejores jugadas (top) de un jugador de osu! con filtrado avanzado.`,
    'usage' : `s.top : Muestra tus mejores jugadas.\ns.top -m HD : Filtra por jugadas hechas exactamente con HD.\ns.top -mx HR : Filtra por jugadas que contengan HR.\ns.top -? "last goodbye" : Filtra mapas por título/artista/dificultad.\ns.top -g 300 : Cuenta y muestra jugadas con 300 pp o más.\ns.top -c : Ordena por el combo más alto.\ns.top -acc : Ordena por la precisión más alta.`
}

module.exports = { run, "description": run.description }