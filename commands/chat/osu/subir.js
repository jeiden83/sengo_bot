const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("../../../config.json");
const { getBeatmap_osu, saveUserscore, getBeatmap, findBeatmapInChannel, getOsuUser } = require("../../utils/osu.js");
const { colorear } = require("../../utils/admin.js");
const { EmbedBuilder } = require("discord.js");
const axios = require('axios');
const rosu = require("rosu-pp-js");
const fetch = require('node-fetch');

const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);

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

async function getBeatmapIdFromSearch(beatmap_name, diff_name) {
    try {
        const tokenData = require('../../../osu_token.json');
        const res = await axios.get('https://osu.ppy.sh/api/v2/beatmapsets/search', {
            params: { q: beatmap_name },
            headers: { Authorization: 'Bearer ' + tokenData.access_token }
        });
        
        if (res.data.beatmapsets && res.data.beatmapsets.length > 0) {
            const beatmapset = res.data.beatmapsets[0];
            let bestMatch = beatmapset.beatmaps[0];
            if (diff_name) {
                const diffLower = diff_name.toLowerCase();
                const matched = beatmapset.beatmaps.find(b => b.version.toLowerCase().includes(diffLower) || diffLower.includes(b.version.toLowerCase()));
                if (matched) bestMatch = matched;
            }
            return bestMatch.id;
        }
    } catch (error) {
        console.error('Search error:', error);
    }
    return null;
}

async function run(messages, args, initialized_data) {
    const { message, res, reply } = messages;

    if (!reply) {
        return "Debes responder (reply) a un mensaje que contenga un embed de una score o una foto de una play de osu!";
    }

    let textPart = "";
    let imagePart = null;

    if (reply.attachments.size > 0) {
        const attachment = reply.attachments.first();
        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
            imagePart = await processImage(attachment.url);
        }
    }

    if (reply.embeds.length > 0) {
        const embed = reply.embeds[0];
        textPart = `${embed.title || ''}\n${embed.description || ''}\n${embed.author ? embed.author.name : ''}`;
    } else if (reply.content) {
        textPart = reply.content;
    }

    if (!imagePart && !textPart.trim()) {
        return "No pude encontrar información de una score en ese mensaje.";
    }

    const prompt = `Extrae la siguiente información de la score de osu! (de la imagen o del texto proporcionado) y devuélvelo ESTRICTAMENTE como un JSON crudo (sin formato markdown ni bloques de código, SOLO el objeto JSON).
MUY IMPORTANTE: Extrae los datos reales que veas en la imagen o texto. NO devuelvas mis textos de ejemplo.
Si no encuentras algún dato, asume un valor lógico (ej. 0 para misses si no hay, 'NM' para mods si no hay, accuracy en decimal ej. 95.71% -> 0.9571).
Para el nombre del jugador (player_name), búscalo en frases como "Played by X" o "Recent osu! Standard Play for X:" o en el autor del embed.

El JSON debe tener la siguiente estructura exacta:
{
  "player_name": "Nombre real extraído",
  "beatmap_name": "Nombre del mapa (sin la dificultad, lo más limpio posible para buscarlo)",
  "difficulty_name": "Nombre de la dificultad (entre corchetes en el título normalmente)",
  "accuracy": 0.9571,
  "max_combo": 631,
  "score": 13358510,
  "statistics": { "great": 1314, "ok": 83, "meh": 1, "miss": 4 },
  "mods": ["NM"],
  "rank": "A"
}
Texto adicional del mensaje (si lo hay):
${textPart}`;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const parts = [{ text: prompt }];
    if (imagePart) parts.push(imagePart);

    let parsedData;
    try {
        await message.channel.sendTyping(); // In case Gemini takes a while
        const result = await model.generateContent(parts);
        let responseText = result.response.text();
        
        responseText = responseText.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
        parsedData = JSON.parse(responseText);
    } catch (e) {
        console.error("Error al procesar con Gemini:", e);
        return "Hubo un error al extraer los datos de la imagen o texto usando IA.";
    }

    // Buscar beatmap
    let beatmap_id = null;
    if (reply.embeds.length > 0) {
        const { beatmap_url } = await findBeatmapInChannel(reply, true);
        if (beatmap_url) beatmap_id = beatmap_url;
    }

    if (!beatmap_id) {
        beatmap_id = await getBeatmapIdFromSearch(parsedData.beatmap_name, parsedData.difficulty_name);
    }

    if (!beatmap_id) {
        return `No pude encontrar el mapa \`${parsedData.beatmap_name}\` en la base de datos de osu!.`;
    }

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

    const recent_scores = {
        accuracy: parsedData.accuracy,
        ended_at: new Date().toISOString(),
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

    saveUserscore(recent_scores, pre_calculated);

    const roleColor = message.member.roles.highest.color || '#ffffff';
    const embedColor = roleColor !== 0 ? roleColor : '#ffffff';
    
    const emoji_grades = require("../../../src/emoji_grades.json");
    let grade_emoji = emoji_grades[!recent_scores.passed ? "F" : recent_scores.rank];
    grade_emoji = grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}:` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`;
    
    const emoji_mods = require("../../../src/emoji_mods.json");
    const mods_used = recent_scores.mods.reduce((acc, mod) => `${acc}<:${mod.acronym}:${emoji_mods[mod.acronym] || '123'}>`, '');

    const map_completion = recent_scores.passed ? `` : `(${((pre_calculated.map_completion)*100).toFixed(2)}%)`;

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Score manual guardada para ${parsedData.player_name}`,
            url: `https://osu.ppy.sh/users/${user_id}`,
            iconURL: recent_scores.user.avatar_url
        })
        .setTitle(`${recent_scores.beatmapset.title} [${recent_scores.beatmap.version}] - ${recent_scores.beatmap.difficulty_rating + '★'} `)
        .setURL(`https://osu.ppy.sh/b/${beatmap_id}`)
        .setDescription(`**Puntuación**: \`${recent_scores.legacy_total_score.toLocaleString('es-ES')}\` **▸** ${grade_emoji} ${map_completion} **▸** ${mods_used}
\`\`\`ansi
${colorear(great, "azul")}/${colorear(ok, "verde")}/${colorear(meh, "amarillo")}/${colorear(miss, "rojo")} ${colorear(pre_calculated.pp.toFixed(2) + 'PP')}/${maxAttrs.pp.toFixed(2)}PP ${(recent_scores.accuracy * 100).toFixed(2)}% x${recent_scores.max_combo}/${colorear(pre_calculated.beatmap_max_combo)}
\`\`\`
        `)
        .setImage(recent_scores.beatmapset.covers["cover@2x"])
        .setColor(embedColor)
        .setFooter({ text: "SengoBot", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();

    map.free();
    return { content: '', embeds: [embed] };
}

run.alias = {
    "save": { "args": "" }
}

run.description = {
    'header': 'Sube una score a la base de datos de Sengo.',
    'body': 'Haz reply a una imagen o a un embed (de OwO bot o Sengo) con los detalles de una score y la guardará en la base de datos local.',
    'usage': `s.subir (respondiendo a un mensaje)`
}

module.exports = { run, "description": run.description }
