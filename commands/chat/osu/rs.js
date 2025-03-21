const { getBeatmap_osu, saveUserscore, getUserRecentScores, argsParser, getBeatmap } = require("../../utils/osu.js");
const { colorear } = require("../../utils/admin.js");

const { EmbedBuilder } = require("discord.js");
const axios = require('axios').default;
const fs = require('fs');
const path = require('path');
const rosu = require("rosu-pp-js");

function calculatePP(recent_scores, map, maximo_pp, Attrs){
	// Se consiguen los 300, 100, 50, misses
	const { great = 0, ok = 0, meh = 0, miss = 0 } = recent_scores.statistics;

	// Por si se quiere calcular el maximo PP del mapa dado
	if(maximo_pp){

		const maxAttrs = new rosu.Performance({ mods: recent_scores.mods, lazer: false }).calculate(Attrs ? Attrs : map); // Por si no hay atributos se calcula con el mapa
		return maxAttrs;
	}

	// Si el usuario no completo el mapa
	if(!recent_scores.passed){

		// Total de objetos hiteados
		const total_hits = great + ok + meh + miss;

		// Se construye la dificultad
		const difficulty = new rosu.Difficulty({
			mods: recent_scores.mods,
			
			ar: map.ar,
			arWithMods: false,
			cs: map.cs,
			csWithMods: false,
			hp: map.hp,
			hpWithMods: false,
			od: map.od,
			odWithMods: false,

			lazer: false,
			// passedObjects: total_hits
		});

		// Se construye para calcular el PP gradual
		// La cual se pasa el estado actual de la play junto con el combo para calcular dicho pp hasta ese punto
		const gradualPerf = difficulty.gradualPerformance(map);
		const state = {
			maxCombo: recent_scores.max_combo,
			misses: miss,
			n300: great,
			n100: ok,
			n50: meh, 

			// SOPORTE LAZER Y OTROS MODOS
			// nGeki?: number;
			// nKatu?: number;
			// osuLargeTickHits?: number;
			// osuSmallTickHits?: number;
			// sliderEndHits?: number;
		}

		return gradualPerf.nth(state, total_hits);
	} 

	// Se calcula el pp y atributos para el usuario que completo el mapa
	const currAttrs = new rosu.Performance({
		mods: recent_scores.mods,

		lazer: false,

		n300: great,
		n100: ok,
		n50: meh,	
		misses: miss,	
		combo: recent_scores.max_combo,	
		hitresultPriority: rosu.HitResultPriority.WorstCase,

	}).calculate(Attrs ? Attrs : map); // Por si no hay atributos se calcula con el mapa

	return currAttrs;	
}

async function doOsuEmbed(message, recent_scores, pre_calculated){
	const username = recent_scores.user.username;
	const user_url = `https://osu.ppy.sh/users/${recent_scores.user.id}`;
	const avatar_url = recent_scores.user.avatar_url;

	const song_title = recent_scores.beatmapset.title;

	const beatmap_difficulty = recent_scores.beatmap.version;
	const beatmap_url = `https://osu.ppy.sh/b/${recent_scores.beatmap.id}`;
	const beatmap_cover = recent_scores.beatmapset.covers["cover@2x"];

	const score = recent_scores.legacy_total_score.toLocaleString('es-ES');
	
	const accuracy = (recent_scores.accuracy * 100).toFixed(2);
	const user_max_combo = recent_scores.max_combo;

	const beatmap_max_combo = pre_calculated.beatmap_max_combo;

	const user_pp = `${pre_calculated.pp.toFixed(2)}`

	const difficulty = recent_scores.beatmap.difficulty_rating;

	const roleColor = message.member.roles.highest.color || '#ffffff';
    const embedColor = roleColor !== 0 ? roleColor : '#ffffff';

	const { great = 0, ok = 0, meh = 0, miss = 0 } = recent_scores.statistics;

	const emoji_mods = require("../../../src/emoji_mods.json");
    const emoji_grades = require("../../../src/emoji_grades.json");

	let grade_emoji = emoji_grades[!recent_scores.passed ? "F" : recent_scores.rank];
    	grade_emoji = grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}:` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`;

	const mods_used = recent_scores.mods.reduce((acc, mod) => `${acc}<:${mod.acronym}:${emoji_mods[mod.acronym]}>`, '');

	const map_completion = recent_scores.passed ? `` : `(${((pre_calculated.map_completion)*100).toFixed(2)}%)`;

	// Construccion del embed
	const embed = new EmbedBuilder()
		.setAuthor({
			name: `Puntuación Reciente de ${username} en ${recent_scores.beatmap.mode}!`,
			url: user_url,
			iconURL: `${avatar_url}`,
		})
		.setTitle(`${song_title} [${beatmap_difficulty}] - ${difficulty + '★'} `)
		.setURL(beatmap_url)
		.setDescription(`**Puntuación**: \`${score}\` **▸** ${grade_emoji} ${map_completion} **▸** ${mods_used}
\`\`\`ansi
${colorear(great, "azul")}/${colorear(ok, "verde")}/${colorear(meh, "amarillo")}/${colorear(miss, "rojo")} ${colorear(user_pp + 'PP')}/${pre_calculated.maxAttrs.pp.toFixed(2)} ${accuracy}% x${user_max_combo}/${colorear(beatmap_max_combo)}
\`\`\`
		`)
		.setImage(beatmap_cover)
		.setColor(embedColor)
		.setFooter({
			text: "SengoBot",
			iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
		})
		.setTimestamp(new Date(recent_scores.ended_at));
  
	return embed;
}

async function run(messages, args) {
    const { message, res } = messages;

    // Parseamos args
    const recent_scores = (await argsParser(args, {
        "message": message,
        "res": res,
        "command_function": getUserRecentScores
    })).fn_response[0];

    // Si no hay play reciente
    if (typeof recent_scores === 'string') return recent_scores;
    if (!recent_scores) return `Pero si no has jugado nada`;

	// Precalculamos algunos parametros
	const { great = 0, ok = 0, meh = 0, miss = 0 } = recent_scores.statistics;
	const total_hits = great + ok + meh + miss;
	const beatmap = await getBeatmap(recent_scores.beatmap.id);
	const map = new rosu.Beatmap(fs.readFileSync(await getBeatmap_osu(recent_scores.beatmap.beatmapset_id, recent_scores.beatmap.id, beatmap))); // obtenemos el beatmap.osu y luego pasamos la direccion para un nuevo mapa parseado para el calculo de pp
	const maxAttrs = calculatePP(recent_scores, map, "maximo_pp"); // calculamos el pp para un ss

	const pre_calculated = {
		"map" : map,
		"map_completion" : recent_scores.passed ? 100 : total_hits/map.nObjects,
		"maxAttrs" : maxAttrs,
		"pp" : recent_scores.pp ? recent_scores.pp : calculatePP(recent_scores, map, null, maxAttrs).pp,
		"beatmap_max_combo": beatmap.max_combo,
	}

	// Guardamos la score
	saveUserscore(recent_scores, pre_calculated);

    // Se contruye el embed y se envia
    const embed = await doOsuEmbed(message, recent_scores, pre_calculated);

	map.free(); // si
    return { content: '', embeds: [embed] };
}

run.description = 
{
    'header' : 'Obten la play reciente',
    'body' : undefined,
    'usage' : `s.rs : Obten la play reciente del usuario linkeado al bot.\ns.rs 'usuario' : Obtiene del usuario en el argumento\ns.rs 'usuario' 'modo': Obtiene del usuario en el argumento con respecto al modo de juego.`
}

module.exports = { run, "description": run.description}


