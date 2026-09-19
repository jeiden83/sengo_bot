const { buildPaginationRow, buildCompareSingleButtonsRow, formatMods } = require("../../../views/osuViewHelpers.js");
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

    // Resolver usuario de osu! para asegurar ID numérico y avatar correctos en todo el flujo
    const osuUser = await getOsuUser(parsed_args).catch(() => null);
    const resolvedUserId = osuUser?.id || parsed_args.username[0];
    const resolvedUsername = osuUser?.username || parsed_args.username[0] || 'Usuario';
    const server = parsed_args.server || 'bancho';

    // Asignamos el índice original y la información del usuario
    scores.forEach((score, idx) => {
        score.originalRank = idx + 1;
        if (!score.user) {
            score.user = {
                id: resolvedUserId,
                username: resolvedUsername,
                avatar_url: osuUser?.avatar_url || `https://a.ppy.sh/${resolvedUserId}`,
                server: server
            };
        } else {
            if (!score.user.id && resolvedUserId) score.user.id = resolvedUserId;
            if (!score.user.username && resolvedUsername) score.user.username = resolvedUsername;
            if (!score.user.avatar_url && osuUser?.avatar_url) score.user.avatar_url = osuUser.avatar_url;
            if (!score.user.server && server) score.user.server = server;
        }
    });

    // APLICAR FILTROS SOLICITADOS
    let filtered_scores = scores;

    if (parsed_args.modFilter !== null) {
        const filterStr = parsed_args.modFilter;
        const hasExplicitCL = filterStr.includes("CL");

        filtered_scores = filtered_scores.filter(score => {
            const scoreAcronyms = score.mods.map(m => (typeof m === 'string' ? m : m?.acronym) || '');
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
            const scoreAcronyms = score.mods.map(m => (typeof m === 'string' ? m : m?.acronym) || '');
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
        const username = resolvedUsername;
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
    // Modo 1: Single Play Display (-i <index> o única jugada)
    // ----------------------------------------------------
    if (parsed_args.explicitIndex || (filtered_scores.length === 1 && (!parsed_args.page || parsed_args.page === 1))) {
        const OsuUserModel = require("../../../models/OsuUserModel.js");
        const linkedUser = await OsuUserModel.getLinkedUser(res?.User, message.author.id);
        let currentScoreMode = (linkedUser && linkedUser.preferred_score_mode) ? linkedUser.preferred_score_mode : 'classic';

        if (parsed_args.lazerMode) {
            currentScoreMode = 'lazer';
            OsuUserModel.setPreferredScoreMode(message.author.id, 'lazer').catch(() => {});
        } else if (parsed_args.stableMode) {
            currentScoreMode = 'classic';
            OsuUserModel.setPreferredScoreMode(message.author.id, 'classic').catch(() => {});
        }

        let index = parsed_args.index || 1;
        let content_msg = '';

        if (parsed_args.explicitIndex) {
            if (index > filtered_scores.length) {
                content_msg = t(locale, 'compare.warn_max_index', { count: filtered_scores.length });
                index = filtered_scores.length;
            } else if (index < 1) {
                content_msg = t(locale, 'compare.warn_invalid_index');
                index = 1;
            } else {
                content_msg = t(locale, 'compare.showing_score_index', { index, total: filtered_scores.length });
            }
        }

        async function processScore(scoreIndex) {
            const { setChannelRecentPlayType } = require("../../utils/channelPlayCache.js");
            setChannelRecentPlayType(message.channel.id, beatmap_metadata.id, currentScoreMode === 'lazer');

            const score = filtered_scores[scoreIndex - 1];
            const { great = 0, ok = 0, meh = 0, miss = 0 } = score.statistics;
            const total_hits = great + ok + meh + miss;
            const { getBeatmap_osu, calculatePP } = require("../../utils/osu.js");
            let map = await getBeatmap_osu(beatmap_metadata.beatmapset_id, beatmap_metadata.id, beatmap_metadata);
            let maxAttrs = calculatePP(score, map, "maximo_pp");

            let user_pp = score.pp ? score.pp : calculatePP(score, map, null, maxAttrs).pp;
            let beatmap_max_combo = beatmap_metadata.max_combo || (maxAttrs && maxAttrs.difficulty ? maxAttrs.difficulty.maxCombo : 0);

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

            // ponytail: Motor nativo oficial de dificultad y PP táctil para osu!droid (@rian8337)
            if (score.user?.server === 'droid') {
                try {
                    const droidEngine = require("../../../utils/droidDifficultyEngine.js");
                    const BeatmapModel = require("../../../models/BeatmapModel.js");
                    const fs = require("fs");
                    let bInfo = score.beatmap || beatmap_metadata;
                    if (!bInfo?.id && bInfo?.checksum) {
                        bInfo = await BeatmapModel.lookupBeatmapByMD5(bInfo.checksum);
                        if (bInfo && score.beatmap) {
                            BeatmapModel.enrichBeatmapMetadata(score.beatmap, bInfo);
                            if (bInfo.beatmapset) {
                                if (!score.beatmapset) score.beatmapset = {};
                                BeatmapModel.enrichBeatmapsetMetadata(score.beatmapset, bInfo.beatmapset);
                            }
                        }
                    }
                    if (bInfo?.beatmapset_id && bInfo?.id) {
                        const filePath = await BeatmapModel.downloadBeatmapOsuFile(bInfo.beatmapset_id, bInfo.id, bInfo);
                        if (filePath && fs.existsSync(filePath)) {
                            const osuContent = fs.readFileSync(filePath, 'utf8');
                            const droidAttrs = droidEngine.calculateDroidPlayAttributes(osuContent, score, String(bInfo.id));
                            if (droidAttrs) {
                                maxAttrs = droidAttrs.maxAttrs;
                                user_pp = score.pp || droidAttrs.user_pp;
                                pp_fc = droidAttrs.pp_fc;
                                beatmap_max_combo = droidAttrs.beatmap_max_combo;
                                if (score.beatmap) {
                                    score.beatmap.difficulty_rating = droidAttrs.stars;
                                    if (droidAttrs.baseStats) {
                                        if (score.beatmap.cs == null) score.beatmap.cs = droidAttrs.baseStats.cs;
                                        if (score.beatmap.ar == null) score.beatmap.ar = droidAttrs.baseStats.ar;
                                        if (score.beatmap.accuracy == null) score.beatmap.accuracy = droidAttrs.baseStats.od;
                                        if (score.beatmap.hp == null) score.beatmap.hp = droidAttrs.baseStats.hp;
                                        if (score.beatmap.drain == null) score.beatmap.drain = droidAttrs.baseStats.hp;
                                        if (score.beatmap.bpm == null) score.beatmap.bpm = droidAttrs.baseStats.bpm;
                                    }
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.warn("[c] Error calculando PP nativo de osu!droid:", err.message);
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

            const embed = await doOsuCompareSingleEmbed(message, score, pre_calculated, scoreIndex, filtered_scores.length, parsed_args, beatmap_metadata, currentScoreMode);
            map.free();
            return embed;
        }

        const initialEmbed = await processScore(index);

        const sent_message = await message.channel.send({
            content: content_msg,
            embeds: [initialEmbed],
            components: buildCompareSingleButtonsRow(index, filtered_scores.length, filtered_scores[index - 1], false, currentScoreMode)
        });

        const filter = btnInt => btnInt.user.id === message.author.id;
        const collector = sent_message.createMessageComponentCollector({
            filter,
            idle: 30000
        });

        collector.on('collect', async i => {
            try {
                if (i.customId === 'c_single_render') {
                    const targetScore = filtered_scores[index - 1];
                    
                    // Deshabilitar botón de render en el mensaje original para evitar flood
                    try {
                        const updatedComponents = buildCompareSingleButtonsRow(index, filtered_scores.length, targetScore, true, currentScoreMode);
                        if (typeof i.update === 'function') {
                            await i.update({ components: updatedComponents });
                        } else {
                            await i.deferUpdate();
                        }
                    } catch (err) {
                        console.error("Error al deshabilitar el botón de render en compare:", err);
                        try { await i.deferUpdate(); } catch {}
                    }
                    
                    const infoMsg = await i.channel.send(`📥 **[o!rdr]** Preparando renderizado para la jugada de **${targetScore.user?.username || 'Usuario'}**...`);
                    
                    try {
                        const OsuUserModel = require('../../../models/OsuUserModel.js');
                        const scoreId = targetScore.id;
                        const replayBuffer = await OsuUserModel.downloadReplay(scoreId, targetScore.mode || targetGamemode || 'osu');
                        
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
                        
                        const username = targetScore.user?.username || parsed_args.username?.[0] || 'Usuario';
                        const artist = targetScore.beatmapset?.artist || beatmap_metadata.beatmapset?.artist || '';
                        const title = targetScore.beatmapset?.title || beatmap_metadata.beatmapset?.title || '';
                        const version = targetScore.beatmap?.version || beatmap_metadata.version || '';
                        const stars = (targetScore.beatmap?.difficulty_rating || beatmap_metadata.difficulty_rating)
                            ? ` (${(targetScore.beatmap?.difficulty_rating || beatmap_metadata.difficulty_rating).toFixed(2)}★)`
                            : '';
                        const modsString = targetScore.mods && targetScore.mods.length > 0 ? ` +${formatMods(targetScore.mods)}` : '';
                        const accuracy = targetScore.accuracy ? ` | Accuracy: ${(targetScore.accuracy * 100).toFixed(2)}%` : '';
                        const customDescription = `${username} on ${artist} - ${title} [${version}]${stars}${modsString}${accuracy}`;

                        await renderCmd.startRenderFlow(
                            mockMessages,
                            replayBuffer,
                            `compare_${scoreId}.osr`,
                            { skin: 'default', resolution: '1280x720', skinSpecified: false, customDescription },
                            locale
                        );
                        
                    } catch (err) {
                        console.error("Error al descargar replay de Compare Play:", err);
                        await infoMsg.edit(err.isCooldownError ? `❌ ${err.message}` : `❌ **Error:** ${t(locale, 'render.err_fetch_replay')}`);
                    }
                    return;
                }

                await i.deferUpdate();

                if (i.customId.startsWith('c_single_toggle_score_')) {
                    currentScoreMode = currentScoreMode === 'classic' ? 'lazer' : 'classic';
                    await OsuUserModel.setPreferredScoreMode(message.author.id, currentScoreMode);
                } else if (i.customId === 'c_single_first') {
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
                    components: buildCompareSingleButtonsRow(index, filtered_scores.length, filtered_scores[index - 1], false, currentScoreMode)
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

    const { getBeatmapModeAttributes } = require("../../utils/osu.js");
    const activeGamemode = parsed_args.gamemode || targetGamemode || beatmap_metadata.mode;
    const modeAttrs = await getBeatmapModeAttributes(beatmap_metadata, activeGamemode, parsed_args.ppEngine);
    const targetStars = modeAttrs.stars;
    beatmap_metadata.difficulty_rating = modeAttrs.stars;
    if (modeAttrs.maxCombo) {
        beatmap_metadata.max_combo = modeAttrs.maxCombo;
    }
    beatmap_metadata.mode = modeAttrs.mode;

    const OsuUserModel = require("../../../models/OsuUserModel.js");
    const linkedUser = await OsuUserModel.getLinkedUser(res?.User, message.author.id);
    let currentScoreMode = (linkedUser && linkedUser.preferred_score_mode) ? linkedUser.preferred_score_mode : 'classic';

    if (parsed_args.lazerMode) {
        currentScoreMode = 'lazer';
        OsuUserModel.setPreferredScoreMode(message.author.id, 'lazer').catch(() => {});
    } else if (parsed_args.stableMode) {
        currentScoreMode = 'classic';
        OsuUserModel.setPreferredScoreMode(message.author.id, 'classic').catch(() => {});
    }

    const { setChannelRecentPlayType } = require("../../utils/channelPlayCache.js");
    setChannelRecentPlayType(message.channel.id, beatmap_metadata.id, currentScoreMode === 'lazer');

    async function getCompareListStars(chunk) {
        return Promise.all(chunk.map(async (score) => {
            const isDroid = score.user?.server === 'droid' || parsed_args.server === 'droid';
            if (isDroid) {
                try {
                    const droidEngine = require("../../../utils/droidDifficultyEngine.js");
                    const BeatmapModel = require("../../../models/BeatmapModel.js");
                    const fs = require("fs");
                    let bInfo = score.beatmap || beatmap_metadata;
                    if (!bInfo?.id && bInfo?.checksum) {
                        bInfo = await BeatmapModel.lookupBeatmapByMD5(bInfo.checksum);
                    }
                    const bId = bInfo?.id || beatmap_metadata.id;
                    const bSetId = bInfo?.beatmapset_id || beatmap_metadata.beatmapset_id;
                    if (bSetId && bId) {
                        const filePath = await BeatmapModel.downloadBeatmapOsuFile(bSetId, bId, bInfo || beatmap_metadata);
                        if (filePath && fs.existsSync(filePath)) {
                            const osuContent = fs.readFileSync(filePath, 'utf8');
                            const droidAttrs = droidEngine.calculateDroidPlayAttributes(osuContent, score, String(bId));
                            if (droidAttrs) return droidAttrs.stars;
                        }
                    }
                } catch (_) {}
                return score.beatmap?.difficulty_rating || beatmap_metadata.difficulty_rating || 0;
            }

            try {
                const { getBeatmap_osu, calculatePP } = require("../../utils/osu.js");
                const map = await getBeatmap_osu(beatmap_metadata.beatmapset_id, beatmap_metadata.id, beatmap_metadata, parsed_args.ppEngine);
                const maxAttrs = calculatePP(score, map, "maximo_pp", null, parsed_args.ppEngine);
                const stars = maxAttrs.stars || (maxAttrs.difficulty ? maxAttrs.difficulty.stars : beatmap_metadata.difficulty_rating);
                map.free();
                return stars;
            } catch {
                return beatmap_metadata.difficulty_rating || 0;
            }
        }));
    }

    const currentChunk = filtered_scores.slice(startIndex, startIndex + 10);
    const calculated_stars = await getCompareListStars(currentChunk);
    const initialListEmbed = await doOsuCompareListEmbed(message, parsed_args, currentChunk, startIndex, filtered_scores.length, beatmap_metadata, currentScoreMode, calculated_stars);
    const username = resolvedUsername;
    const content = getOsuCompareContent(parsed_args, username, beatmap_metadata, locale, targetStars);

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const getListComponents = (start, total, scoreMode) => {
        const row1 = buildPaginationRow({ prefix: 'c', current: start, total, pageSize: 10 });
        const row2 = new ActionRowBuilder();
        const toggleLabel = scoreMode === 'lazer' ? 'Classic 🎮' : 'Lazer 🌐';
        const toggleId = `c_toggle_score_${scoreMode}`;
        row2.addComponents(
            new ButtonBuilder()
                .setCustomId(toggleId)
                .setLabel(toggleLabel)
                .setStyle(ButtonStyle.Secondary)
        );
        return [row1, row2];
    };

    const sent_message = await message.channel.send({
        content: content,
        embeds: [initialListEmbed],
        components: getListComponents(startIndex, filtered_scores.length, currentScoreMode)
    });

    const filter = btnInt => btnInt.user.id === message.author.id;
    const collector = sent_message.createMessageComponentCollector({
        filter,
        idle: 30000
    });

    collector.on('collect', async i => {
        try {
            await i.deferUpdate();

            if (i.customId.startsWith('c_toggle_score_')) {
                currentScoreMode = currentScoreMode === 'classic' ? 'lazer' : 'classic';
                await OsuUserModel.setPreferredScoreMode(message.author.id, currentScoreMode);
                const { setChannelRecentPlayType: setChannelCache } = require("../../utils/channelPlayCache.js");
                setChannelCache(message.channel.id, beatmap_metadata.id, currentScoreMode === 'lazer');
            } else if (i.customId === 'c_first') {
                startIndex = 0;
            } else if (i.customId === 'c_prev') {
                startIndex = Math.max(0, startIndex - 10);
            } else if (i.customId === 'c_next') {
                startIndex = startIndex + 10;
            } else if (i.customId === 'c_last') {
                startIndex = Math.floor((filtered_scores.length - 1) / 10) * 10;
            }

            const chunk = filtered_scores.slice(startIndex, startIndex + 10);
            const starsChunk = await getCompareListStars(chunk);
            const embed = await doOsuCompareListEmbed(message, parsed_args, chunk, startIndex, filtered_scores.length, beatmap_metadata, currentScoreMode, starsChunk);

            await i.editReply({
                embeds: [embed],
                components: getListComponents(startIndex, filtered_scores.length, currentScoreMode)
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