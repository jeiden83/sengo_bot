const { getBeatmap_osu, findBeatmapInChannel } = require("../../utils/osu.js");
const BeatmapModel = require("../../../models/BeatmapModel.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const rosu = require("rosu-pp-js");
const { v2 } = require('osu-api-extended');
const { doOsuEmbed } = require("../../../views/osuEmbeds.js");
const { t } = require("../../../utils/i18n.js");
const config = require("../../../config.js");

function solveHits({ totalObjects, targetAcc, misses = 0, fixed300 = null, fixed100 = null, fixed50 = null, mode = 'osu' }) {
    const N = totalObjects;
    const nMiss = Math.min(misses, N);
    const H = N - nMiss;

    if (H <= 0) {
        return { count300: 0, count100: 0, count50: 0, misses: N, accuracy: 0 };
    }

    let bestDiff = Infinity;
    let bestResult = { count300: H, count100: 0, count50: 0, misses: nMiss, accuracy: 100 };

    if (targetAcc === null || targetAcc === undefined) {
        let c100 = fixed100 !== null ? fixed100 : 0;
        let c50 = fixed50 !== null ? fixed50 : 0;
        let c300 = fixed300 !== null ? fixed300 : Math.max(0, H - c100 - c50);
        let acc = ((300 * c300 + 100 * c100 + 50 * c50) / (300 * N)) * 100;
        return { count300: c300, count100: c100, count50: c50, misses: nMiss, accuracy: acc };
    }

    const min100 = fixed100 !== null ? fixed100 : 0;
    const max100 = fixed100 !== null ? fixed100 : H;

    for (let c100 = min100; c100 <= max100; c100++) {
        const remainingFor50 = H - c100;
        if (remainingFor50 < 0) continue;

        const min50 = fixed50 !== null ? fixed50 : 0;
        const max50 = fixed50 !== null ? fixed50 : remainingFor50;

        for (let c50 = min50; c50 <= max50; c50++) {
            const c300 = H - c100 - c50;
            if (c300 < 0) continue;
            if (fixed300 !== null && c300 !== fixed300) continue;

            let acc = 0;
            if (mode === 'osu' || mode === 0) {
                acc = ((300 * c300 + 100 * c100 + 50 * c50) / (300 * N)) * 100;
            } else if (mode === 'taiko' || mode === 1) {
                acc = ((c300 + 0.5 * c100) / N) * 100;
            } else {
                acc = ((300 * c300 + 100 * c100 + 50 * c50) / (300 * N)) * 100;
            }

            const diff = Math.abs(acc - targetAcc);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestResult = { count300: c300, count100: c100, count50: c50, misses: nMiss, accuracy: acc };
                if (diff < 0.001) break;
            }
        }
        if (bestDiff < 0.001) break;
    }

    return bestResult;
}

function calculateGrade(accuracy, misses, combo, maxCombo) {
    if (misses === 0 && combo >= maxCombo) {
        if (accuracy >= 100.0) return 'X';
        if (accuracy >= 95.0) return 'S';
        return 'S';
    }
    if (accuracy >= 95.0 && misses === 0) return 'S';
    if (accuracy >= 90.0) return 'A';
    if (accuracy >= 80.0) return 'B';
    if (accuracy >= 70.0) return 'C';
    return 'D';
}

