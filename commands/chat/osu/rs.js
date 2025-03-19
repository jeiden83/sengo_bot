const { argsParser, getRecentScores, getBeatmap } = require("../../utils/osu.js");
const { colorear } = require("../../utils/admin.js");
const { EmbedBuilder } = require("discord.js");

async function doOsuEmbed(message, recent_scores){
	const beatmap_metadata = await getBeatmap(recent_scores.beatmap.id); // beatmap_metadata.max_combo

	const username = recent_scores.user.username;
	const user_url = `https://osu.ppy.sh/users/${recent_scores.user.id}`;
	const avatar_url = recent_scores.user.avatar_url;

	const song_title = recent_scores.beatmapset.title;
	const song_artist = recent_scores.beatmapset.artist;

	const beatmap_difficulty = recent_scores.beatmap.version;
	const beatmap_url = `https://osu.ppy.sh/b/${recent_scores.beatmap.id}`;
	const beatmap_cover = recent_scores.beatmapset.covers["cover@2x"];

	const score = recent_scores.score.toLocaleString('es-ES');
	const arr_mods = recent_scores.mods;
	const accuracy = (recent_scores.accuracy * 100).toFixed(2);
	const user_max_combo = recent_scores.max_combo;
	const user_pp = `${recent_scores.pp == 0 ? recent_scores.pp.toFixed(2) : 0}` 
 	const difficulty = recent_scores.beatmap.difficulty_rating;

	const roleColor = message.member.roles.highest.color || '#ffffff';
    const embedColor = roleColor !== 0 ? roleColor : '#ffffff';

	const count_x = recent_scores.statistics.count_miss;
	const count_50 = recent_scores.statistics.count_50;
	const count_100 = recent_scores.statistics.count_100;
	const count_300 = recent_scores.statistics.count_300;

	const emoji_mods = require("../../../src/emoji_mods.json");
    const emoji_grades = require("../../../src/emoji_grades.json");

	let grade_emoji = emoji_grades[recent_scores.rank];
        grade_emoji = grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}:` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`;

	let mods_used = recent_scores.mods.length > 0 ? 
		recent_scores.mods.reduce((acc, mod) => `${acc}<:${mod}:${emoji_mods[mod]}>`, '')
	:   `<:NM:${emoji_mods['NM']}>`;

	// Construccion del embed
	const embed = new EmbedBuilder()
		.setAuthor({
			name: `Puntuación Reciente de ${username} en ${beatmap_metadata.mode}!`,
			url: user_url,
			iconURL: `${avatar_url}`,
		})
		.setTitle(`${song_title} [${beatmap_difficulty}] - ${difficulty + '★'} `)
		.setURL(beatmap_url)
		.setDescription(`**Puntuación**: \`${score}\` **▸** ${grade_emoji} **▸** ${mods_used}
\`\`\`ansi
${colorear(count_300, "azul")}/${colorear(count_100, "verde")}/${colorear(count_50, "amarillo")}/${colorear(count_x, "rojo")} ${colorear(user_pp + 'PP')} ${accuracy}% x${user_max_combo}/${colorear(beatmap_metadata.max_combo)}
\`\`\`
		`)
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
    if(!recent_scores) return `Pero si no has jugado nada`;

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