const { getBeatmap_osu, getUserTopScores, argsParser, getBeatmap, calculatePP } = require("../../utils/osu.js");
const { colorear } = require("../../utils/admin.js");
const { doOsuTopSingleEmbed, doOsuTopListEmbed } = require("../../../views/osuEmbeds.js");
const { buildPaginationRow } = require("../../../views/osuViewHelpers.js");

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
            const stats = score.statistics || {};
            const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
            const ok = stats.ok !== undefined ? stats.ok : (stats.count_100 || 0);
            const meh = stats.meh !== undefined ? stats.meh : (stats.count_50 || 0);
            const miss = stats.miss !== undefined ? stats.miss : (stats.count_miss || 0);
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

            const embed = await doOsuTopSingleEmbed(message, score, pre_calculated, scoreIndex, total_plays, parser_res.parsed_args, ppThresholdCount);
            map.free();
            return embed;
        }

        const initialEmbed = await processScore(index);

        const getSingleButtonsRow = (curr, max) => {
            return buildPaginationRow({
                prefix: 'top',
                current: curr,
                total: max,
                oneIndexed: true,
                customSuffixes: { first: 'first', prev: 'prev', next: 'next', last: 'last' }
            });
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

    async function getListStars(chunk) {
        return Promise.all(chunk.map(async (score) => {
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
    }

    const initialChunk = filtered_scores.slice(startIndex, startIndex + 5);
    const initialStars = await getListStars(initialChunk);
    const initialListEmbed = await doOsuTopListEmbed(message, parser_res.parsed_args, initialChunk, startIndex, total_plays, ppThresholdCount, initialStars);

    const getListButtonsRow = (start, total) => {
        return buildPaginationRow({ prefix: 'rsl', current: start, total, pageSize: 5 });
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
            const stars = await getListStars(chunk);
            const embed = await doOsuTopListEmbed(message, parser_res.parsed_args, chunk, startIndex, total_plays, ppThresholdCount, stars);

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