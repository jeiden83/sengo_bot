const { argsParser, getRecentScores, getBeatmap } = require("../../utils/osu.js");
const { EmbedBuilder } = require("discord.js");
// const fs = require('fs/promises');
// const path = require('path');   

async function doOsuEmbed(message, recent_scores){
	/**
	 * variables para el embed
	 * 
	 * por hacer:
	 * max combo del mapa
	 * pp if dead
	 * ranking de la play
	 * ranking country de la play
	 * puntuacion del lazer
	 * 
	 */ 
	const beatmap_metadata = await getBeatmap(recent_scores.beatmap.id); // beatmap_metadata.max_combo

	const username = recent_scores.user.username;
	const user_url = `https://osu.ppy.sh/users/${recent_scores.user.id}`;
	const avatar_url = recent_scores.user.avatar_url;

	const song_title = recent_scores.beatmapset.title;
	const song_artist = recent_scores.beatmapset.artist;

	const beatmap_difficulty = recent_scores.beatmap.version;
	const difficulty_mapper = recent_scores.beatmapset.creator;
	const beatmap_url = `https://osu.ppy.sh/b/${recent_scores.beatmap.id}`;
	const beatmap_cover = recent_scores.beatmapset.covers["cover@2x"];

	const score = recent_scores.score.toLocaleString('es-ES');
	const arr_mods = recent_scores.mods;
	const mods_used = arr_mods.length > 0 ? arr_mods.join("") : "NM";
	const accuracy = (recent_scores.accuracy * 100).toFixed(2);
	const user_max_combo = recent_scores.max_combo;
	const user_pp = `\`${recent_scores.pp || "\`muerto\`"}\`` 
 	const difficulty = recent_scores.beatmap.difficulty_rating;

	const roleColor = message.member.roles.highest.color || '#ffffff';
    const embedColor = roleColor !== 0 ? roleColor : '#ffffff';

	const count_x = recent_scores.statistics.count_miss;
	const count_50 = recent_scores.statistics.count_50;
	const count_100 = recent_scores.statistics.count_100;
	const count_300 = recent_scores.statistics.count_300;

	// Construccion del embed
	const embed = new EmbedBuilder()
		.setAuthor({
			name: `Puntuación Reciente de ${username}`,
			url: user_url,
			iconURL: `${avatar_url}`,
		})
		// .setTitle(`${song_title} por ${song_artist} / Dif. [${beatmap_difficulty}] por ${difficulty_mapper}`)
		.setTitle(`${song_title} [${beatmap_difficulty}] +${mods_used} \n${song_artist}`)
		.setURL(beatmap_url)
		.addFields(
		{
			name: "Puntuación",
			value: `\`${score}\``,
			inline: true
		},
		{
			name: "Mapper",
			value: `\`${difficulty_mapper}\``,
			inline: true
		},
		{
			name: "Precisión",
			value: `\`${accuracy}%\``,
			inline: true
		},
		{
			name: "Combo",
			value: `\`${user_max_combo}\` / \`${beatmap_metadata.max_combo}\``,
			inline: true
		},
		{
			name: "PP",
			value: user_pp,
			inline: true
		},
		{
			name: "Dificultad",
			value: `\`${difficulty}\` ★`,
			inline: true
		},
		{
			name: "Estadísticas",
			value: `\`\`\`ansi
[1;2m[1;40m[1;37m[300/100/50/X][0m[1;40m[0m[0m <:>[2;37m [2;42m[2;45m[2;41m[2;40m[0m[2;37m[2;41m[0m[2;37m[2;45m[0m[2;37m[2;42m[0m[2;37m[0m[2;37m[2;40m[${count_300}/${count_100}/${count_50}/${count_x}][0m[2;37m[0m
\`\`\``,
			inline: false
		},
		)
		.setImage(beatmap_cover)
		.setColor(embedColor)
		.setFooter({
			text: "SengoBot",
			iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
		})
		.setTimestamp(new Date(recent_scores.created_at));
  
	return embed;
}

async function run(messages, args){
    const {message, res} = messages;

	// Parseamos args
	const recent_scores = (await argsParser(args,
		{"message" : message, "res" : res, "command_function" : getRecentScores})).fn_response;
    
    // Si no hay play reciente
	if(typeof recent_scores === 'string') return recent_scores;
    if(!recent_scores) return `pedazo de mogolico no jugaste nada`

    // Se contruye el embed y se envia
	const embed = await doOsuEmbed(message, recent_scores);
	return {content: '', embeds: [embed]};
}

run.description = 
{
    'header' : 'Obten la play reciente',
    'body' : undefined,
    'usage' : `s.rs : Obten la play reciente del usuario linkeado al bot.\ns.rs 'usuario' : Obtiene del usuario en el argumento\ns.rs 'usuario' 'modo': Obtiene del usuario en el argumento con respecto al modo de juego.`
}

module.exports = { run, "description": run.description}