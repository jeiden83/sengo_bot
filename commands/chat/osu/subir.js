const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("../../../config.json");
const { getBeatmap_osu, saveUserscore, getBeatmap, findBeatmapInChannel, getOsuUser } = require("../../utils/osu.js");
const { colorear } = require("../../utils/admin.js");
const { EmbedBuilder } = require("discord.js");
const axios = require('axios');
const rosu = require("rosu-pp-js");
const fetch = require('node-fetch');

const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);

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
    const ratio_50  = total_hits > 0 ? meh  / total_hits : 0;

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

function calculatePP(recent_scores, map, maximo_pp, Attrs){
	// Se consiguen las estadisticas de la score
	const { great = 0, ok = 0, meh = 0, miss = 0, large_tick_hit = 0, slider_tail_hit = 0, ignore_hit = 0} = recent_scores.statistics;

	// Para el SS
	const max_perfomance_constructor = { 
		mods: recent_scores.mods, 
		lazer: recent_scores.started_at ? true : false,
	};

	const difficulty_constructor = {
		...max_perfomance_constructor,
		maxCombo: recent_scores.max_combo,
		misses: miss,
		n300: great,
		n100: ok,
		n50: meh, 
		largeTickHits: large_tick_hit,
		sliderEndHits: slider_tail_hit,
		smallTickHits: ignore_hit,
	}

	if(maximo_pp){
		const maxAttrs = new rosu.Performance(max_perfomance_constructor).calculate(Attrs ? Attrs : map);
		return maxAttrs;
	}

	if(!recent_scores.passed){
		const total_hits = great + ok + meh + miss;
		const difficulty = new rosu.Difficulty(max_perfomance_constructor);
		return difficulty.gradualPerformance(map).nth(difficulty_constructor, total_hits);
	} 

	const currAttrs = new rosu.Performance(difficulty_constructor).calculate(Attrs ? Attrs : map);
	return currAttrs;
}

