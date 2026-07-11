const { getOsuUser, argsParser } = require("../../utils/osu.js");
const { t } = require("../../../utils/i18n.js");
const OsuScoreModel = require("../../../models/OsuScoreModel.js");
const { doOsuSnipesEmbed, doOsuSnipesNemesisEmbed } = require("../../../views/osuEmbeds.js");

const modeToInt = {
    'osu': 0,
    'taiko': 1,
    'fruits': 2,
    'mania': 3
};

async function run(messages, args){
    const { message, res, reply } = messages;
    const locale = message.locale || 'es';

    // Parseamos argumentos de entrada del usuario
    const osu_userdata = await argsParser(args,
        {"message" : message, "res" : res, "command_function" : getOsuUser, "resolveUserByIndex": true, "ignoreBeatmap": true});  

    if (!osu_userdata.fn_response || typeof osu_userdata.fn_response === 'string') {
        return osu_userdata.fn_response || t(locale, 'rework.err_user_not_found');
    }

    const { country_code, id } = osu_userdata.fn_response;
    const playmode = osu_userdata.fn_response.playmode || 'osu';
    const look_gamemode = modeToInt[playmode] ?? 0;

    // Solo soportamos Venezuela (VE) por ahora mientras se raspa la base de datos nacional
    if (country_code !== 'VE') {
        return t(locale, 'snipes.err_country_support');
    }

    const isDetailed = osu_userdata.parsed_args?.detailed === true;
    const isNemesis = osu_userdata.parsed_args?.nemesis === true;
    const isTop = osu_userdata.parsed_args?.reworkTop === true;
    const isDetailedQuery = isDetailed || isTop;
 
    // Inicializar barra de progreso
    let sentMessage = null;
    const processStartTime = Date.now();
    let stepStartTime = Date.now();
    const activeSteps = [];
 
    const stepTemplates = isNemesis
        ? (locale === 'es' ? ["Obteniendo historial de snipes..."] : ["Fetching snipes history..."])
        : (isTop
            ? (locale === 'es' ? ["Obteniendo tops nacionales..."] : ["Fetching national tops..."])
            : (isDetailed
                ? (locale === 'es' 
                    ? [
                        "Obteniendo tops nacionales...",
                        "Procesando estadísticas detalladas...",
                        "Generando gráfico de distribución..."
                      ] 
                    : [
                        "Fetching national tops...",
                        "Processing detailed statistics...",
                        "Generating distribution chart..."
                      ]
                  )
                : (locale === 'es' ? ["Obteniendo tops nacionales..."] : ["Fetching national tops..."])
              )
          );

    const updateProgress = async (stepIndex, status, extra = "") => {
        const { EmbedBuilder } = require("discord.js");
        const roleColor = message.member?.roles?.highest?.color || '#ffffff';
        const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ff66aa';

        if (activeSteps.length <= stepIndex) {
            for (let i = activeSteps.length; i < stepIndex; i++) {
                if (activeSteps[i]) {
                    activeSteps[i].status = 'success';
                    if (activeSteps[i].duration === null) {
                        activeSteps[i].duration = Date.now() - stepStartTime;
                    }
                }
            }
            activeSteps.push({
                text: stepTemplates[stepIndex],
                status: 'loading',
                duration: null,
                extra: ""
            });
            stepStartTime = Date.now();
        }

        const step = activeSteps[stepIndex];
        step.status = status;
        step.extra = extra;

        if (status === 'success' || status === 'error' || status === 'warning') {
            if (step.duration === null) {
                step.duration = Date.now() - stepStartTime;
            }
        }

        const descriptionLines = activeSteps.map((s) => {
            let emoji = '⏳';
            if (s.status === 'success') emoji = '✅';
            else if (s.status === 'error') emoji = '❌';
            else if (s.status === 'warning') emoji = '⚠️';

            let durationText = s.duration !== null ? ` - **${s.duration}ms**` : "";
            let extraText = s.extra ? ` ${s.extra}` : "";
            return `${emoji} ${s.text}${durationText}${extraText}`;
        });

        const totalElapsed = Date.now() - processStartTime;
        const progressEmbed = new EmbedBuilder()
            .setTitle(locale === 'es' ? "Procesando Estadísticas de Snipes..." : "Processing Snipe Statistics...")
            .setDescription(descriptionLines.join('\n'))
            .setColor(embedColor)
            .setFooter({
                text: locale === 'es'
                    ? `Sengo • Tiempo transcurrido: ${(totalElapsed / 1000).toFixed(2)}s`
                    : `Sengo • Elapsed time: ${(totalElapsed / 1000).toFixed(2)}s`
            });

        try {
            if (!sentMessage) {
                if (reply) {
                    sentMessage = await reply.reply({ embeds: [progressEmbed] });
                } else if (res && typeof res.reply === 'function') {
                    sentMessage = await res.reply({ embeds: [progressEmbed], fetchReply: true });
                } else {
                    sentMessage = await message.reply({ embeds: [progressEmbed] });
                }
            } else if (typeof sentMessage.edit === 'function') {
                await sentMessage.edit({ embeds: [progressEmbed] });
            }
        } catch (e) {
            // Silencioso
        }
    };

    if (isNemesis) {
        await updateProgress(0, 'loading');
        let history;
        try {
            history = await OsuScoreModel.getUserSnipesHistory(id);
            await updateProgress(0, 'success');
        } catch (errHistory) {
            console.error("Error al obtener historial de snipes en snipes.js:", errHistory);
            await updateProgress(0, 'error', `(${t(locale, 'snipes.err_db_scores')})`);
            return;
        }

        const embedResult = doOsuSnipesNemesisEmbed(message, history.made, history.received, osu_userdata.fn_response, locale);
        if (sentMessage && typeof sentMessage.edit === 'function') {
            await sentMessage.edit({ content: null, embeds: embedResult.embeds || [embedResult] });
            return;
        }
        return embedResult;
    }

    await updateProgress(0, 'loading');
    let userScores = [];
    try {
        userScores = await OsuScoreModel.getUserNationalTops(id, look_gamemode, country_code, isDetailedQuery, (count) => {
            updateProgress(0, 'loading', `(${count} cargados...)`);
        });
        await updateProgress(0, 'success', `(${userScores.length} cargados)`);
    } catch (errUserScores) {
        console.error("Error al obtener puntuaciones del usuario en snipes.js:", errUserScores);
        await updateProgress(0, 'error', `(${t(locale, 'snipes.err_db_scores')})`);
        return;
    }

    if (isTop) {
        // Mapear DB scores a la estructura de top.js
        const adaptedScores = userScores.map((dbScore) => {
            const modsString = dbScore.mods || 'NM';
            const scoreMods = (modsString === 'NM' || modsString === 'NONE') 
                ? [] 
                : modsString.match(/.{1,2}/g).map(mod => ({ acronym: mod }));

            const hasHiddenOrFlashlight = scoreMods.some(m => m.acronym === 'HD' || m.acronym === 'FL');
            let calculatedRank = dbScore.rank;
            if (!calculatedRank) {
                calculatedRank = 'D';
                const acc = dbScore.accuracy || 0;
                if (acc >= 1.0) {
                    calculatedRank = hasHiddenOrFlashlight ? 'SSH' : 'SS';
                } else if (acc >= 0.95) {
                    calculatedRank = hasHiddenOrFlashlight ? 'SH' : 'S';
                } else if (acc >= 0.90) {
                    calculatedRank = 'A';
                } else if (acc >= 0.85) {
                    calculatedRank = 'B';
                } else if (acc >= 0.80) {
                    calculatedRank = 'C';
                }
            }

            const dbMaxCombo = dbScore.max_combo !== undefined && dbScore.max_combo !== null ? dbScore.max_combo : null;
            const dbPerfect = dbScore.perfect !== undefined && dbScore.perfect !== null ? dbScore.perfect : false;
            const isStatsEstimated = !dbScore.statistics;

            const mode = dbScore.ranked_beatmaps?.mode || 0;
            const limitCombo = dbScore.ranked_beatmaps?.max_combo || 1000;

            let great = limitCombo;
            let ok = 0;
            let meh = 0;
            let miss = 0;

            if (dbScore.statistics) {
                const stats = dbScore.statistics;
                great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
                ok = stats.ok !== undefined ? stats.ok : (stats.count_100 || 0);
                meh = stats.meh !== undefined ? stats.meh : (stats.count_50 || 0);
                miss = stats.miss !== undefined ? stats.miss : (stats.count_miss || 0);
            } else {
                if (mode === 1) { // Taiko
                    great = Math.max(0, Math.min(limitCombo, Math.round(limitCombo * (2 * acc - 1))));
                    ok = Math.max(0, limitCombo - great);
                } else { // osu!std, mania, catch
                    great = Math.max(0, Math.min(limitCombo, Math.round(limitCombo * (3 * acc - 1) / 2)));
                    ok = Math.max(0, limitCombo - great);
                }
            }

            return {
                id: dbScore.beatmap_id,
                beatmap: {
                    id: dbScore.beatmap_id,
                    version: dbScore.ranked_beatmaps?.version || '',
                    difficulty_rating: dbScore.ranked_beatmaps?.stars ? parseFloat(dbScore.ranked_beatmaps.stars) : 0,
                    bpm: dbScore.ranked_beatmaps?.bpm ? parseFloat(dbScore.ranked_beatmaps.bpm) : 0,
                    ar: dbScore.ranked_beatmaps?.ar ? parseFloat(dbScore.ranked_beatmaps.ar) : 0,
                    od: dbScore.ranked_beatmaps?.od ? parseFloat(dbScore.ranked_beatmaps.od) : 0,
                    cs: dbScore.ranked_beatmaps?.cs ? parseFloat(dbScore.ranked_beatmaps.cs) : 0,
                    hp: dbScore.ranked_beatmaps?.hp ? parseFloat(dbScore.ranked_beatmaps.hp) : 0,
                    max_combo: dbScore.ranked_beatmaps?.max_combo || 0
                },
                beatmapset: {
                    id: dbScore.ranked_beatmaps?.beatmapset_id || 0,
                    title: dbScore.ranked_beatmaps?.title || '',
                    artist: dbScore.ranked_beatmaps?.artist || '',
                    creator: dbScore.ranked_beatmaps?.creator || '',
                    covers: {
                        cover: `https://assets.ppy.sh/beatmaps/${dbScore.ranked_beatmaps?.beatmapset_id || 0}/covers/cover.jpg`,
                        "cover@2x": `https://assets.ppy.sh/beatmaps/${dbScore.ranked_beatmaps?.beatmapset_id || 0}/covers/cover@2x.jpg`,
                        card: `https://assets.ppy.sh/beatmaps/${dbScore.ranked_beatmaps?.beatmapset_id || 0}/covers/card.jpg`,
                        "card@2x": `https://assets.ppy.sh/beatmaps/${dbScore.ranked_beatmaps?.beatmapset_id || 0}/covers/card@2x.jpg`,
                        list: `https://assets.ppy.sh/beatmaps/${dbScore.ranked_beatmaps?.beatmapset_id || 0}/covers/list.jpg`,
                        "list@2x": `https://assets.ppy.sh/beatmaps/${dbScore.ranked_beatmaps?.beatmapset_id || 0}/covers/list@2x.jpg`,
                        slimcover: `https://assets.ppy.sh/beatmaps/${dbScore.ranked_beatmaps?.beatmapset_id || 0}/covers/slimcover.jpg`,
                        "slimcover@2x": `https://assets.ppy.sh/beatmaps/${dbScore.ranked_beatmaps?.beatmapset_id || 0}/covers/slimcover@2x.jpg`
                    }
                },
                mods: scoreMods,
                rank: calculatedRank,
                pp: dbScore.pp || 0,
                accuracy: dbScore.accuracy || 0,
                max_combo: dbMaxCombo,
                perfect: dbPerfect,
                isStatsEstimated: isStatsEstimated,
                passed: true,
                ended_at: dbScore.ended_at,
                created_at: dbScore.ended_at,
                statistics: {
                    great: great,
                    ok: ok,
                    meh: meh,
                    miss: miss,
                    count_300: great,
                    count_100: ok,
                    count_50: meh,
                    count_miss: miss,
                    is_estimated: isStatsEstimated
                },
                user: {
                    username: dbScore.username || osu_userdata.fn_response.username,
                    avatar_url: osu_userdata.fn_response.avatar_url || ''
                }
            };
        });

        // Ordenar por PP desc por defecto y asignar rango original
        adaptedScores.sort((a, b) => b.pp - a.pp);
        adaptedScores.forEach((score, idx) => {
            score.originalRank = idx + 1;
        });

        // Aplicar filtros
        let filtered_scores = adaptedScores;

        // 1. Filtrar por mods exactos (-m)
        if (osu_userdata.parsed_args.modFilter !== null) {
            const filterStr = osu_userdata.parsed_args.modFilter;
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
        if (osu_userdata.parsed_args.modContainFilter !== null) {
            const filterStr = osu_userdata.parsed_args.modContainFilter;
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
        if (osu_userdata.parsed_args.searchFilter !== null) {
            const query = osu_userdata.parsed_args.searchFilter;
            filtered_scores = filtered_scores.filter(score => {
                const title = (score.beatmapset.title || "").toLowerCase();
                const artist = (score.beatmapset.artist || "").toLowerCase();
                const version = (score.beatmap.version || "").toLowerCase();
                return title.includes(query) || artist.includes(query) || version.includes(query);
            });
        }

        // 4. Filtrar por PP y contar (-g)
        let ppThresholdCount = 0;
        if (osu_userdata.parsed_args.ppThreshold !== null) {
            const threshold = osu_userdata.parsed_args.ppThreshold;
            filtered_scores = filtered_scores.filter(score => (score.pp || 0) >= threshold);
            ppThresholdCount = filtered_scores.length;
        }

        // 5. Ordenar por fecha/reciente (-r)
        if (osu_userdata.parsed_args.recentSort) {
            filtered_scores.sort((a, b) => new Date(b.ended_at || b.created_at) - new Date(a.ended_at || a.created_at));
        }

        // 6. Ordenar por combo (-c)
        if (osu_userdata.parsed_args.comboSort) {
            filtered_scores.sort((a, b) => (b.max_combo || 0) - (a.max_combo || 0));
        }

        // 7. Ordenar por precisión (-acc)
        if (osu_userdata.parsed_args.accSort) {
            filtered_scores.sort((a, b) => (b.accuracy || 0) - (a.accuracy || 0));
        }

        if (filtered_scores.length === 0) {
            const username = osu_userdata.fn_response.username;
            let errorMsg = t(locale, 'top.err_no_filtered_scores', { username });
            if (osu_userdata.parsed_args.modFilter !== null) errorMsg += t(locale, 'top.filter_exact_mods', { val: osu_userdata.parsed_args.modFilter });
            if (osu_userdata.parsed_args.modContainFilter !== null) errorMsg += t(locale, 'top.filter_contain_mods', { val: osu_userdata.parsed_args.modContainFilter });
            if (osu_userdata.parsed_args.searchFilter !== null) errorMsg += t(locale, 'top.filter_search', { val: osu_userdata.parsed_args.searchFilter });
            if (osu_userdata.parsed_args.ppThreshold !== null) errorMsg += t(locale, 'top.filter_pp', { val: osu_userdata.parsed_args.ppThreshold });

            if (sentMessage && typeof sentMessage.edit === 'function') {
                await sentMessage.edit({ content: errorMsg, embeds: [] });
                return;
            }
            return errorMsg;
        }

        const total_plays = filtered_scores.length;

        // IMPORTACIONES DE VISTAS/UTILIDADES DE TOP
        const { doOsuTopSingleEmbed, doOsuTopListEmbed } = require("../../../views/osuEmbeds.js");
        const { buildPaginationRow, buildTopSingleButtonsRow, formatMods } = require("../../../views/osuViewHelpers.js");
        const OsuUserModel = require("../../../models/OsuUserModel.js");

        // --- MODO 1: SINGLE PLAY DISPLAY (-i <index>) ---
        if (osu_userdata.parsed_args.explicitIndex) {
            let index = osu_userdata.parsed_args.index || 1;
            let content_msg = '';

            if (index > total_plays) {
                content_msg = t(locale, 'top.warn_max_index', { total: total_plays });
                index = total_plays;
            } else if (index < 1) {
                content_msg = t(locale, 'top.warn_invalid_index');
                index = 1;
            } else {
                content_msg = t(locale, 'top.showing_score_index', { index, total: total_plays });
            }

            const linkedUser = await OsuUserModel.getLinkedUser(res?.User, message.author.id);
            let currentScoreMode = (linkedUser && linkedUser.preferred_score_mode) ? linkedUser.preferred_score_mode : 'classic';

            const processScore = async (scoreIndex) => {
                const score = filtered_scores[scoreIndex - 1];
                const stats = score.statistics || {};
                const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
                const ok = stats.ok !== undefined ? stats.ok : (stats.count_100 || 0);
                const meh = stats.meh !== undefined ? stats.meh : (stats.count_50 || 0);
                const miss = stats.miss !== undefined ? stats.miss : (stats.count_miss || 0);
                const total_hits = great + ok + meh + miss;

                const { getBeatmap, getBeatmap_osu, calculatePP } = require("../../utils/osu.js");
                const beatmap = await getBeatmap(score.beatmap.id);
                const map = await getBeatmap_osu(score.beatmapset.id, score.beatmap.id, beatmap);
                const maxAttrs = calculatePP(score, map, "maximo_pp");

                const user_pp = score.pp ? score.pp : calculatePP(score, map, null, maxAttrs).pp;
                const beatmap_max_combo = beatmap.max_combo || (maxAttrs && maxAttrs.difficulty ? maxAttrs.difficulty.maxCombo : 0);

                let pp_fc = null;
                const isFC = score.perfect || (score.accuracy === 1) || (!score.isStatsEstimated && miss === 0 && score.max_combo !== null && score.max_combo >= beatmap_max_combo - 2);
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

                const embed = await doOsuTopSingleEmbed(message, score, pre_calculated, scoreIndex, total_plays, osu_userdata.parsed_args, ppThresholdCount, locale, currentScoreMode);
                map.free();
                return embed;
            };

            const initialEmbed = await processScore(index);

            const getSingleButtonsRow = (curr, max, scoreObj, renderDisabled = false) => {
                return buildTopSingleButtonsRow(curr, max, scoreObj, renderDisabled, currentScoreMode);
            };

            let sent_message;
            if (sentMessage && typeof sentMessage.edit === 'function') {
                sent_message = await sentMessage.edit({
                    content: content_msg,
                    embeds: [initialEmbed],
                    components: getSingleButtonsRow(index, total_plays, filtered_scores[index - 1])
                });
            } else {
                sent_message = await message.reply({
                    content: content_msg,
                    embeds: [initialEmbed],
                    components: getSingleButtonsRow(index, total_plays, filtered_scores[index - 1])
                });
            }

            const filter = btnInt => btnInt.user.id === message.author.id;
            const collector = sent_message.createMessageComponentCollector({
                filter,
                idle: 30000
            });

            collector.on('collect', async i => {
                try {
                    if (i.customId === 'top_render') {
                        const currentScore = filtered_scores[index - 1];
                        try {
                            const updatedComponents = getSingleButtonsRow(index, total_plays, currentScore, true);
                            if (typeof i.update === 'function') {
                                await i.update({ components: updatedComponents });
                            } else {
                                await i.deferUpdate();
                            }
                        } catch (err) {
                            console.error("Error al deshabilitar el botón de render en top:", err);
                            try { await i.deferUpdate(); } catch {}
                        }
                        const infoMsg = await i.channel.send(`📥 **[o!rdr]** Preparando renderizado para la jugada de **${currentScore.user?.username || 'Usuario'}**...`);
                        
                        try {
                            const scoreId = currentScore.id;
                            const replayBuffer = await OsuUserModel.downloadReplay(scoreId, currentScore.mode || osu_userdata.parsed_args?.gamemode || 'osu');
                            
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
                            
                            let beatmapInfo = null;
                            try {
                                const { getBeatmap } = require("../../utils/osu.js");
                                beatmapInfo = await getBeatmap(currentScore.beatmap.id);
                            } catch (err) {
                                console.warn("[top_render] No se pudo obtener metadatos adicionales del beatmap:", err.message);
                            }

                            const username = currentScore.user?.username || osu_userdata.parsed_args.username?.[0] || 'Usuario';
                            const artist = currentScore.beatmapset?.artist || beatmapInfo?.beatmapset?.artist || '';
                            const title = currentScore.beatmapset?.title || beatmapInfo?.beatmapset?.title || '';
                            const version = currentScore.beatmap?.version || beatmapInfo?.version || '';
                            const stars = (currentScore.beatmap?.difficulty_rating || beatmapInfo?.difficulty_rating)
                                ? ` (${(currentScore.beatmap?.difficulty_rating || beatmapInfo?.difficulty_rating).toFixed(2)}★)`
                                : '';
                            const modsString = currentScore.mods && currentScore.mods.length > 0 ? ` +${formatMods(currentScore.mods)}` : '';
                            const accuracy = currentScore.accuracy ? ` | Accuracy: ${(currentScore.accuracy * 100).toFixed(2)}%` : '';
                            const customDescription = `${username} on ${artist} - ${title} [${version}]${stars}${modsString}${accuracy}`;

                            await renderCmd.startRenderFlow(
                                mockMessages,
                                replayBuffer,
                                `recent_${scoreId}.osr`,
                                { skin: 'default', resolution: '1280x720', skinSpecified: false, customDescription },
                                locale
                            );
                            
                        } catch (err) {
                            console.error("Error al descargar replay de Top Play:", err);
                            await infoMsg.edit(err.isCooldownError ? `❌ ${err.message}` : `❌ **Error:** ${t(locale, 'render.err_fetch_replay')}`);
                        }
                        return;
                    }

                    await i.deferUpdate();

                    if (i.customId.startsWith('top_toggle_score_')) {
                        currentScoreMode = currentScoreMode === 'classic' ? 'lazer' : 'classic';
                        await OsuUserModel.setPreferredScoreMode(message.author.id, currentScoreMode);
                    } else if (i.customId === 'top_first') {
                        index = 1;
                    } else if (i.customId === 'top_prev') {
                        index = Math.max(1, index - 1);
                    } else if (i.customId === 'top_next') {
                        index = Math.min(total_plays, index + 1);
                    } else if (i.customId === 'top_last') {
                        index = total_plays;
                    }

                    content_msg = t(locale, 'top.showing_score_index', { index, total: total_plays });
                    const embed = await processScore(index);

                    await i.editReply({
                        content: content_msg,
                        embeds: [embed],
                        components: getSingleButtonsRow(index, total_plays, filtered_scores[index - 1])
                    });
                } catch (err) {
                    console.error("Error al navegar single top score:", err);
                }
            });

            collector.on('end', async () => {
                try {
                    await sent_message.edit({ components: [] });
                } catch {}
            });

            return;
        }

        // --- MODO 2: LIST MODE DISPLAY (Por defecto, paginación con -p) ---
        let page = osu_userdata.parsed_args.page || 1;
        const max_pages = Math.ceil(total_plays / 5);
        if (page > max_pages) page = max_pages;
        if (page < 1) page = 1;

        let startIndex = (page - 1) * 5;

        const getListStars = async (chunk) => {
            const { getBeatmap, getBeatmap_osu, calculatePP } = require("../../utils/osu.js");
            return Promise.all(chunk.map(async (score) => {
                if (score.mods.length === 0) {
                    return score.beatmap.difficulty_rating;
                }
                try {
                    const beatmap = await getBeatmap(score.beatmap.id);
                    const map = await getBeatmap_osu(score.beatmapset.id, score.beatmap.id, beatmap);
                    const maxAttrs = calculatePP(score, map, "maximo_pp");
                    const stars = maxAttrs.difficulty.stars;
                    map.free();
                    return stars;
                } catch (e) {
                    return score.beatmap.difficulty_rating;
                }
            }));
        };

        const initialChunk = filtered_scores.slice(startIndex, startIndex + 5);
        const initialStars = await getListStars(initialChunk);
        const initialListEmbed = await doOsuTopListEmbed(message, osu_userdata.parsed_args, initialChunk, startIndex, total_plays, ppThresholdCount, initialStars, locale);

        const getListButtonsRow = (start, total) => {
            return buildPaginationRow({ prefix: 'rsl', current: start, total, pageSize: 5 });
        };

        let sent_message;
        if (sentMessage && typeof sentMessage.edit === 'function') {
            sent_message = await sentMessage.edit({
                embeds: [initialListEmbed],
                components: [getListButtonsRow(startIndex, total_plays)]
            });
        } else {
            sent_message = await message.reply({
                embeds: [initialListEmbed],
                components: [getListButtonsRow(startIndex, total_plays)]
            });
        }

        const filter = btnInt => btnInt.user.id === message.author.id;
        const collector = sent_message.createMessageComponentCollector({
            filter,
            idle: 60000
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
                const embed = await doOsuTopListEmbed(message, osu_userdata.parsed_args, chunk, startIndex, total_plays, ppThresholdCount, stars, locale);

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
            } catch {}
        });

        return;
    }

    if (!userScores || userScores.length === 0) {
        const embedResult = doOsuSnipesEmbed(message, null, osu_userdata.fn_response, locale);
        if (sentMessage && typeof sentMessage.edit === 'function') {
            await sentMessage.edit({ content: null, embeds: embedResult.embeds || [embedResult] });
            return;
        }
        return embedResult;
    }

    const modsCount = {};
    const datesSet = {};
    let totalPP = 0;
    let countWithPP = 0;

    // Métricas detalladas si isDetailed === true
    const starsList = [];
    if (isDetailed) {
        userScores.forEach(s => {
            const stars = s.ranked_beatmaps?.stars ? parseFloat(s.ranked_beatmaps.stars) : 0;
            if (stars > 0) starsList.push(stars);
        });
        starsList.sort((a, b) => a - b);
    }

    let minStars = 1;
    let maxStars = 8;
    if (starsList.length > 0) {
        const p05Idx = Math.floor(starsList.length * 0.005);
        const p995Idx = Math.min(starsList.length - 1, Math.floor(starsList.length * 0.995));
        minStars = starsList[p05Idx];
        maxStars = starsList[p995Idx];
        if (minStars === maxStars) {
            minStars = starsList[0];
            maxStars = starsList[starsList.length - 1];
            if (minStars === maxStars) {
                maxStars = minStars + 5;
            }
        }
    }

    const numBuckets = 15;
    const range = maxStars - minStars;
    const step = range / numBuckets;

    const buckets = [];
    const starRanges = {};
    for (let i = 0; i < numBuckets; i++) {
        const key = `b${i+1}`;
        const limitStart = minStars + i * step;
        const limitEnd = minStars + (i + 1) * step;

        let label;
        if (i === 0) {
            label = `${limitEnd.toFixed(1)}★-`;
        } else if (i === numBuckets - 1) {
            label = `${limitStart.toFixed(1)}★+`;
        } else {
            label = `${limitStart.toFixed(1)}-${limitEnd.toFixed(1)}★`;
        }

        buckets.push({ key, label, min: limitStart, max: limitEnd });
        starRanges[key] = 0;
    }
    const mappersCount = {};
    let totalBPM = 0, totalAR = 0, totalOD = 0, totalCS = 0;
    let bpmCount = 0, arCount = 0, odCount = 0, csCount = 0;
    let minBPM = Infinity, minBPM_mapId = null;
    let maxBPM = -Infinity, maxBPM_mapId = null;
    let minAR = Infinity, minAR_mapId = null;
    let maxAR = -Infinity, maxAR_mapId = null;
    let minOD = Infinity, minOD_mapId = null;
    let maxOD = -Infinity, maxOD_mapId = null;
    let minCS = Infinity, minCS_mapId = null;
    let maxCS = -Infinity, maxCS_mapId = null;
    let minPP = Infinity, minPP_mapId = null;
    let maxPP = -Infinity, maxPP_mapId = null;
    let oldestScore = null;
    let newestScore = null;

    if (isDetailed) {
        await updateProgress(1, 'loading');
    }

    userScores.forEach(s => {
        // Agrupar mods
        const modsStr = s.mods || 'NM';
        if (modsStr === 'NM') {
            modsCount['NM'] = (modsCount['NM'] || 0) + 1;
        } else {
            const modsArr = modsStr.match(/.{1,2}/g) || [];
            modsArr.forEach(mod => {
                modsCount[mod] = (modsCount[mod] || 0) + 1;
            });
        }

        // Agrupar por año
        if (s.ended_at && s.ended_at !== new Date(0).toISOString()) {
            const year = new Date(s.ended_at).getFullYear();
            datesSet[year] = (datesSet[year] || 0) + 1;
        }

        // Promedio de PP
        if (typeof s.pp === 'number' && s.pp > 0) {
            totalPP += s.pp;
            countWithPP++;
            if (s.pp < minPP) {
                minPP = s.pp;
                minPP_mapId = s.beatmap_id;
            }
            if (s.pp > maxPP) {
                maxPP = s.pp;
                maxPP_mapId = s.beatmap_id;
            }
        }

        if (isDetailed) {
            // Estrellas
            const stars = s.ranked_beatmaps?.stars ? parseFloat(s.ranked_beatmaps.stars) : 0;
            if (stars > 0) {
                let assigned = false;
                for (let i = 0; i < numBuckets; i++) {
                    const b = buckets[i];
                    if (i === 0) {
                        if (stars < b.max) {
                            starRanges[b.key]++;
                            assigned = true;
                            break;
                        }
                    } else if (i === numBuckets - 1) {
                        if (stars >= b.min) {
                            starRanges[b.key]++;
                            assigned = true;
                            break;
                        }
                    } else {
                        if (stars >= b.min && stars < b.max) {
                            starRanges[b.key]++;
                            assigned = true;
                            break;
                        }
                    }
                }
                if (!assigned) {
                    starRanges[`b${numBuckets}`]++;
                }
            } else {
                starRanges['b1']++;
            }

            // Mappers
            const creator = s.ranked_beatmaps?.creator;
            if (creator) {
                mappersCount[creator] = (mappersCount[creator] || 0) + 1;
            }

            // Specs
            const map = s.ranked_beatmaps;
            if (map) {
                if (typeof map.bpm === 'number' && map.bpm > 0) {
                    totalBPM += map.bpm;
                    bpmCount++;
                    if (map.bpm < minBPM) {
                        minBPM = map.bpm;
                        minBPM_mapId = s.beatmap_id;
                    }
                    if (map.bpm > maxBPM) {
                        maxBPM = map.bpm;
                        maxBPM_mapId = s.beatmap_id;
                    }
                }
                if (typeof map.ar === 'number' || typeof map.ar === 'string') {
                    const val = parseFloat(map.ar);
                    if (!isNaN(val)) {
                        totalAR += val;
                        arCount++;
                        if (val < minAR) {
                            minAR = val;
                            minAR_mapId = s.beatmap_id;
                        }
                        if (val > maxAR) {
                            maxAR = val;
                            maxAR_mapId = s.beatmap_id;
                        }
                    }
                }
                if (typeof map.od === 'number' || typeof map.od === 'string') {
                    const val = parseFloat(map.od);
                    if (!isNaN(val)) {
                        totalOD += val;
                        odCount++;
                        if (val < minOD) {
                            minOD = val;
                            minOD_mapId = s.beatmap_id;
                        }
                        if (val > maxOD) {
                            maxOD = val;
                            maxOD_mapId = s.beatmap_id;
                        }
                    }
                }
                if (typeof map.cs === 'number' || typeof map.cs === 'string') {
                    const val = parseFloat(map.cs);
                    if (!isNaN(val)) {
                        totalCS += val;
                        csCount++;
                        if (val < minCS) {
                            minCS = val;
                            minCS_mapId = s.beatmap_id;
                        }
                        if (val > maxCS) {
                            maxCS = val;
                            maxCS_mapId = s.beatmap_id;
                        }
                    }
                }
            }

            // Hitos temporales
            if (s.ended_at && s.ended_at !== new Date(0).toISOString()) {
                const time = new Date(s.ended_at).getTime();
                if (!oldestScore || time < new Date(oldestScore.ended_at).getTime()) {
                    oldestScore = s;
                }
                if (!newestScore || time > new Date(newestScore.ended_at).getTime()) {
                    newestScore = s;
                }
            }
        }
    });

    if (isDetailed) {
        await updateProgress(1, 'success');
        await updateProgress(2, 'loading');
    }

    const averagePP = countWithPP > 0 ? (totalPP / countWithPP) : 0;

    const adaptedData = {
        count_total: userScores.length,
        average_pp: averagePP,
        mods_count: modsCount,
        dates_set: datesSet,
        is_detailed: isDetailed
    };

    if (isDetailed) {
        adaptedData.star_ranges = {};
        buckets.forEach(b => {
            adaptedData.star_ranges[b.label] = starRanges[b.key];
        });
        adaptedData.top_mappers = Object.entries(mappersCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        adaptedData.avg_bpm = bpmCount > 0 ? (totalBPM / bpmCount) : 0;
        adaptedData.avg_ar = arCount > 0 ? (totalAR / arCount) : 0;
        adaptedData.avg_od = odCount > 0 ? (totalOD / odCount) : 0;
        adaptedData.avg_cs = csCount > 0 ? (totalCS / csCount) : 0;

        adaptedData.min_bpm = minBPM !== Infinity ? minBPM : 0;
        adaptedData.max_bpm = maxBPM !== -Infinity ? maxBPM : 0;
        adaptedData.min_bpm_mapId = minBPM_mapId;
        adaptedData.max_bpm_mapId = maxBPM_mapId;

        adaptedData.min_ar = minAR !== Infinity ? minAR : 0;
        adaptedData.max_ar = maxAR !== -Infinity ? maxAR : 0;
        adaptedData.min_ar_mapId = minAR_mapId;
        adaptedData.max_ar_mapId = maxAR_mapId;

        adaptedData.min_od = minOD !== Infinity ? minOD : 0;
        adaptedData.max_od = maxOD !== -Infinity ? maxOD : 0;
        adaptedData.min_od_mapId = minOD_mapId;
        adaptedData.max_od_mapId = maxOD_mapId;

        adaptedData.min_cs = minCS !== Infinity ? minCS : 0;
        adaptedData.max_cs = maxCS !== -Infinity ? maxCS : 0;
        adaptedData.min_cs_mapId = minCS_mapId;
        adaptedData.max_cs_mapId = maxCS_mapId;

        adaptedData.min_pp = minPP !== Infinity ? minPP : 0;
        adaptedData.max_pp = maxPP !== -Infinity ? maxPP : 0;
        adaptedData.min_pp_mapId = minPP_mapId;
        adaptedData.max_pp_mapId = maxPP_mapId;

        adaptedData.oldest_score = oldestScore;
        adaptedData.newest_score = newestScore;
    }

    const finalResult = doOsuSnipesEmbed(message, adaptedData, osu_userdata.fn_response, locale);
    if (sentMessage && typeof sentMessage.edit === 'function') {
        if (isDetailed) {
            await updateProgress(2, 'success');
        }
        await sentMessage.edit({ content: null, embeds: finalResult.embeds, files: finalResult.files || [] });
        return;
    }
    return finalResult;
}

run.description = {
    'header': t('es', 'commands.snipes.header'),
    'body': t('es', 'commands.snipes.body'),
    'usage': t('es', 'commands.snipes.usage')
};

module.exports = { run, "description": run.description };