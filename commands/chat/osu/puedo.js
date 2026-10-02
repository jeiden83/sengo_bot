const { getBeatmap_osu, findBeatmapInChannel } = require("../../utils/osu.js");
const BeatmapModel = require("../../../models/BeatmapModel.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const OsuScoreModel = require("../../../models/OsuScoreModel.js");
const SkillsModel = require("../../../models/SkillsModel.js");
const ppEngine = require("../../../utils/ppEngine.js");
const { doOsuPuedoEmbed } = require("../../../views/osuPuedoViews.js");
const { t } = require("../../../utils/i18n.js");

function parsePuedoArgs(args) {
    const options = {
        beatmapId: null,
        mods: null,
        targetUser: null,
        mode: null
    };

    const argsList = Array.isArray(args) ? args : String(args || '').split(/\s+/);

    for (let i = 0; i < argsList.length; i++) {
        const arg = argsList[i];
        if (typeof arg !== 'string') continue;
        const clean = arg.trim();
        const lower = clean.toLowerCase();

        // 1. Beatmap URL o ID directo
        const urlMatch = clean.match(/osu\.ppy\.sh\/b(?:eatmaps)?\/(\d+)/) ||
                         clean.match(/osu\.ppy\.sh\/beatmapsets\/\d+#(?:osu|taiko|fruits|mania)\/(\d+)/);
        if (urlMatch) {
            options.beatmapId = urlMatch[1];
            continue;
        }

        const setMatch = clean.match(/osu\.ppy\.sh\/beatmapsets\/(\d+)/);
        if (setMatch) {
            options.beatmapId = `set/${setMatch[1]}`;
            continue;
        }

        if (/^\d{5,10}$/.test(clean) && !options.beatmapId) {
            options.beatmapId = clean;
            continue;
        }

        // 2. Mods (+HDDT / + HDDT / -mods HDDT / -m HDDT)
        if (clean.startsWith('+') && !/^\+\d+$/.test(clean)) {
            let modStr = clean.slice(1).trim();
            if (!modStr && i + 1 < argsList.length && !argsList[i + 1].startsWith('-') && !argsList[i + 1].startsWith('+')) {
                modStr = argsList[++i].trim();
            }
            if (modStr) {
                const sanitized = modStr.toUpperCase().replace(/[^A-Z0-9]/g, '');
                options.mods = options.mods ? `${options.mods}${sanitized}` : sanitized;
            }
            continue;
        }
        if ((lower === '-mods' || (lower === '-m' && !/^\d+$/.test(argsList[i + 1] || ''))) && i + 1 < argsList.length) {
            const sanitized = argsList[i + 1].toUpperCase().replace(/[^A-Z0-9]/g, '');
            options.mods = options.mods ? `${options.mods}${sanitized}` : sanitized;
            i++;
            continue;
        }

        // 3. Modos (-modo / -mode)
        if ((lower === '-modo' || lower === '-mode') && i + 1 < argsList.length) {
            options.mode = argsList[i + 1].toLowerCase();
            i++;
            continue;
        }
        if (lower === '-ctb' || lower === '-catch' || lower === '-fruits') { options.mode = 'fruits'; continue; }
        if (lower === '-taiko') { options.mode = 'taiko'; continue; }
        if (lower === '-mania') { options.mode = 'mania'; continue; }
        if (lower === '-std' || lower === '-osu') { options.mode = 'osu'; continue; }

        // 4. Usuario o mención
        if (clean.startsWith('<@') && clean.endsWith('>')) {
            const idMatch = clean.match(/\d+/);
            if (idMatch) options.targetUser = idMatch[0];
            continue;
        }

        // Si no empieza con -, +, y no es beatmap ni flag conocida, interpretar como nombre de usuario
        if (!clean.startsWith('-') && !clean.startsWith('+') && !options.targetUser) {
            options.targetUser = clean;
        }
    }

    return options;
}

function calculateProbabilities({ user, topScores, beatmap, bestScore, activeModsStr = 'NM', diffAttrs }) {
    const mode = beatmap.mode || 'osu';
    const pushProfile = SkillsModel.analyzePlayerPushProfile(topScores, mode);
    const userSkills = SkillsModel.analyzeSkills(topScores, false, mode);
    const mapSkills = SkillsModel.estimateMapSkills(beatmap, activeModsStr, mode);

    const mapSR = Number(diffAttrs?.stars || beatmap.difficulty_rating || 5.0);
    const mapBPM = mapSkills.effBPM || beatmap.bpm || 180;
    const mapCombo = diffAttrs?.maxCombo || beatmap.max_combo || 500;
    const effAR = mapSkills.effAR || beatmap.ar || 9.0;
    const effOD = mapSkills.effOD || beatmap.accuracy || 8.0;

    const topSRs = topScores.map(s => Number(s.beatmap?.difficulty_rating || 0)).filter(sr => sr > 0);
    const avgTopSR = topSRs.length > 0 ? (topSRs.reduce((a, b) => a + b, 0) / topSRs.length) : pushProfile.avgPlayedStars;

    let playedBefore = false;
    let passedBefore = false;
    let usedNF = false;
    let prevScore = null;

    if (bestScore && bestScore.score) {
        playedBefore = true;
        prevScore = bestScore.score;
        const modsList = Array.isArray(prevScore.mods)
            ? prevScore.mods.map(m => (typeof m === 'string' ? m : m.acronym || ''))
            : [];
        usedNF = modsList.includes('NF');
        passedBefore = prevScore.passed !== false && !['F'].includes(prevScore.rank);
    }

    // --- CÁLCULO DE PROBABILIDAD DE PASS ---
    let passProb = 50;

    const srDelta = mapSR - pushProfile.pushStars;
    if (srDelta <= -0.5) passProb = 95;
    else if (srDelta <= 0) passProb = 85 + ((-srDelta) / 0.5) * 10;
    else if (srDelta <= 0.3) passProb = 70 - (srDelta / 0.3) * 20;
    else if (srDelta <= 0.7) passProb = 50 - ((srDelta - 0.3) / 0.4) * 30;
    else if (srDelta <= 1.2) passProb = 20 - ((srDelta - 0.7) / 0.5) * 15;
    else passProb = Math.max(1, 5 - (srDelta - 1.2) * 5);

    // Factor Speed / BPM
    const estimatedComfortBPM = 160 + (userSkills.speed || 40) * 1.2;
    if (mapBPM > estimatedComfortBPM) {
        const bpmOver = mapBPM - estimatedComfortBPM;
        const speedPenalty = Math.min(45, (bpmOver / 40) * 30);
        passProb -= speedPenalty;
    } else {
        passProb += Math.min(10, ((estimatedComfortBPM - mapBPM) / 40) * 8);
    }

    // Factor Densidad de Streams
    if (mapSkills.streamDensity > 0.6 && (userSkills.speed || 40) < 45) {
        passProb -= (mapSkills.streamDensity - 0.6) * 25;
    }

    // Factor Lectura High AR
    if (effAR > 10.2 && (userSkills.reading || 1) < 20) {
        passProb -= (effAR - 10.2) * 15;
    }

    // Historial previo
    if (passedBefore && !usedNF) {
        passProb = Math.max(88, Math.min(99, passProb + 40));
    } else if (playedBefore && usedNF) {
        const prevAcc = (prevScore.accuracy || 0.8) * 100;
        if (prevAcc >= 92) passProb = Math.max(65, passProb + 25);
        else if (prevAcc >= 85) passProb = Math.max(40, passProb + 10);
        else passProb = Math.min(passProb, 30);
    }

    passProb = Math.max(1, Math.min(99, Math.round(passProb)));

    // --- CÁLCULO DE PROBABILIDAD DE FC ---
    let fcProb = 10;
    const fcSrDelta = mapSR - avgTopSR;

    if (fcSrDelta <= -0.5) fcProb = 75;
    else if (fcSrDelta <= 0) fcProb = 50 - (fcSrDelta / -0.5) * 20;
    else if (fcSrDelta <= 0.4) fcProb = 30 - (fcSrDelta / 0.4) * 20;
    else if (fcSrDelta <= 0.8) fcProb = 10 - ((fcSrDelta - 0.4) / 0.4) * 8;
    else fcProb = Math.max(0.1, 2 - (fcSrDelta - 0.8) * 2);

    if (mapCombo > 1200) fcProb *= 0.5;
    else if (mapCombo > 800) fcProb *= 0.75;

    if (pushProfile.isChokePusher) fcProb *= 0.8;
    if (mapBPM > estimatedComfortBPM + 15) fcProb *= 0.3;

    if (playedBefore) {
        const comboRatio = (prevScore.max_combo || 0) / Math.max(1, mapCombo);
        const prevMisses = Number(prevScore.statistics?.count_miss || prevScore.statistics?.miss || 0);
        if (prevMisses > 10 || comboRatio < 0.25) {
            fcProb = Math.min(fcProb, 5);
        }
    }

    fcProb = Math.max(0.1, Math.min(95, Number(fcProb.toFixed(1))));

    return {
        passProb,
        fcProb,
        playedBefore,
        passedBefore,
        usedNF,
        prevScore: prevScore ? {
            rank: prevScore.rank,
            acc: ((prevScore.accuracy || 0) * 100).toFixed(2) + '%',
            combo: `${prevScore.max_combo || 0}x/${mapCombo}x`,
            mods: prevScore.mods
        } : null,
        map: {
            sr: mapSR,
            bpm: mapBPM,
            combo: mapCombo,
            ar: effAR,
            od: effOD
        },
        factors: {
            pushStars: pushProfile.pushStars,
            userAim: userSkills.aim || 50,
            userSpeed: userSkills.speed || 50,
            estimatedComfortBPM: Math.round(estimatedComfortBPM),
            bpmOver: Math.max(0, mapBPM - Math.round(estimatedComfortBPM)),
            avgAcc: pushProfile.avgAcc
        }
    };
}

async function run(messages, args) {
    const { message, res, reply, logger } = messages;
    const locale = message.locale || 'es';

    const options = parsePuedoArgs(args);
    let targetBeatmapId = options.beatmapId;

    // Si hay un mensaje referenciado (reply)
    if (message.reference && message.reference.messageId) {
        try {
            const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
            if (repliedMsg && repliedMsg.embeds && repliedMsg.embeds.length > 0) {
                const embed = repliedMsg.embeds[0];
                const { parsePlayEmbed } = require("./rework.js");
                const playFromReply = parsePlayEmbed(embed);
                if (playFromReply && playFromReply.beatmapId) {
                    if (!targetBeatmapId) targetBeatmapId = playFromReply.beatmapId;
                    if (!options.mods && playFromReply.mods && playFromReply.mods.length > 0) {
                        options.mods = playFromReply.mods.join('');
                    }
                } else if (embed.url) {
                    const match = embed.url.match(/osu\.ppy\.sh\/b(?:eatmaps)?\/(\d+)/) ||
                                  embed.url.match(/osu\.ppy\.sh\/beatmapsets\/\d+#(?:osu|taiko|fruits|mania)\/(\d+)/);
                    if (match && !targetBeatmapId) targetBeatmapId = match[1];
                }
            }
        } catch (e) {}
    }

    // Si aún no tenemos ID de mapa, buscar en el canal
    if (!targetBeatmapId) {
        const channelResult = reply
            ? await findBeatmapInChannel(reply, true)
            : await findBeatmapInChannel(message, false);

        if (channelResult && channelResult.beatmap_url) {
            const rawUrl = String(channelResult.beatmap_url);
            const match = rawUrl.match(/b(?:eatmaps)?\/(\d+)/) ||
                          rawUrl.match(/#(?:\w+)\/(\d+)/) ||
                          rawUrl.match(/^(\d+)$/);
            if (match) {
                targetBeatmapId = match[1];
            } else if (!rawUrl.startsWith('set/')) {
                targetBeatmapId = rawUrl;
            }
        }
    }

    if (!targetBeatmapId) {
        return t(locale, 'puedo.err_no_map') || '❌ No se encontró ningún beatmap para analizar. Especifica un link o responde a un mensaje con un mapa.';
    }

    await OsuUserModel.NewloadToken();

    // Resolver usuario de osu!
    let osuUser = null;
    try {
        if (options.targetUser) {
            osuUser = await OsuUserModel.getOsuUser({ username: [options.targetUser], gamemode: options.mode || 'osu', server: 'bancho' });
        } else {
            // Intentar con usuario vinculado del autor
            osuUser = await OsuUserModel.getOsuUser({ discord_id: message.author.id, gamemode: options.mode || 'osu', server: 'bancho' });
            if (!osuUser || !osuUser.id) {
                osuUser = await OsuUserModel.getOsuUser({ username: [message.author.username], gamemode: options.mode || 'osu', server: 'bancho' });
            }
        }
    } catch (e) {}

    if (!osuUser || !osuUser.id) {
        return t(locale, 'puedo.err_no_user') || '❌ No se encontró tu cuenta de osu! vinculada ni el usuario especificado. Usa `s.link` para vincular tu cuenta.';
    }

    // Obtener información del beatmap
    let beatmapData = null;
    let actualBeatmapId = targetBeatmapId;

    if (String(targetBeatmapId).startsWith('set/')) {
        const setId = targetBeatmapId.replace('set/', '');
        const setDetails = await BeatmapModel.getBeatmapset(setId).catch(() => null);
        if (setDetails && setDetails.beatmaps && setDetails.beatmaps.length > 0) {
            // Ordenar por SR descendente para tomar la dificultad más alta
            const sorted = [...setDetails.beatmaps].sort((a, b) => (b.difficulty_rating || 0) - (a.difficulty_rating || 0));
            actualBeatmapId = sorted[0].id;
            beatmapData = sorted[0];
            beatmapData.beatmapset = setDetails;
        }
    } else {
        beatmapData = await BeatmapModel.getBeatmap(actualBeatmapId).catch(() => null);
        if (!beatmapData) {
            const setDetails = await BeatmapModel.getBeatmapset(actualBeatmapId).catch(() => null);
            if (setDetails && setDetails.beatmaps && setDetails.beatmaps.length > 0) {
                const sorted = [...setDetails.beatmaps].sort((a, b) => (b.difficulty_rating || 0) - (a.difficulty_rating || 0));
                actualBeatmapId = sorted[0].id;
                beatmapData = sorted[0];
                beatmapData.beatmapset = setDetails;
            }
        }
    }

    if (!beatmapData || !beatmapData.id) {
        return t(locale, 'puedo.err_fetch_map') || '❌ No se pudo obtener la información del mapa seleccionado.';
    }

    const targetMode = options.mode || beatmapData.mode || 'osu';
    const cleanMods = options.mods ? options.mods.toUpperCase().replace(/[^A-Z0-9]/g, '') : 'NM';
    const activeModsStr = cleanMods === '' ? 'NM' : cleanMods;

    // Calcular atributos precisos con el motor de PP si hay mods
    let diffAttrs = null;
    try {
        const engine = ppEngine.getEngine();
        const map = await getBeatmap_osu(beatmapData.beatmapset_id || beatmapData.beatmapset?.id, beatmapData.id, beatmapData);
        if (map) {
            diffAttrs = new engine.Difficulty({ mods: activeModsStr }).calculate(map);
            map.free();
        }
    } catch (e) {}

    // Obtener top scores y mejor puntuación en el mapa
    const [topScores, bestScore] = await Promise.all([
        OsuScoreModel.getUserTopScores({ username: [String(osuUser.id)], gamemode: targetMode, server: 'bancho' }).catch(() => []),
        OsuScoreModel.getUserBeatmapBest(beatmapData.id, osuUser.id, targetMode).catch(() => null)
    ]);

    const analysis = calculateProbabilities({
        user: osuUser,
        topScores: Array.isArray(topScores) ? topScores : [],
        beatmap: beatmapData,
        bestScore,
        activeModsStr,
        diffAttrs
    });

    const embed = doOsuPuedoEmbed({
        message,
        user: osuUser,
        map: {
            ...beatmapData,
            artist: beatmapData.beatmapset?.artist,
            title: beatmapData.beatmapset?.title,
            covers: beatmapData.beatmapset?.covers
        },
        analysis,
        activeModsStr,
        locale
    });

    if (reply) {
        reply.reply({ embeds: [embed] });
        return;
    }
    return { embeds: [embed] };
}

run.description = "Determina si te puedes pasar o fcear un beatmap analizando tus skills, historial y cinemática.";
run.alias = {
    "canipass": {},
    "pass": {},
    "fcear": {},
    "canifc": {},
    "puedopasar": {}
};
run.flags = ["+mods", "-mods", "-modo", "-server"];

module.exports = { run, parsePuedoArgs, calculateProbabilities, description: run.description, alias: run.alias, flags: run.flags };
