const config = require("../../../config.js");
const { getBeatmap_osu, saveUserscore, getBeatmap, findBeatmapInChannel, getOsuUser, lookupBeatmapByMD5, getScoreDetails } = require("../../utils/osu.js");
const { parseOSR } = require("../../utils/osr_parser.js");
const { colorear } = require("../../utils/admin.js");
const { EmbedBuilder } = require("discord.js");
const axios = require('axios');
const rosu = require("rosu-pp-js");
const fetch = require('node-fetch');

/**
 * Calcula el grade de osu!standard usando la fórmula oficial.
 * Referencia: https://osu.ppy.sh/wiki/en/Gameplay/Grade
 * @param {object} stats  - { great, ok, meh, miss }
 * @param {number} accuracy - decimal (0 a 1)
 * @param {string[]} mods  - array de acronyms (ej. ['HD', 'HR'])
 * @param {boolean} passed - si la play fue completada
 * @returns {string} - 'XH', 'X', 'SH', 'S', 'A', 'B', 'C', 'D', 'F'
 */
function calculateRank(stats, accuracy, mods, passed) {
    if (!passed) return 'F';

    const { great = 0, ok = 0, meh = 0, miss = 0 } = stats;
    const total_hits = great + ok + meh + miss;

    const ratio_300 = total_hits > 0 ? great / total_hits : 0;
    const ratio_50 = total_hits > 0 ? meh / total_hits : 0;

    // Silver grades: Hidden, Flashlight o Fade In
    const has_silver = mods && mods.some(m => m === 'HD' || m === 'FL' || m === 'FI');

    // SS: 100% accuracy (todos 300s)
    if (miss === 0 && meh === 0 && ok === 0) {
        return has_silver ? 'XH' : 'X';
    }
    // S: >=90% acc, <=1% de 50s, 0 misses
    if (accuracy >= 0.9 && ratio_50 <= 0.01 && miss === 0) {
        return has_silver ? 'SH' : 'S';
    }
    // A: >80% de 300s y 0 misses  O  >90% de 300s
    if ((ratio_300 > 0.8 && miss === 0) || ratio_300 > 0.9) return 'A';
    // B: >70% de 300s y 0 misses  O  >80% de 300s
    if ((ratio_300 > 0.7 && miss === 0) || ratio_300 > 0.8) return 'B';
    // C: >60% de 300s y 0 misses  O  >70% de 300s
    if (ratio_300 > 0.6) return 'C';
    // D: el resto
    return 'D';
}

function calculatePP(recent_scores, map, maximo_pp, Attrs) {
    const { perfect = 0, great = 0, good = 0, ok = 0, meh = 0, miss = 0, small_tick_miss = 0 } = recent_scores.statistics;
    const mode = recent_scores.beatmap.mode || 'osu';

    // Se construye el performance constructor
    const max_perfomance_constructor = {
        mods: recent_scores.mods,
        lazer: recent_scores.started_at ? true : false,
    };

    const difficulty_constructor = {
        ...max_perfomance_constructor,
        maxCombo: recent_scores.max_combo,
        misses: miss
    };

    let total_hits = 0;

    if (mode === 'mania') {
        difficulty_constructor.n320 = perfect;
        difficulty_constructor.n300 = great;
        difficulty_constructor.n200 = good;
        difficulty_constructor.n100 = ok;
        difficulty_constructor.n50 = meh;
        total_hits = perfect + great + good + ok + meh + miss;
    } else if (mode === 'taiko') {
        difficulty_constructor.n300 = great;
        difficulty_constructor.n100 = ok;
        total_hits = great + ok + miss;
    } else if (mode === 'fruits') {
        difficulty_constructor.n300 = great;
        difficulty_constructor.n100 = ok;
        difficulty_constructor.n50 = meh;
        difficulty_constructor.nKatu = small_tick_miss;
        total_hits = great + ok + meh + miss + small_tick_miss;
    } else { // 'osu'
        difficulty_constructor.n300 = great;
        difficulty_constructor.n100 = ok;
        difficulty_constructor.n50 = meh;
        total_hits = great + ok + meh + miss;

        if (recent_scores.statistics.large_tick_hit !== undefined) difficulty_constructor.largeTickHits = recent_scores.statistics.large_tick_hit;
        if (recent_scores.statistics.slider_tail_hit !== undefined) difficulty_constructor.sliderEndHits = recent_scores.statistics.slider_tail_hit;
        if (recent_scores.statistics.ignore_hit !== undefined) difficulty_constructor.smallTickHits = recent_scores.statistics.ignore_hit;
    }

    const rosuModeMap = {
        'osu': rosu.GameMode.Osu,
        'taiko': rosu.GameMode.Taiko,
        'fruits': rosu.GameMode.Catch,
        'mania': rosu.GameMode.Mania
    };
    const activeMode = rosuModeMap[mode] !== undefined ? rosuModeMap[mode] : rosu.GameMode.Osu;

    if (map.mode !== activeMode) {
        map.convert(activeMode);
    }

    if (maximo_pp) {
        const maxAttrs = new rosu.Performance(max_perfomance_constructor).calculate(Attrs ? Attrs : map);
        return maxAttrs;
    }

    const difficulty = new rosu.Difficulty(max_perfomance_constructor);
    return difficulty.gradualPerformance(map).nth(difficulty_constructor, total_hits);
}

