const { getBeatmap_osu, saveUserscore, getUserRecentScores, argsParser, getBeatmap, calculatePP } = require("../../utils/osu.js");
const { colorear } = require("../../utils/admin.js");

const { EmbedBuilder } = require("discord.js");
const axios = require('axios').default;
const fs = require('fs');
const path = require('path');
const rosu = require("rosu-pp-js");



async function doOsuEmbed(message, recent_scores, pre_calculated){
	const username = recent_scores.user.username;
	const user_url = recent_scores.user.server === 'gatari' ? `https://osu.gatari.pw/u/${recent_scores.user.id}` : `https://osu.ppy.sh/users/${recent_scores.user.id}`;
	const avatar_url = recent_scores.user.avatar_url;

	const song_title = recent_scores.beatmapset.title;

	const beatmap_difficulty = recent_scores.beatmap.version;
	const beatmap_url = `https://osu.ppy.sh/b/${recent_scores.beatmap.id}`;
	const beatmap_cover = recent_scores.beatmapset.covers["cover@2x"];

	const score = (recent_scores.legacy_total_score || recent_scores.total_score || 0).toLocaleString('es-ES');
	
	const accuracy = (recent_scores.accuracy * 100).toFixed(2);
	const user_max_combo = recent_scores.max_combo;

	const beatmap_max_combo = pre_calculated.beatmap_max_combo;

	const user_pp = `${pre_calculated.pp.toFixed(2)}`

	const difficulty = pre_calculated.maxAttrs.difficulty.stars.toFixed(2);

	const roleColor = message.member.roles.highest.color || '#ffffff';
    const embedColor = roleColor !== 0 ? roleColor : '#ffffff';

	const { perfect = 0, great = 0, good = 0, ok = 0, meh = 0, miss = 0 } = recent_scores.statistics;

	const emoji_mods = require("../../../src/emoji_mods.json");
    const emoji_grades = require("../../../src/emoji_grades.json");

	let grade_emoji = emoji_grades[!recent_scores.passed ? "F" : recent_scores.rank];
    	grade_emoji = grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}:` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`;

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

	const map_completion = recent_scores.passed ? `` : `(${((pre_calculated.map_completion)*100).toFixed(2)}%)`;

	let stats_str = "";
	let ratio_str = "";
	if (recent_scores.beatmap.mode === 'mania') {
		stats_str = `[${colorear(perfect, "cyan")}/${colorear(great, "amarillo")}/${colorear(good, "verde")}/${colorear(ok, "azul")}/${colorear(meh, "magenta")}/${colorear(miss, "rojo")}]`;
		const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
		ratio_str = ` ▸ ${ratio}:1`;
	} else if (recent_scores.beatmap.mode === 'taiko') {
		stats_str = `[${colorear(great, "azul")}/${colorear(ok, "verde")}/${colorear(miss, "rojo")}]`;
	} else {
		stats_str = `[${colorear(great, "azul")}/${colorear(ok, "verde")}/${colorear(meh, "amarillo")}/${colorear(miss, "rojo")}]`;
	}

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
${stats_str} ${colorear(user_pp + 'PP')}/${pre_calculated.maxAttrs.pp.toFixed(2)}PP ${accuracy}%${ratio_str} x${user_max_combo}/${colorear(beatmap_max_combo)}
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
	const map = await getBeatmap_osu(recent_scores.beatmap.beatmapset_id, recent_scores.beatmap.id, beatmap); // obtenemos el beatmap.osu y luego pasamos la direccion para un nuevo mapa parseado para el calculo de pp
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

run.alias = {
	"rm": {
		"args" : "-mania"
	},
	"rc": {
		"args" : "-ctb"
	}, 
	"rt": {
		"args" : "-taiko"
	}, 
	"recent": {
		"args" : ""
	},
	"r": {
		"args" : ""
	}
}

run.description = 
{
    'header' : 'Obten la play reciente',
    'body' : `Al hacer .rs en un mapa fallido o unranked, accedes a que se guarde en una db local para que luego se pueda usar con el .c y el .gap`,
    'usage' : `s.rs : Obten la play reciente del usuario linkeado al bot.\ns.rs 'usuario' : Obtiene del usuario en el argumento\ns.rs 'usuario' 'modo': Obtiene del usuario en el argumento con respecto al modo de juego.`
}

module.exports = { run, "description": run.description}