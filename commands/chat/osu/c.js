const { EmbedBuilder } = require('discord.js');
const { getUnrankedBeatmapUserAllScores, argsParser, getBeatmapUserAllScores, findBeatmapInChannel, getBeatmap, getOsuUser } = require("../../utils/osu.js");

async function doEmbed(message, user_scores){
    const emoji_mods = require("../../../src/emoji_mods.json");
    const emoji_grades = require("../../../src/emoji_grades.json");
    
    let embed_description = '';

    user_scores.forEach(score => {

        let rank_pos = `#${user_scores.indexOf(score)}`;

        let grade_emoji = emoji_grades[!score.passed ? "F" : score.rank];
    	    grade_emoji = grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}:` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`;

        let legacy_score = score.legacy_total_score.toLocaleString('es-ES');
        
        let accuracy = (score.accuracy * 100).toFixed(2);
        
        let max_combo = score.max_combo;

        let statistics = score.statistics;
            statistics = `\`${statistics.great || 0}/${statistics.ok || 0}/${statistics.meh || 0}/${statistics.miss || 0}\``

        let pp = `${score.pp ? score.pp.toFixed(2) : 0}`;

        let time_set = `<t:${Math.floor((new Date(score.ended_at)).getTime() / 1000)}:R>`;

        const mods_used = score.mods.reduce((acc, mod) => `${acc}<:${mod.acronym}:${emoji_mods[mod.acronym]}>`, '');

        
        embed_description = embed_description.concat(user_scores.indexOf(score) != 0 ?
`${rank_pos} - ${grade_emoji} - ${legacy_score} - ${accuracy}% - ${max_combo} - ${statistics} - ${pp} - ${time_set} - ${mods_used}\n` : 
`**${rank_pos}** - ${grade_emoji} - **${legacy_score}** - **${accuracy}%** - **${max_combo}** - ${statistics} - **${pp}** - ${time_set} - ${mods_used}\n`
        )

    });

    const embed = new EmbedBuilder()
        .setDescription(embed_description)
        .setFooter({
            text: "SengoBot",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

async function doContent(parsed_args, user_found, beatmap_metadata){
    const { title } = beatmap_metadata.beatmapset;
    const { difficulty_rating, version, url} = beatmap_metadata;

    if(parsed_args.username[0] == '') parsed_args.username[0] = user_found.osu_id;
    const username = (await getOsuUser(parsed_args)).username;

    let mapa = `[${title} [${version}] - ${difficulty_rating + '★'} ](${url})`;
    const content = `**Puntuaciones de \`${username}\` en \`osu!${parsed_args.gamemode}\`: \n${mapa}**`;
    
    return content;
}

async function run(messages, args){
    const {message, res, reply} = messages;

    const {beatmap_url, bad_response} = reply ? await findBeatmapInChannel(reply, true) : await findBeatmapInChannel(message, false);
    if(!beatmap_url) return bad_response;

    // Para revisar si es graveyard o no
    const beatmap_metadata = await getBeatmap(beatmap_url);
    const unranked_statuses = new Set(['pending', 'graveyard']);

    const { fn_response, parsed_args, user_found } = await argsParser(args,                  // Si es un mapa unranked lo mandamos a buscar los scores locales, sino los rankeados
		{"message" : message, "res" : res, "beatmap_url" : beatmap_url, "command_function" : unranked_statuses.has(beatmap_metadata.status) ? getUnrankedBeatmapUserAllScores : getBeatmapUserAllScores});

    if(typeof fn_response === 'string') return `Error consiguiendo las puntuaciones para ese mapa.`;   
    if(fn_response.length == 0) return `El usuario no tiene scores en el mapa.`;

    const embed = await doEmbed(message, fn_response);
    const content = await doContent(parsed_args, user_found, beatmap_metadata);

    if(reply){
        reply.reply({content: content, embeds: [embed]});
        return;
    }

    return {content: content, embeds: [embed]};
}

run.alias = {
    "comparar" : {
        "args" : ""
    },
    "compara" : {
        "args" : ""
    },
    "compare" : {
        "args" : ""
    },
    "cm" : {
        "args" : "-mania"
    },
    "cc" : {
        "args" : "-ctb"
    },
    "ct" : {
        "args" : "-taiko"
    }
}

run.description = 
{
    'header' : "El >c de toda la vida",
    'body' : 'Compara una score en el ultimo mapa que consigue el Sengo. La score puede ser del usuario del comando u otro jugador',
    'usage' : `s.c : Compara la score del usuario linkeado al bot \ns.c 'usuario' : Compara la score del usuario en el argumento. \ns.c 'modo' : Compara por modo de juego \ns.c 'usuario' 'modo' : Se pueden combinar ambos.`
}

module.exports = { run, "description": run.description}