function parseSimArgs(args) {
    const options = {
        beatmapId: null,
        mods: null,
        accuracy: null,
        misses: null,
        combo: null,
        mode: null,
        fixed300: null,
        fixed100: null,
        fixed50: null,
        isFC: false
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
        if (/^\d{5,10}$/.test(clean) && !options.beatmapId) {
            options.beatmapId = clean;
            continue;
        }

        // 2. Full Combo Flag (-fc / fc)
        if (lower === '-fc' || lower === 'fc') {
            options.isFC = true;
            continue;
        }

        // 3. Mods (+HDDT / -mods HDDT / -m HDDT)
        if (clean.startsWith('+') && clean.length > 1 && !/^\+\d+$/.test(clean)) {
            options.mods = clean.slice(1).toUpperCase();
            continue;
        }
        if ((lower === '-mods' || lower === '-m') && i + 1 < argsList.length) {
            options.mods = argsList[i + 1].toUpperCase().replace(/[^A-Z]/g, '');
            i++;
            continue;
        }

        // 4. Accuracy (-acc 99 / 99% / 99.5%)
        if ((lower === '-acc' || lower === '--acc') && i + 1 < argsList.length) {
            const val = parseFloat(argsList[i + 1].replace('%', ''));
            if (!isNaN(val)) options.accuracy = val;
            i++;
            continue;
        }
        if (/^\d+(?:\.\d+)?%$/.test(clean)) {
            const val = parseFloat(clean.replace('%', ''));
            if (!isNaN(val)) options.accuracy = val;
            continue;
        }

        // 5. Misses (-misses 5 / 5m / 5x)
        if ((lower === '-misses' || lower === '-miss' || lower === '-m') && i + 1 < argsList.length && /^\d+$/.test(argsList[i + 1])) {
            options.misses = parseInt(argsList[i + 1]);
            i++;
            continue;
        }
        if (/^\d+m$/i.test(clean) || /^m\d+$/i.test(clean)) {
            options.misses = parseInt(clean.replace(/m/gi, ''));
            continue;
        }

        // 6. Combo (-combo 500 / 500x / c500 / x500)
        if ((lower === '-combo' || lower === '-c') && i + 1 < argsList.length && /^\d+$/.test(argsList[i + 1])) {
            options.combo = parseInt(argsList[i + 1]);
            i++;
            continue;
        }
        if (/^[xc]\d+$/i.test(clean) || /^\d+x$/i.test(clean)) {
            const val = parseInt(clean.replace(/[xc]/gi, ''));
            if (!isNaN(val)) options.combo = val;
            continue;
        }

        // 7. Modos (-modo CTB / -ctb / -taiko / -mania / -std)
        if ((lower === '-modo' || lower === '-mode') && i + 1 < argsList.length) {
            options.mode = argsList[i + 1].toLowerCase();
            i++;
            continue;
        }
        if (lower === '-ctb' || lower === '-catch' || lower === '-fruits') { options.mode = 'fruits'; continue; }
        if (lower === '-taiko') { options.mode = 'taiko'; continue; }
        if (lower === '-mania') { options.mode = 'mania'; continue; }
        if (lower === '-std' || lower === '-osu') { options.mode = 'osu'; continue; }

        // 8. Hit stats específicos (-n300 300 / -n100 5 / -n50 2)
        if (lower === '-n300' && i + 1 < argsList.length) { options.fixed300 = parseInt(argsList[i + 1]); i++; continue; }
        if (lower === '-n100' && i + 1 < argsList.length) { options.fixed100 = parseInt(argsList[i + 1]); i++; continue; }
        if (lower === '-n50' && i + 1 < argsList.length) { options.fixed50 = parseInt(argsList[i + 1]); i++; continue; }

        // 9. Slash format hits: 300/5/2/1 o parcial x/2/x/1
        if (/^(?:[xX\d]+)\/(?:[xX\d]+)\/(?:[xX\d]+)(?:\/(?:[xX\d]+))?$/.test(clean)) {
            const parts = clean.split('/');
            if (parts[0] !== 'x' && parts[0] !== 'X') options.fixed300 = parseInt(parts[0]);
            if (parts[1] !== 'x' && parts[1] !== 'X') options.fixed100 = parseInt(parts[1]);
            if (parts[2] !== 'x' && parts[2] !== 'X') options.fixed50 = parseInt(parts[2]);
            if (parts.length > 3 && parts[3] !== 'x' && parts[3] !== 'X') options.misses = parseInt(parts[3]);
            continue;
        }
    }

    return options;
}

