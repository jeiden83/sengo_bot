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

    // Inicializar barra de progreso
    let sentMessage = null;
    const processStartTime = Date.now();
    let stepStartTime = Date.now();
    const activeSteps = [];

    const stepTemplates = isNemesis
        ? (locale === 'es' ? ["Obteniendo historial de snipes..."] : ["Fetching snipes history..."])
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
        userScores = await OsuScoreModel.getUserNationalTops(id, look_gamemode, country_code, isDetailed, (count) => {
            updateProgress(0, 'loading', `(${count} cargados...)`);
        });
        await updateProgress(0, 'success', `(${userScores.length} cargados)`);
    } catch (errUserScores) {
        console.error("Error al obtener puntuaciones del usuario en snipes.js:", errUserScores);
        await updateProgress(0, 'error', `(${t(locale, 'snipes.err_db_scores')})`);
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