function similarity(s1, s2) {
    if (!s1 || !s2) return 0;
    let longer = s1.toLowerCase();
    let shorter = s2.toLowerCase();
    if (longer.length < shorter.length) { [longer, shorter] = [shorter, longer]; }
    let longerLength = longer.length;
    if (longerLength === 0) return 1.0;

    let costs = new Array();
    for (let i = 0; i <= longer.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= shorter.length; j++) {
            if (i === 0) costs[j] = j;
            else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (longer.charAt(i - 1) !== shorter.charAt(j - 1))
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) costs[shorter.length] = lastValue;
    }
    return (longerLength - costs[shorter.length]) / parseFloat(longerLength);
}

async function getBeatmapIdFromSearch(beatmap_name, diff_name, creator) {
    try {
        const tokenData = require('../../../osu_token.json');

        // Reemplazamos guiones por espacios para evitar que el motor de búsqueda de osu! 
        // los interprete como operadores de exclusión (ej. "-Scramble-" -> excluir Scramble)
        const clean_query = beatmap_name ? beatmap_name.replace(/-/g, ' ') : '';

        let res = await axios.get('https://osu.ppy.sh/api/v2/beatmapsets/search', {
            params: { q: clean_query, s: 'any' },
            headers: { Authorization: 'Bearer ' + tokenData.access_token }
        });

        let beatmapsets = res.data.beatmapsets || [];
        let bestSetScore = -1;
        let chosenSet = beatmapsets[0];

        if (beatmapsets.length > 0 && creator) {
            for (const set of beatmapsets) {
                const score = similarity(set.creator, creator);
                if (score > bestSetScore) {
                    bestSetScore = score;
                    chosenSet = set;
                }
            }
        }

        // Si se especificó un creador pero no se encontró un set con buena similitud (score < 0.6)
        // o no hubo resultados, intentamos una búsqueda secundaria incluyendo al creador en el query
        if (creator && (beatmapsets.length === 0 || bestSetScore < 0.6)) {
            console.log(`[S.SUBIR] Similitud de creador baja o sin resultados. Intentando búsqueda con creador: "${clean_query} ${creator}"`);
            try {
                const fallbackRes = await axios.get('https://osu.ppy.sh/api/v2/beatmapsets/search', {
                    params: { q: `${clean_query} ${creator}`, s: 'any' },
                    headers: { Authorization: 'Bearer ' + tokenData.access_token }
                });
                if (fallbackRes.data.beatmapsets && fallbackRes.data.beatmapsets.length > 0) {
                    beatmapsets = fallbackRes.data.beatmapsets;
                    bestSetScore = -1;
                    chosenSet = beatmapsets[0];
                    for (const set of beatmapsets) {
                        const score = similarity(set.creator, creator);
                        if (score > bestSetScore) {
                            bestSetScore = score;
                            chosenSet = set;
                        }
                    }
                }
            } catch (fallbackErr) {
                console.error('Fallback search error:', fallbackErr.message);
            }
        }

        if (chosenSet && chosenSet.beatmaps && chosenSet.beatmaps.length > 0) {
            let bestMatch = chosenSet.beatmaps[0];

            // Fuzzy match para la dificultad
            if (diff_name) {
                let bestDiffScore = -1;
                for (const b of chosenSet.beatmaps) {
                    const score = similarity(b.version, diff_name);
                    if (score > bestDiffScore) {
                        bestDiffScore = score;
                        bestMatch = b;
                    }
                }
            }
            return bestMatch.id;
        }
    } catch (error) {
        console.error('Search error:', error);
    }
    return null;
}