async function run(messages, args) {
    const { message, res, reply, logger } = messages;
    const locale = message.locale || 'es';

    const simOptions = parseSimArgs(args);

    let repliedMsg = null;
    let targetBeatmapId = simOptions.beatmapId;
    let playFromReply = null;

    if (message.reference && message.reference.messageId) {
        try {
            repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
        } catch (e) {}
    }

    // Si hay un mensaje referenciado (reply)
    if (repliedMsg) {
        const embeds = (repliedMsg.embeds && repliedMsg.embeds.length > 0) ? repliedMsg.embeds : [];
        if (embeds.length > 0) {
            const embed = embeds[0];
            const { parsePlayEmbed } = require("./rework.js");
            playFromReply = parsePlayEmbed(embed);

            // Si es un embed de jugada (s.rs, s.r, s.c)
            if (playFromReply && playFromReply.beatmapId) {
                if (!targetBeatmapId) targetBeatmapId = playFromReply.beatmapId;
                if (!simOptions.mods && playFromReply.mods && playFromReply.mods.length > 0) {
                    simOptions.mods = playFromReply.mods.join('');
                }
                if (simOptions.accuracy === null && playFromReply.accuracy) {
                    simOptions.accuracy = playFromReply.accuracy;
                }
                if (simOptions.combo === null && playFromReply.combo) {
                    simOptions.combo = playFromReply.combo;
                }
                if (simOptions.misses === null && playFromReply.misses !== undefined) {
                    simOptions.misses = playFromReply.misses;
                }

                // Si el usuario incluyó la flag -fc
                if (simOptions.isFC) {
                    simOptions.misses = 0;
                    simOptions.combo = null; // Se calculará al Max Combo del mapa
                }
            } else if (embed.url) {
                const match = embed.url.match(/osu\.ppy\.sh\/b(?:eatmaps)?\/(\d+)/) ||
                              embed.url.match(/osu\.ppy\.sh\/beatmapsets\/\d+#(?:osu|taiko|fruits|mania)\/(\d+)/);
                if (match && !targetBeatmapId) targetBeatmapId = match[1];
            }
        }
    }

    // Si aún no tenemos ID de mapa, buscar en el canal o mensaje referenciado
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
        return t(locale, 'sim.err_no_map');
    }

    // Obtener información del beatmap desde osu! API
    await OsuUserModel.NewloadToken();
    let beatmapData;
    try {
        beatmapData = await BeatmapModel.getBeatmap(targetBeatmapId);
    } catch (e) {
        try {
            const setDetails = await BeatmapModel.getBeatmapset(targetBeatmapId);
            if (setDetails && setDetails.beatmaps && setDetails.beatmaps.length > 0) {
                targetBeatmapId = setDetails.beatmaps[0].id;
                beatmapData = await BeatmapModel.getBeatmap(targetBeatmapId);
            }
        } catch (e2) {}
    }

    if (!beatmapData || !beatmapData.id) {
        return t(locale, 'sim.err_fetch_map');
    }

    // Cargar archivo .osu con rosu-pp-js
    let map;
    try {
        map = await getBeatmap_osu(beatmapData.beatmapset_id, beatmapData.id, beatmapData);
    } catch (e) {
        console.error("Error al cargar .osu para s.sim:", e.message);
        return t(locale, 'sim.err_fetch_map');
    }

    // Aplicar conversión de modo si fue forzado
    const modeNameMap = {
        'osu': rosu.GameMode.Osu,
        'std': rosu.GameMode.Osu,
        'taiko': rosu.GameMode.Taiko,
        'fruits': rosu.GameMode.Catch,
        'ctb': rosu.GameMode.Catch,
        'catch': rosu.GameMode.Catch,
        'mania': rosu.GameMode.Mania
    };
    const requestedModeStr = simOptions.mode || beatmapData.mode;
    const activeMode = modeNameMap[requestedModeStr] !== undefined ? modeNameMap[requestedModeStr] : rosu.GameMode.Osu;

    if (map.mode !== activeMode) {
        map.convert(activeMode);
    }

    const activeModsStr = simOptions.mods || 'NM';

    // Obtener Max Combo y Stars con rosu
    const perfMax = new rosu.Performance({ mods: activeModsStr }).calculate(map);
    const beatmapMaxCombo = perfMax.difficulty.maxCombo || beatmapData.max_combo || 1;
    const totalObjects = map.nObjects || (beatmapData.count_circles + beatmapData.count_sliders + beatmapData.count_spinners) || 100;

    // Determinar Misses y Combo
    const misses = simOptions.misses !== null ? simOptions.misses : 0;
    const combo = simOptions.combo !== null ? simOptions.combo : (misses === 0 ? beatmapMaxCombo : Math.floor(beatmapMaxCombo * 0.9));

    // Resolver aciertos (300s, 100s, 50s, acc)
    const hitsResult = solveHits({
        totalObjects,
        targetAcc: simOptions.accuracy,
        misses,
        fixed300: simOptions.fixed300,
        fixed100: simOptions.fixed100,
        fixed50: simOptions.fixed50,
        mode: requestedModeStr
    });

    // Calcular Performance de la jugada simulada
    const perfSim = new rosu.Performance({
        mods: activeModsStr,
        n300: hitsResult.count300,
        n100: hitsResult.count100,
        n50: hitsResult.count50,
        misses: hitsResult.misses,
        combo: combo,
        accuracy: hitsResult.accuracy
    }).calculate(map);

    // Calcular Performance si la jugada hubiera sido FC (para mostrar el PP entre paréntesis)
    let perfFC = null;
    if (misses > 0 || combo < beatmapMaxCombo) {
        perfFC = new rosu.Performance({
            mods: activeModsStr,
            n300: hitsResult.count300 + misses,
            n100: hitsResult.count100,
            n50: hitsResult.count50,
            misses: 0,
            combo: beatmapMaxCombo,
            accuracy: hitsResult.accuracy
        }).calculate(map);
    }

    const grade = calculateGrade(hitsResult.accuracy, misses, combo, beatmapMaxCombo);

    // Obtener usuario de Discord / Sengo para mostrar en la autoría
    const authorUser = message.author || { username: 'Jugador', avatarURL: () => 'https://a.ppy.sh/0' };
    const avatarUrl = typeof authorUser.avatarURL === 'function' ? authorUser.avatarURL({ extension: 'png' }) : 'https://a.ppy.sh/0';

    // Construir estructura idéntica a recent_scores para reusar doOsuEmbed
    const simulatedScores = {
        isSimulated: true,
        user: {
            username: authorUser.username,
            avatar_url: avatarUrl,
            id: authorUser.id
        },
        beatmapset: {
            title: beatmapData.beatmapset.title,
            covers: beatmapData.beatmapset.covers
        },
        beatmap: {
            id: beatmapData.id,
            version: beatmapData.version,
            mode: requestedModeStr,
            status: beatmapData.status
        },
        accuracy: hitsResult.accuracy / 100,
        max_combo: combo,
        passed: misses === 0 || hitsResult.accuracy > 50,
        rank: grade,
        mods: activeModsStr === 'NM' ? [] : (activeModsStr.match(/.{1,2}/g) || []),
        statistics: {
            count_300: hitsResult.count300,
            count_100: hitsResult.count100,
            count_50: hitsResult.count50,
            count_miss: hitsResult.misses,
            great: hitsResult.count300,
            ok: hitsResult.count100,
            meh: hitsResult.count50,
            miss: hitsResult.misses
        },
        ended_at: new Date().toISOString()
    };

    const preCalculated = {
        pp: perfSim.pp,
        pp_fc: perfFC ? perfFC.pp : null,
        beatmap_max_combo: beatmapMaxCombo,
        maxAttrs: perfMax
    };

    map.free();

    const embed = await doOsuEmbed(message, simulatedScores, preCalculated, locale);

    if (reply) {
        reply.reply({ embeds: [embed] });
        return;
    }
    return { embeds: [embed] };
}

module.exports = { run, parseSimArgs, solveHits, description: "Simula una jugada en un mapa para calcular su PP." };