async function processImage(url) {
    try {
        const response = await fetch(url);
        const buffer = await response.buffer();
        const base64Data = buffer.toString('base64');
        const mimeType = response.headers.get('content-type');
        return {
            inlineData: {
                data: base64Data,
                mimeType: mimeType
            }
        };
    } catch (error) {
        console.error("Error al procesar la imagen:", error);
        return null;
    }
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
            const statsMatch = description.match(/\[(\d+)\/(\d+)\/(\d+)\/(\d+)\]/);
            const rankMatch = description.match(/▸\s+([A-Z]+)\s+▸/);
            
            if (playerMatch && mapMatch && scoreMatch && statsMatch) {
                parsed = {
                    player_name: playerMatch[1].trim(),
                    beatmap_name: mapMatch[1].trim(),
                    difficulty_name: mapMatch[2].trim(),
                    accuracy: accMatch ? parseFloat(accMatch[1]) / 100 : 0,
                    score: parseInt(scoreMatch[1].replace(/,/g, '')),
                    max_combo: parseInt(scoreMatch[2]),
                    statistics: {
                        great: parseInt(statsMatch[1]),
                        ok: parseInt(statsMatch[2]),
                        meh: parseInt(statsMatch[3]),
                        miss: parseInt(statsMatch[4])
                    },
                    mods: mapMatch[3].trim() === 'No Mod' ? ['NM'] : mapMatch[3].trim().split(/(?=[A-Z]{2})/),
                    rank: rankMatch ? rankMatch[1] : 'A'
                };
            }
        }
        
        if (authorName.includes('Puntuación Reciente de') || authorName.includes('Puntuaciones de')) {
            const playerMatch = authorName.match(/(?:Reciente de|Puntuaciones de) (.+?) en/);
            const mapMatch = title.match(/^(.+?)\s+\[(.+?)\]/);
            const scoreMatch = description.match(/Puntuación\*\*: \`([0-9\.]+)\`/);
            const statsMatch = description.match(/(\d+)\/(\d+)\/(\d+)\/(\d+)[^]+?([\d\.]+)%\s+x(\d+)/);
            
            if (playerMatch && mapMatch && scoreMatch && statsMatch) {
                parsed = {
                    player_name: playerMatch[1].trim(),
                    beatmap_name: mapMatch[1].trim(),
                    difficulty_name: mapMatch[2].trim(),
                    score: parseInt(scoreMatch[1].replace(/\./g, '')),
                    statistics: {
                        great: parseInt(statsMatch[1]),
                        ok: parseInt(statsMatch[2]),
                        meh: parseInt(statsMatch[3]),
                        miss: parseInt(statsMatch[4])
                    },
                    accuracy: parseFloat(statsMatch[5]) / 100,
                    max_combo: parseInt(statsMatch[6]),
                    mods: ['NM'],
                    rank: 'A' 
                };
            }
        }
    } catch(e) {}

    return parsed;
}

async function run(messages, args, initialized_data) {
    const { message, res, reply } = messages;

    console.log(`\n--- [S.SUBIR] Nueva solicitud de subida ---`);
    console.log(`[S.SUBIR] Usuario solicitante: ${message.author.tag} (${message.author.id})`);

    let overrideMods = null;
    const modsIndex = args.findIndex(a => a && typeof a === 'string' && (a.toLowerCase() === '-mods' || a.toLowerCase() === '-m'));
    if (modsIndex !== -1 && args.length > modsIndex + 1) {
        let rawMods = args[modsIndex + 1].toUpperCase();
        if (rawMods === 'NM' || rawMods === 'NOMOD') {
            overrideMods = ['NM'];
        } else {
            overrideMods = rawMods.match(/.{1,2}/g) || ['NM'];
        }
        console.log(`[S.SUBIR] Parámetro de mods detectado. Sobrescribiendo mods con:`, overrideMods);
    }

    // Buscamos si hay un adjunto en el mensaje del comando o si es un reply
    const sourceMessage = (message.attachments.size > 0) ? message : reply;

    if (!sourceMessage) {
        console.log(`[S.SUBIR] Error: No se encontró fuente (adjunto o reply).`);
        return "Debes adjuntar una foto o responder (reply) a un mensaje que contenga un embed de una score o una foto de una play de osu!";
    }

    let parsedData = parseBotEmbed(sourceMessage);

    // Si falló el regex o no era un embed conocido, procedemos con Gemini (OCR)
    if (!parsedData) {
        let textPart = "";
        let imagePart = null;

        if (sourceMessage.attachments.size > 0) {
            const attachment = sourceMessage.attachments.first();
            if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                console.log(`[S.SUBIR] Tipo de input: IMAGEN (Detectada en adjunto)`);
                imagePart = await processImage(attachment.url);
            }
        }

        if (sourceMessage.embeds && sourceMessage.embeds.length > 0) {
            const embed = sourceMessage.embeds[0];
            textPart = `${sourceMessage.content || ''}\n${embed.title || ''}\n${embed.description || ''}\n${embed.author ? embed.author.name : ''}`;
        } else if (sourceMessage.content) {
            textPart = sourceMessage.content;
        }

        if (!imagePart && !textPart.trim()) {
            console.log(`[S.SUBIR] Error: No se encontró imagen ni texto en el mensaje respondido.`);
            return "No pude encontrar información de una score en ese mensaje.";
        }

        if (imagePart) {
            console.log(`[S.SUBIR] Procesando imagen con Gemini OCR...`);
            // LLAMADA A GEMINI
                const prompt = `Extrae la siguiente información de la score de osu! (de la imagen o del texto proporcionado) y devuélvelo ESTRICTAMENTE como un JSON crudo (sin formato markdown ni bloques de código, SOLO el objeto JSON).
MUY IMPORTANTE: Extrae los datos reales que veas en la imagen o texto.
- Título del mapa: Texto grande arriba (marcado en rojo en el ejemplo).
- Dificultad: Entre corchetes después del título.
- Creador: "Beatmap by X" (marcado en amarillo).
- Jugador y Fecha: "Played by X on DD/MM/YYYY H:MM:SS" (marcado en verde y azul). Convierte la fecha a ISO 8601.
- Puntuación (Score): Número grande (marcado en rosado).
- 300s/100s/50s/Misses: Columnas debajo de la score (marcados en naranja, verde oscuro y rojo).
- Max Combo: Número grande con una 'x' abajo a la izquierda (marcado en verde lima).
- Accuracy: Porcentaje grande (conviértelo a decimal ej. 89.83% -> 0.8983).
- Mods: Íconos pequeños pegados a la letra grande del Rank (ej. Score V2, NF). Si no hay, pon ["NM"].

A continuación te muestro un EJEMPLO de una imagen con los datos marcados, y el JSON que espero que generes para ella:`;

                const exampleData = require('./example_score.json');
                const exampleImagePart = {
                    inlineData: {
                        data: exampleData.base64,
                        mimeType: "image/png"
                    }
                };

                const exampleOutput = `
{
  "player_name": "Jeiden",
  "beatmap_name": "Luschka - Kami no Kotoba",
  "difficulty_name": "The faint harmony that sprouted one pretty thing after another",
  "creator": "Sakura Blossom",
  "date": "2024-11-16T00:34:14.000Z",
  "accuracy": 0.8983,
  "max_combo": 354,
  "score": 161637,
  "statistics": { "great": 1085, "ok": 92, "meh": 16, "miss": 52 },
  "mods": ["NF", "V2"],
  "rank": "B"
}
`;

                const finalInstruction = `\nAhora haz lo mismo con la siguiente imagen o texto:\nTexto adicional del mensaje (si lo hay):\n${textPart}`;

                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                const parts = [
                    { text: prompt }, 
                    exampleImagePart, 
                    { text: exampleOutput }, 
                    { text: finalInstruction }
                ];
                
                if (imagePart) parts.push(imagePart);

                try {
                    await message.channel.sendTyping();
                    const result = await model.generateContent(parts);
                    let responseText = result.response.text();
                    
                    responseText = responseText.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
                    parsedData = JSON.parse(responseText);
                    console.log(`[S.SUBIR] OCR (Gemini) extrajo:`, JSON.stringify(parsedData, null, 2));
                } catch (e) {
                    console.error("[S.SUBIR] Error al procesar con Gemini:", e);
                    return "Hubo un error al extraer los datos de la imagen o texto usando IA.";
                }
        } else {
            console.log(`[S.SUBIR] Tipo de input: TEXTO DESCONOCIDO. Procesando con Gemini...`);
            // TEXT ONLY GEMINI FALLBACK
            const prompt = `Extrae la siguiente información...`; // Simplificado para texto
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            try {
                const result = await model.generateContent([{text: `Extrae JSON de esta score:\n${textPart}`}]);
                let responseText = result.response.text().replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
                parsedData = JSON.parse(responseText);
                console.log(`[S.SUBIR] Gemini texto extrajo:`, parsedData);
            } catch(e) {}
        }
    } else {
        console.log(`[S.SUBIR] Tipo de input: EMBED DE BOT CONOCIDO (Regex exitoso).`);
    }

    if (!parsedData) {
        console.log(`[S.SUBIR] Error: No se pudo extraer información de la score.`);
        return "No pude extraer la información de la score. Asegúrate de que el mensaje sea legible o contenga datos válidos.";
    }

    if (overrideMods && parsedData) {
        parsedData.mods = overrideMods;
        console.log(`[S.SUBIR] Mods sobrescritos a:`, parsedData.mods);
    }

    // --- Validación y recálculo del rank ---
    const valid_ranks = new Set(['X', 'XH', 'S', 'SH', 'A', 'B', 'C', 'D', 'F']);
    const ocr_rank = parsedData.rank ? String(parsedData.rank).toUpperCase() : null;
    const calculated_rank = calculateRank(
        parsedData.statistics,
        parsedData.accuracy,
        parsedData.mods,
        parsedData.rank !== 'F' && parsedData.accuracy > 0
    );

    if (!ocr_rank || !valid_ranks.has(ocr_rank)) {
        console.log(`[S.SUBIR] Rank OCR inválido ("${parsedData.rank}"). Usando rank calculado: ${calculated_rank}`);
        parsedData.rank = calculated_rank;
    } else {
        console.log(`[S.SUBIR] Rank OCR: "${ocr_rank}". Rank calculado: "${calculated_rank}". Se usa el calculado para mayor fiabilidad.`);
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

    if (!beatmap_id) {
        beatmap_id = await getBeatmapIdFromSearch(parsedData.beatmap_name, parsedData.difficulty_name, parsedData.creator);
    }

    if (!beatmap_id) {
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

    // Ajuste de zona horaria según el país del jugador para corregir la hora del OCR
    if (parsedData.date) {
        let finalOsuUser = typeof osuUser !== 'string' ? osuUser : null;
        if (!finalOsuUser && user_id) {
            const fetched = await getOsuUser({ username: [String(user_id)], gamemode: 'osu' });
            if (typeof fetched !== 'string') finalOsuUser = fetched;
        }

        if (finalOsuUser && finalOsuUser.country_code) {
            const countryOffsets = {
                "VE": -4, // Venezuela
                "AR": -3, // Argentina
                "CL": -4, // Chile
                "CO": -5, // Colombia
                "PE": -5, // Perú
                "EC": -5, // Ecuador
                "MX": -6, // México
                "ES": 2,  // España
                "UY": -3, // Uruguay
                "PY": -4, // Paraguay
                "BO": -4, // Bolivia
                "DO": -4, // República Dominicana
                "CR": -6, // Costa Rica
                "SV": -6, // El Salvador
                "GT": -6, // Guatemala
                "HN": -6, // Honduras
                "NI": -6, // Nicaragua
                "PA": -5, // Panamá
                "US": -5, // Estados Unidos
                "BR": -3, // Brasil
            };

            const cc = finalOsuUser.country_code.toUpperCase();
            if (cc in countryOffsets) {
                const offset = countryOffsets[cc];
                const dateObj = new Date(parsedData.date);
                if (!isNaN(dateObj.getTime())) {
                    // El OCR lee la hora local de la pantalla como si fuera UTC al añadir la 'Z'.
                    // Para obtener el UTC real de la jugada, restamos el offset del país.
                    let real_utc_ms = dateObj.getTime() - (offset * 3600 * 1000);
                    
                    // Si por discrepancias de horario de verano/invierno la fecha calculada supera la fecha actual,
                    // la limitamos a la fecha actual para evitar que en Discord aparezca en el futuro.
                    if (real_utc_ms > Date.now()) {
                        console.log(`[S.SUBIR] La fecha ajustada supera la hora actual. Limitando a Date.now()`);
                        real_utc_ms = Date.now();
                    }

                    parsedData.date = new Date(real_utc_ms).toISOString();
                    console.log(`[S.SUBIR] Ajuste de zona horaria aplicado para país ${cc} (offset ${offset}h). Nueva fecha UTC: ${parsedData.date}`);
                }
            } else {
                console.log(`[S.SUBIR] País ${cc} no mapeado en offsets. Se mantiene la fecha original del OCR.`);
            }
        }
    }

    const recent_scores = {
        accuracy: parsedData.accuracy,
        ended_at: parsedData.date || new Date().toISOString(),
        legacy_total_score: parsedData.score,
        total_score: parsedData.score,
        max_combo: parsedData.max_combo,
        statistics: parsedData.statistics,
        mods: parsedData.mods.map(acronym => ({ acronym })),
        passed: parsedData.rank !== 'F',
        rank: parsedData.rank,
        user: { username: parsedData.player_name, id: user_id, avatar_url: `https://a.ppy.sh/${user_id}` },
        user_id: user_id,
        beatmap: { id: beatmap_id, status: beatmap_metadata.status, version: beatmap_metadata.version, difficulty_rating: beatmap_metadata.difficulty_rating, mode: 'osu' },
        beatmapset: { title: beatmap_metadata.beatmapset.title, covers: beatmap_metadata.beatmapset.covers }
    };

    const { great = 0, ok = 0, meh = 0, miss = 0 } = recent_scores.statistics;
    const total_hits = great + ok + meh + miss;

    const map = await getBeatmap_osu(beatmap_metadata.beatmapset_id, beatmap_id, beatmap_metadata);
    const maxAttrs = calculatePP(recent_scores, map, "maximo_pp");

    const pre_calculated = {
        "map": map,
        "map_completion": recent_scores.passed ? 100 : total_hits / map.nObjects,
        "maxAttrs": maxAttrs,
        "pp": calculatePP(recent_scores, map, null, maxAttrs).pp,
        "beatmap_max_combo": beatmap_metadata.max_combo,
    };

    saveUserscore(recent_scores, pre_calculated, true);
    console.log(`[S.SUBIR] ¡Score guardada exitosamente para ${parsedData.player_name}!`);

    const roleColor = message.member.roles.highest.color || '#ffffff';
    const embedColor = roleColor !== 0 ? roleColor : '#ffffff';
    
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
                if (da_changes.length > 0) settings_str = `(${da_changes.join(',')})`;
            }
        }
        return `${acc}<:${mod.acronym}:${emoji_mods[mod.acronym] || '123'}>${settings_str}`;
    }, '') : `<:NM:${emoji_mods["NM"]}>`;

    const map_completion = recent_scores.passed ? `` : `(${((pre_calculated.map_completion)*100).toFixed(2)}%)`;

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Score manual guardada para ${parsedData.player_name}`,
            url: `https://osu.ppy.sh/users/${user_id}`,
            iconURL: recent_scores.user.avatar_url
        })
        .setTitle(`${recent_scores.beatmapset.title} [${recent_scores.beatmap.version}] - ${recent_scores.beatmap.difficulty_rating + '★'} `)
        .setURL(`https://osu.ppy.sh/b/${beatmap_id}`)
        .setDescription(`**Puntuación**: \`${(recent_scores.legacy_total_score || recent_scores.total_score || 0).toLocaleString('es-ES')}\` **▸** ${grade_emoji} ${map_completion} **▸** ${mods_used}
\`\`\`ansi
${colorear(great, "azul")}/${colorear(ok, "verde")}/${colorear(meh, "amarillo")}/${colorear(miss, "rojo")} ${colorear(pre_calculated.pp.toFixed(2) + 'PP')}/${maxAttrs.pp.toFixed(2)}PP ${(recent_scores.accuracy * 100).toFixed(2)}% x${recent_scores.max_combo}/${colorear(pre_calculated.beatmap_max_combo)}
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
    'body': 'Adjunta una imagen o haz reply a una imagen o a un embed (de OwO bot o Sengo) con los detalles de una score y la guardará en la base de datos local.\n\n**Opciones:**\n`-m <mods>` o `-mods <mods>`: Sobrescribe los mods detectados (ej. `-m HDDT`). Usar `-m NM` para No Mod.',
    'usage': `s.subir [adjuntando imagen o respondiendo a un mensaje] [-m MODS]`
}

module.exports = { run, "description": run.description }