function parseBotEmbed(reply) {
    if (!reply.embeds || reply.embeds.length === 0) return null;
    const embed = reply.embeds[0];
    const content = reply.content || '';
    const authorName = embed.author ? embed.author.name : '';
    const title = embed.title || '';
    const description = embed.description || '';

    let parsed = null;

    try {
        if (content.includes('Recent osu!')) {
            const playerMatch = content.match(/Play for (.+?):/);
            const mapMatch = authorName.match(/^(.+?)\s+\[(.+?)\]\s+\+(.+?)\s+\[/);
            const accMatch = description.match(/▸\s+([\d\.]+)%/);
            const scoreMatch = description.match(/▸\s+([0-9,]+)\s+▸\s+x([0-9]+)/);
            const statsMatch = description.match(/\[([\d\/]+)\]/);
            const rankMatch = description.match(/▸\s+([A-Z]+)\s+▸/);

            if (playerMatch && mapMatch && scoreMatch && statsMatch) {
                const parts = statsMatch[1].split('/').map(Number);
                let statistics = {};
                if (parts.length === 6) {
                    statistics = {
                        perfect: parts[0],
                        great: parts[1],
                        good: parts[2],
                        ok: parts[3],
                        meh: parts[4],
                        miss: parts[5]
                    };
                } else if (parts.length === 4) {
                    statistics = {
                        great: parts[0],
                        ok: parts[1],
                        meh: parts[2],
                        miss: parts[3]
                    };
                } else if (parts.length === 3) {
                    statistics = {
                        great: parts[0],
                        ok: parts[1],
                        miss: parts[2]
                    };
                }

                parsed = {
                    player_name: playerMatch[1].trim(),
                    beatmap_name: mapMatch[1].trim(),
                    difficulty_name: mapMatch[2].trim(),
                    accuracy: accMatch ? parseFloat(accMatch[1]) / 100 : 0,
                    score: parseInt(scoreMatch[1].replace(/,/g, '')),
                    max_combo: parseInt(scoreMatch[2]),
                    statistics: statistics,
                    mods: mapMatch[3].trim() === 'No Mod' ? ['NM'] : mapMatch[3].trim().split(/(?=[A-Z]{2})/),
                    rank: rankMatch ? rankMatch[1] : 'A',
                    date: embed.timestamp ? new Date(embed.timestamp).toISOString() : null
                };
            }
        }

        if (authorName.includes('Puntuación Reciente de') || authorName.includes('Puntuaciones de')) {
            const playerMatch = authorName.match(/(?:Reciente de|Puntuaciones de) (.+?) en/);
            const mapMatch = title.match(/^(.+?)\s+\[(.+?)\]/);
            const scoreMatch = description.match(/Puntuación\*\*: \`([0-9\.]+)\`/);
            const statsMatch = description.match(/([\d]+(?:\/\d+)+)[^]+?([\d\.]+)%\s+x(\d+)/);

            if (playerMatch && mapMatch && scoreMatch && statsMatch) {
                const parts = statsMatch[1].split('/').map(Number);
                let statistics = {};
                if (parts.length === 6) {
                    statistics = {
                        perfect: parts[0],
                        great: parts[1],
                        good: parts[2],
                        ok: parts[3],
                        meh: parts[4],
                        miss: parts[5]
                    };
                } else if (parts.length === 4) {
                    statistics = {
                        great: parts[0],
                        ok: parts[1],
                        meh: parts[2],
                        miss: parts[3]
                    };
                } else if (parts.length === 3) {
                    statistics = {
                        great: parts[0],
                        ok: parts[1],
                        miss: parts[2]
                    };
                }

                parsed = {
                    player_name: playerMatch[1].trim(),
                    beatmap_name: mapMatch[1].trim(),
                    difficulty_name: mapMatch[2].trim(),
                    score: parseInt(scoreMatch[1].replace(/\./g, '')),
                    statistics: statistics,
                    accuracy: parseFloat(statsMatch[2]) / 100,
                    max_combo: parseInt(statsMatch[3]),
                    mods: ['NM'],
                    rank: 'A',
                    date: embed.timestamp ? new Date(embed.timestamp).toISOString() : null
                };
            }
        }
    } catch (e) { }

    return parsed;
}

async function run(messages, args, initialized_data) {
    const { message, res, reply } = messages;

    console.log(`\n--- [S.SUBIR] Nueva solicitud de subida ---`);
    console.log(`[S.SUBIR] Usuario solicitante: ${message.author.tag} (${message.author.id})`);

    // Buscamos si hay un adjunto en el mensaje del comando o si es un reply
    const sourceMessage = (message.attachments.size > 0) ? message : reply;

    if (!sourceMessage) {
        console.log(`[S.SUBIR] Error: No se encontró fuente (adjunto o reply).`);
        return "Debes adjuntar un archivo de repetición `.osr` o responder (reply) a un mensaje que contenga una replay `.osr` o un embed de score compatible.";
    }

    let parsedData = null;

    // Verificar si es un archivo .osr
    const osrAttachment = sourceMessage.attachments.find(a => a.name.endsWith('.osr'));
    if (osrAttachment) {
        console.log(`[S.SUBIR] Archivo .osr detectado. Procesando localmente...`);
        try {
            await message.channel.sendTyping();
            const response = await fetch(osrAttachment.url);
            const buffer = await response.buffer();
            const replayData = parseOSR(buffer);
            if (replayData) {
                // Parsear mods
                const modMap = [
                    { bit: 1<<0, acronym: 'NF' }, { bit: 1<<1, acronym: 'EZ' },
                    { bit: 1<<2, acronym: 'TD' }, { bit: 1<<3, acronym: 'HD' },
                    { bit: 1<<4, acronym: 'HR' }, { bit: 1<<5, acronym: 'SD' },
                    { bit: 1<<6, acronym: 'DT' }, { bit: 1<<7, acronym: 'RX' },
                    { bit: 1<<8, acronym: 'HT' }, { bit: 1<<9, acronym: 'NC' },
                    { bit: 1<<10, acronym: 'FL' }, { bit: 1<<12, acronym: 'SO' },
                    { bit: 1<<13, acronym: 'AP' }, { bit: 1<<14, acronym: 'PF' },
                    { bit: 1<<29, acronym: 'V2' }
                ];
                let parsedMods = [];
                if (replayData.lazerScoreInfo && replayData.lazerScoreInfo.mods) {
                    parsedMods = replayData.lazerScoreInfo.mods;
                } else {
                    for (const m of modMap) {
                        if ((replayData.mods & m.bit) !== 0) parsedMods.push(m.acronym);
                    }
                    if (parsedMods.length === 0) parsedMods = ['NM'];
                    if (parsedMods.includes('NC')) parsedMods = parsedMods.filter(m => m !== 'DT');
                    if (parsedMods.includes('PF')) parsedMods = parsedMods.filter(m => m !== 'SD');
                    
                    const isStable = replayData.gameVersion < 30000000;
                    if (isStable && !parsedMods.includes('CL')) {
                        parsedMods.push('CL');
                    }
                }

                // Determinar modo de juego, exactitud y estadísticas de la replay
                let acc = 0;
                let stats = {};

                if (replayData.gameMode === 3) { // Mania
                    const totalHits = replayData.countGeki + replayData.count300 + replayData.countKatu + replayData.count100 + replayData.count50 + replayData.countMiss;
                    acc = totalHits > 0 ? ((replayData.countGeki * 300) + (replayData.count300 * 300) + (replayData.countKatu * 200) + (replayData.count100 * 100) + (replayData.count50 * 50)) / (totalHits * 300) : 0;
                    stats = {
                        perfect: replayData.countGeki,
                        great: replayData.count300,
                        good: replayData.countKatu,
                        ok: replayData.count100,
                        meh: replayData.count50,
                        miss: replayData.countMiss
                    };
                } else if (replayData.gameMode === 1) { // Taiko
                    const totalHits = replayData.count300 + replayData.count100 + replayData.countMiss;
                    acc = totalHits > 0 ? ((replayData.count300 * 300) + (replayData.count100 * 150)) / (totalHits * 300) : 0;
                    stats = {
                        great: replayData.count300,
                        ok: replayData.count100,
                        miss: replayData.countMiss
                    };
                } else if (replayData.gameMode === 2) { // Catch
                    const totalHits = replayData.count300 + replayData.count100 + replayData.count50 + replayData.countMiss + replayData.countKatu;
                    acc = totalHits > 0 ? (replayData.count300 + replayData.count100 + replayData.count50) / totalHits : 0;
                    stats = {
                        great: replayData.count300,
                        ok: replayData.count100,
                        meh: replayData.count50,
                        miss: replayData.countMiss,
                        small_tick_miss: replayData.countKatu
                    };
                } else { // Standard
                    const totalHits = replayData.count300 + replayData.count100 + replayData.count50 + replayData.countMiss;
                    acc = totalHits > 0 ? ((replayData.count300 * 300) + (replayData.count100 * 100) + (replayData.count50 * 50)) / (totalHits * 300) : 0;
                    stats = {
                        great: replayData.count300,
                        ok: replayData.count100,
                        meh: replayData.count50,
                        miss: replayData.countMiss
                    };
                }

                let dateObj = null;
                try {
                    const unixTime = Number((replayData.timestamp - 621355968000000000n) / 10000n);
                    dateObj = new Date(unixTime);
                } catch(e) {}

                parsedData = {
                    player_name: replayData.playerName,
                    beatmap_name: "Replay Map",
                    difficulty_name: "",
                    creator: "",
                    accuracy: acc,
                    score: replayData.totalScore,
                    max_combo: replayData.maxCombo,
                    statistics: stats,
                    mods: parsedMods,
                    rank: 'A',
                    date: dateObj ? dateObj.toISOString() : new Date().toISOString(),
                    beatmapMD5: replayData.beatmapMD5,
                    is_osr: true,
                    lazer_online_id: replayData.lazerScoreInfo ? replayData.lazerScoreInfo.online_id : null
                };
            }
        } catch (e) {
            console.error("[S.SUBIR] Error al parsear .osr:", e);
        }
    }

    if (!parsedData) {
        parsedData = parseBotEmbed(sourceMessage);
    }

    if (!parsedData) {
        console.log(`[S.SUBIR] Error: No se pudo extraer información de la score (no se detectó archivo .osr ni un embed de bot soportado).`);
        return "No se pudo extraer la información de la score. Asegúrate de responder a un archivo de replay `.osr` o a un embed de bot compatible.";
    }

    // --- Validación y recálculo del rango (rank) ---
    const valid_ranks = new Set(['X', 'XH', 'S', 'SH', 'A', 'B', 'C', 'D', 'F']);
    const original_rank = parsedData.rank ? String(parsedData.rank).toUpperCase() : null;
    const calculated_rank = calculateRank(
        parsedData.statistics,
        parsedData.accuracy,
        parsedData.mods,
        parsedData.rank !== 'F' && parsedData.accuracy > 0
    );

    if (!original_rank || !valid_ranks.has(original_rank)) {
        console.log(`[S.SUBIR] Rango original inválido ("${parsedData.rank}"). Usando rango calculado: ${calculated_rank}`);
        parsedData.rank = calculated_rank;
    } else {
        console.log(`[S.SUBIR] Rango original: "${original_rank}". Rango calculado: "${calculated_rank}". Se usa el calculado para mayor fiabilidad.`);
        parsedData.rank = calculated_rank; // siempre preferimos el calculado
    }
    // ----------------------------------------

    // Buscar beatmap
    console.log(`[S.SUBIR] Intentando resolver mapa... Nombre: "${parsedData.beatmap_name}", Diff: "${parsedData.difficulty_name}", Creador: "${parsedData.creator}"`);
    let beatmap_id = null;
    if (sourceMessage.embeds && sourceMessage.embeds.length > 0) {
        const { beatmap_url } = await findBeatmapInChannel(sourceMessage, true);
        if (beatmap_url) beatmap_id = beatmap_url;
    }

    // Si aún no hay ID y era un reply, intentamos buscar en el reply también (por si el sourceMessage era el comando con foto)
    if (!beatmap_id && reply && reply.embeds && reply.embeds.length > 0) {
        const { beatmap_url } = await findBeatmapInChannel(reply, true);
        if (beatmap_url) beatmap_id = beatmap_url;
    }

    if (!beatmap_id && parsedData.lazer_online_id) {
        const scoreDetails = await getScoreDetails(parsedData.lazer_online_id);
        if (scoreDetails && scoreDetails.beatmap) {
            beatmap_id = scoreDetails.beatmap.id;
            parsedData.beatmap_name = scoreDetails.beatmapset.title;
            parsedData.difficulty_name = scoreDetails.beatmap.version;
            parsedData.creator = scoreDetails.beatmapset.creator;
        }
    }

    if (!beatmap_id && parsedData.beatmapMD5) {
        const bm = await lookupBeatmapByMD5(parsedData.beatmapMD5);
        if (bm && bm.id) {
            beatmap_id = bm.id;
            parsedData.beatmap_name = bm.beatmapset.title;
            parsedData.difficulty_name = bm.version;
            parsedData.creator = bm.beatmapset.creator;
        }
    }

    if (!beatmap_id && !parsedData.is_osr) {
        beatmap_id = await getBeatmapIdFromSearch(parsedData.beatmap_name, parsedData.difficulty_name, parsedData.creator);
    }

    if (!beatmap_id) {
        if (parsedData.is_osr) {
            return `No pude encontrar el mapa original usando el MD5 interno de la replay (\`${parsedData.beatmapMD5}\`). Esto suele ocurrir con algunas replays exportadas desde osu!lazer o mapas modificados. \n**Solución:** Vuelve a enviar la replay respondiendo (haciendo *reply*) a un mensaje que contenga el link del mapa original.`;
        }
        console.log(`[S.SUBIR] Error: No se pudo encontrar el mapa en la API de osu!`);
        return `No pude encontrar el mapa \`${parsedData.beatmap_name}\` en la base de datos de osu!.`;
    }

    console.log(`[S.SUBIR] Mapa resuelto correctamente. Beatmap ID: ${beatmap_id}`);
    const beatmap_metadata = await getBeatmap(beatmap_id);

    // Get user id
    let user_id = null;
    const osuUser = await getOsuUser({ username: [parsedData.player_name], gamemode: 'osu' });
    if (typeof osuUser !== 'string') {
        user_id = osuUser.id;
    } else {
        const linked = await res.User.findOne({ discord_id: message.author.id });
        if (linked) user_id = linked.osu_id;
    }

    if (!user_id) {
        return `No pude resolver la ID del usuario \`${parsedData.player_name}\` y no estás vinculado a un perfil.`;
    }

    // Obtener el perfil real del usuario para corregir posibles fallos del OCR en el nombre
    let finalOsuUser = typeof osuUser !== 'string' ? osuUser : null;
    if (!finalOsuUser && user_id) {
        const fetched = await getOsuUser({ username: [String(user_id)], gamemode: 'osu' });
        if (typeof fetched !== 'string') finalOsuUser = fetched;
    }

    if (finalOsuUser && finalOsuUser.username) {
        parsedData.player_name = finalOsuUser.username; // Sobrescribe Aquaro por Aquare (oficial)
    }

    // Nota: El ajuste de zona horaria del OCR ha sido removido porque las replays (.osr) y embeds de bots
    // ya contienen la hora real UTC correcta.

    const recent_scores = {
        accuracy: parsedData.accuracy,
        ended_at: parsedData.date || new Date().toISOString(),
        legacy_total_score: parsedData.score,
        total_score: parsedData.score,
        max_combo: parsedData.max_combo,
        statistics: parsedData.statistics,
        mods: parsedData.mods.map(mod => typeof mod === 'string' ? { acronym: mod } : mod),
        passed: parsedData.rank !== 'F',
        rank: parsedData.rank,
        user: { username: parsedData.player_name, id: user_id, avatar_url: `https://a.ppy.sh/${user_id}` },
        user_id: user_id,
        beatmap: { id: beatmap_id, status: beatmap_metadata.status, version: beatmap_metadata.version, difficulty_rating: beatmap_metadata.difficulty_rating, mode: beatmap_metadata.mode || 'osu' },
        beatmapset: { title: beatmap_metadata.beatmapset.title, covers: beatmap_metadata.beatmapset.covers }
    };

    const { perfect = 0, great = 0, good = 0, ok = 0, meh = 0, miss = 0 } = recent_scores.statistics;
    const total_hits = perfect + great + good + ok + meh + miss;

    const map = await getBeatmap_osu(beatmap_metadata.beatmapset_id, beatmap_id, beatmap_metadata);
    const maxAttrs = calculatePP(recent_scores, map, "maximo_pp");

    const pre_calculated = {
        "map": map,
        "map_completion": recent_scores.passed ? 100 : total_hits / map.nObjects,
        "maxAttrs": maxAttrs,
        "pp": calculatePP(recent_scores, map, null, maxAttrs).pp,
        "beatmap_max_combo": beatmap_metadata.max_combo,
    };

    await saveUserscore(recent_scores, pre_calculated, true);
    console.log(`[S.SUBIR] ¡Score guardada exitosamente para ${parsedData.player_name}!`);

    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ffffff';

    const emoji_grades = require("../../../src/emoji_grades.json");
    const rank_aliases_embed = { "SS": "X", "SSH": "XH" };
    const rank_key_embed = !recent_scores.passed ? "F" : (rank_aliases_embed[recent_scores.rank] ?? recent_scores.rank);
    let grade_emoji = emoji_grades[rank_key_embed] ?? emoji_grades["F"];
    grade_emoji = grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}:` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`;

    const emoji_mods = require("../../../src/emoji_mods.json");
    const mods_used = recent_scores.mods.length > 0 ? recent_scores.mods.reduce((acc, mod) => {
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
        return `${acc}<:${mod.acronym}:${emoji_mods[mod.acronym] || '123'}>${settings_str}`;
    }, '') : `<:NM:${emoji_mods["NM"]}>`;

    const map_completion = recent_scores.passed ? `` : `(${((pre_calculated.map_completion) * 100).toFixed(2)}%)`;

    let stats_str = "";
    let ratio_str = "";
    if (recent_scores.beatmap.mode === 'mania') {
        stats_str = `[${colorear(perfect, "cyan")}/${colorear(great, "amarillo")}/${colorear(good, "verde")}/${colorear(ok, "azul")}/${colorear(meh, "magenta")}/${colorear(miss, "rojo")}]`;
        const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
        ratio_str = ` ▸ ${ratio}:1`;
    } else if (recent_scores.beatmap.mode === 'taiko') {
        stats_str = `[${colorear(great, "azul")}/${colorear(ok, "verde")}/${colorear(miss, "rojo")}]`;
    } else if (recent_scores.beatmap.mode === 'fruits') {
        const { small_tick_miss = 0 } = recent_scores.statistics;
        stats_str = `[${colorear(great, "azul")}/${colorear(ok, "verde")}/${colorear(meh, "amarillo")}/${colorear(miss, "rojo")}/${colorear(small_tick_miss, "magenta")}]`;
    } else {
        stats_str = `[${colorear(great, "azul")}/${colorear(ok, "verde")}/${colorear(meh, "amarillo")}/${colorear(miss, "rojo")}]`;
    }

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Score manual guardada para ${parsedData.player_name}`,
            url: `https://osu.ppy.sh/users/${user_id}`,
            iconURL: recent_scores.user.avatar_url
        })
        .setTitle(`${recent_scores.beatmapset.title} [${recent_scores.beatmap.version}] - ${pre_calculated.maxAttrs.difficulty.stars.toFixed(2) + '★'} `)
        .setURL(`https://osu.ppy.sh/b/${beatmap_id}`)
        .setDescription(`**Puntuación**: \`${(recent_scores.legacy_total_score || recent_scores.total_score || 0).toLocaleString('es-ES')}\` **▸** ${grade_emoji} ${map_completion} **▸** ${mods_used}
\`\`\`ansi
${stats_str} ${colorear(pre_calculated.pp.toFixed(2) + 'PP')}/${maxAttrs.pp.toFixed(2)}PP ${(recent_scores.accuracy * 100).toFixed(2)}%${ratio_str} x${recent_scores.max_combo}/${colorear(pre_calculated.beatmap_max_combo)}
\`\`\`
        `)
        .setImage(recent_scores.beatmapset.covers["cover@2x"])
        .setColor(embedColor)
        .setFooter({ text: "SengoBot", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp(new Date(recent_scores.ended_at));

    map.free();
    return { content: '', embeds: [embed] };
}

run.alias = {
    "save": { "args": "" }
}

run.description = {
    'header': 'Sube una score a la base de datos de Sengo.',
    'body': 'Adjunta un archivo `.osr` o haz reply a una replay `.osr` o a un embed de score compatible (de OwO bot o Sengo) con los detalles de una score y la guardará en la base de datos local.\n\n**Opciones:**\n`-m <mods>` o `-mods <mods>`: Sobrescribe los mods detectados (ej. `-m HDDT`). Usar `-m NM` para No Mod.',
    'usage': `s.subir [adjuntando archivo .osr o respondiendo a un mensaje] [-m MODS]`
}

module.exports = { run, "description": run.description }
