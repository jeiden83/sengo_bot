const { buildPaginationRow, buildCompareSingleButtonsRow } = require("../../../views/osuViewHelpers.js");
const { getUnrankedBeatmapUserAllScores, argsParser, getBeatmapUserAllScores, findBeatmapInChannel, getBeatmap, getOsuUser, argsParserNoCommand } = require("../../utils/osu.js");
const { doOsuCompareSingleEmbed, doOsuCompareListEmbed, getOsuCompareContent } = require("../../../views/osuEmbeds.js");
const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message, res, reply, logger } = messages;
    const locale = message.locale || 'es';

    const initial_parsed = argsParserNoCommand(args);
    let beatmap_url = initial_parsed.beatmap_url;
    let detected_gamemode = null;

    let channel_result = null;
    if (!beatmap_url) {
        if (logger) logger.process(t(locale, 'compare.searching_recent'));
        channel_result = reply ? await findBeatmapInChannel(reply, true, initial_parsed.index) : await findBeatmapInChannel(message, false, initial_parsed.index);
        beatmap_url = channel_result.beatmap_url;
        detected_gamemode = channel_result.gamemode;
        if (!beatmap_url) return channel_result.bad_response;
    }

    // Para revisar si es graveyard o no
    if (logger) logger.process(t(locale, 'compare.fetching_metadata'));
    const beatmap_metadata = await getBeatmap(beatmap_url);
    const unranked_statuses = new Set(['pending', 'graveyard', 'wip']);

    // Si detectamos el modo de juego de la última play mostrada en el canal, lo priorizamos frente al nativo del beatmap
    const targetGamemode = detected_gamemode || beatmap_metadata.mode;

    if (logger) logger.process(t(locale, 'compare.fetching_scores'));
    const { fn_response, parsed_args } = await argsParser(args,                  // Si es un mapa unranked lo mandamos a buscar los scores locales, sino los rankeados
        { 
            "message": message, 
            "res": res, 
            "beatmap_url": beatmap_url, 
            "gamemode": targetGamemode, 
            "ignore_main_gamemode": true,
            "command_function": unranked_statuses.has(beatmap_metadata.status) ? getUnrankedBeatmapUserAllScores : getBeatmapUserAllScores 
        });

    if (typeof fn_response === 'string') return fn_response;

    if (channel_result && channel_result.fromList) {
        parsed_args.index = 1;
    }
    
    let scores = fn_response;
    const filterPass = parsed_args.filterPass;
    if (filterPass) {
        scores = scores.filter(score => score.passed);
        if (scores.length === 0) return t(locale, 'compare.err_no_scores_passed');
    } else if (scores.length === 0) {
        return t(locale, 'compare.err_no_scores');
    }

    // Asignamos el índice original
    scores.forEach((score, idx) => {
        score.originalRank = idx + 1;
    });

    // APLICAR FILTROS SOLICITADOS
    let filtered_scores = scores;

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
        let errorMsg = t(locale, 'compare.err_no_filtered_scores', { username });
        if (parsed_args.modFilter !== null) errorMsg += `\n ▸ ${t(locale, 'compare.filter_exact_mods')}: \`${parsed_args.modFilter}\``;
        if (parsed_args.modContainFilter !== null) errorMsg += `\n ▸ ${t(locale, 'compare.filter_contain_mods')}: \`${parsed_args.modContainFilter}\``;
        if (parsed_args.ppThreshold !== null) errorMsg += `\n ▸ PP >= \`${parsed_args.ppThreshold}\``;
        return errorMsg;
    }

    // Calcular PP para los scores filtrados si no tienen
    let needsPP = filtered_scores.some(s => !s.pp);
    if (needsPP || beatmap_metadata.status === 'loved') {
        if (logger) logger.process(t(locale, 'compare.simulating_pp'));
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
            content_msg = t(locale, 'compare.warn_max_index', { count: filtered_scores.length });
            index = filtered_scores.length;
        } else if (index < 1) {
            content_msg = t(locale, 'compare.warn_invalid_index');
            index = 1;
        } else {
            content_msg = t(locale, 'compare.showing_score_index', { index, total: filtered_scores.length });
        }

        async function processScore(scoreIndex) {
            const score = filtered_scores[scoreIndex - 1];
            const { great = 0, ok = 0, meh = 0, miss = 0 } = score.statistics;
            const total_hits = great + ok + meh + miss;
            const { getBeatmap_osu, calculatePP } = require("../../utils/osu.js");
            let map = await getBeatmap_osu(beatmap_metadata.beatmapset_id, beatmap_metadata.id, beatmap_metadata);
            const maxAttrs = calculatePP(score, map, "maximo_pp");

            const user_pp = score.pp ? score.pp : calculatePP(score, map, null, maxAttrs).pp;
            const beatmap_max_combo = beatmap_metadata.max_combo || (maxAttrs && maxAttrs.difficulty ? maxAttrs.difficulty.maxCombo : 0);

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
                "map_completion": score.passed ? 1.0 : (map.nObjects > 0 ? total_hits / map.nObjects : score.map_completion || 0),
                "maxAttrs": maxAttrs,
                "pp": user_pp,
                "beatmap_max_combo": beatmap_max_combo,
                "pp_fc": pp_fc
            };

            const embed = await doOsuCompareSingleEmbed(message, score, pre_calculated, scoreIndex, filtered_scores.length, parsed_args, beatmap_metadata);
            map.free();
            return embed;
        }

        const initialEmbed = await processScore(index);

        const sent_message = await message.channel.send({
            content: content_msg,
            embeds: [initialEmbed],
            components: [buildCompareSingleButtonsRow(index, filtered_scores.length, filtered_scores[index - 1])]
        });

        const filter = btnInt => btnInt.user.id === message.author.id;
        const collector = sent_message.createMessageComponentCollector({
            filter,
            idle: 30000
        });

        collector.on('collect', async i => {
            try {
                if (i.customId === 'c_single_render') {
                    await i.deferUpdate(); // confirmamos la pulsación del botón
                    
                    const targetScore = filtered_scores[index - 1];
                    const infoMsg = await i.channel.send(`📥 **[o!rdr]** Preparando renderizado para la jugada de **${targetScore.user?.username || 'Usuario'}**...`);
                    
                    try {
                        const fetch = require('node-fetch');
                        const OsuUserModel = require('../../../models/OsuUserModel.js');
                        const fs = require('fs');
                        await OsuUserModel.NewloadToken();
                        
                        let token = null;
                        try {
                            const tokenData = JSON.parse(fs.readFileSync('./osu_api_extended_token.json', 'utf8'));
                            token = tokenData.access_token;
                        } catch (err) {
                            console.error("Error al leer token:", err);
                        }
                        
                        if (!token) {
                            throw new Error("No token available");
                        }
                        
                        const mode = targetScore.mode || 'osu';
                        const scoreId = targetScore.id;
                        const url = `https://osu.ppy.sh/api/v2/scores/${mode}/${scoreId}/download`;
                        
                        const downloadRes = await fetch(url, {
                            headers: {
                                'Authorization': `Bearer ${token}`
                            }
                        });
                        
                        if (!downloadRes.ok) {
                            throw new Error(`osu! API returned ${downloadRes.status}`);
                        }
                        
                        const replayBuffer = await downloadRes.buffer();
                        
                        // Invocar el flujo de renderizado usando startRenderFlow
                        const renderCmd = require('./render.js');
                        const mockMessages = {
                            message: {
                                author: i.user,
                                locale: locale,
                                channel: {
                                    send: async (options) => {
                                        try { await infoMsg.delete(); } catch {}
                                        return await i.channel.send(options);
                                    },
                                    sendTyping: async () => {}
                                }
                            }
                        };
                        
                        await renderCmd.startRenderFlow(
                            mockMessages,
                            replayBuffer,
                            `compare_${scoreId}.osr`,
                            { skin: 'Default', resolution: '1280x720' },
                            locale
                        );
                        
                    } catch (err) {
                        console.error("Error al descargar replay de Compare Play:", err);
                        await infoMsg.edit(`❌ **Error:** No se pudo obtener el replay para esta jugada desde los servidores de osu! (es común para jugadas que no son del Top 100 del mapa o si son muy antiguas/fallidas).`);
                    }
                    return;
                }

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

                content_msg = t(locale, 'compare.showing_score_index', { index, total: filtered_scores.length });
                const embed = await processScore(index);

                await i.editReply({
                    content: content_msg,
                    embeds: [embed],
                    components: [buildCompareSingleButtonsRow(index, filtered_scores.length, filtered_scores[index - 1])]
                });
            } catch (err) {
                console.error("Error al navegar single compare score:", err);
            }
        });

        collector.on('end', async () => {
            try {
                await sent_message.edit({ components: [] });
            } catch {}
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

    const initialListEmbed = await doOsuCompareListEmbed(message, parsed_args, filtered_scores.slice(startIndex, startIndex + 10), startIndex, filtered_scores.length, beatmap_metadata);
    const username = scores[0]?.user?.username || (await getOsuUser(parsed_args)).username || 'Usuario';
    const content = getOsuCompareContent(parsed_args, username, beatmap_metadata, locale);

    const getListButtonsRow = (start, total) => {
        return buildPaginationRow({ prefix: 'c', current: start, total, pageSize: 10 });
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
            const embed = await doOsuCompareListEmbed(message, parsed_args, chunk, startIndex, filtered_scores.length, beatmap_metadata);

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
        } catch {}
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
    'header': t('es', 'commands.c.header'),
    'body': t('es', 'commands.c.body'),
    'usage': t('es', 'commands.c.usage')
}

module.exports = { run, description: run.description }