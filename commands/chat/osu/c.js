const { Client, Auth } = require('osu-web.js');
const { EmbedBuilder } = require('discord.js');
const { argsParser, getBeatmapUserAllScores, findBeatmapInChannel, getBeatmap, getOsuUser } = require("../../utils/osu.js");

const config = require("../../../config.json");
const axios = require('axios');

async function doEmbed(message, user_scores){
    const emoji_mods = require("../../../src/emoji_mods.json");
    const emoji_grades = require("../../../src/emoji_grades.json");
    
    let embed_description = '';

    user_scores.scores.forEach(score => {

        let rank_pos = `#${user_scores.scores.indexOf(score)}`;

        let grade_emoji = emoji_grades[score.rank];
            grade_emoji = `<:${grade_emoji[0]}:${grade_emoji[1]}>`;

        let legacy_score = score.score.toLocaleString('es-ES');
        
        let accuracy = (score.accuracy * 100).toFixed(2);
        
        let max_combo = score.max_combo;

        let statistics = score.statistics;
            statistics = `\`${statistics.count_300}/${statistics.count_100}/${statistics.count_50}/${statistics.count_miss}\``

        let pp = `${score.pp ? score.pp.toFixed(2) : 0}`;

        let time_set = `<t:${Math.floor((new Date(score.created_at)).getTime() / 1000)}:R>`;

        let mods_used = score.mods.length > 0 ? 
            score.mods.reduce((acc, mod) => `${acc}<:${mod}:${emoji_mods[mod]}>`, '')
        :   `<:NM:${emoji_mods['NM']}>`;

        
        embed_description = embed_description.concat(user_scores.scores.indexOf(score) != 0 ?
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

async function doContent(parsed_args, user_found){

    if(parsed_args.username[0] == '') parsed_args.username[0] = user_found.osu_id;
    const username = (await getOsuUser(parsed_args)).username;

    const content = `> **Puntuaciones** de \`${username}\` en \`osu!${parsed_args.gamemode}\`:`;
    
    return content;
}

async function run(messages, args){
    const {message, res, reply} = messages;

    const {beatmap_url, bad_response} = reply ? await findBeatmapInChannel(reply, true) : await findBeatmapInChannel(message, false);
    if(!beatmap_url) return bad_response;

    const { fn_response, parsed_args, user_found } = await argsParser(args,
		{"message" : message, "res" : res, "beatmap_url" : beatmap_url, "command_function" : getBeatmapUserAllScores});

    if(typeof fn_response === 'string') return `Error consiguiendo las puntuaciones para ese mapa.`;   
    if(fn_response.scores.length == 0) return `El usuario no tiene scores en el mapa.`;

    const embed = await doEmbed(message, fn_response);
    const content = await doContent(parsed_args, user_found);

    if(reply){
        reply.reply({content: content, embeds: [embed]});
        return;
    }

    return {content: content, embeds: [embed]};
}
run.description = 
{
    'header' : "El >c de toda la vida",
    'body' : 'Compara una score en el ultimo mapa que consigue el Sengo. La score puede ser del usuario del comando u otro jugador',
    'usage' : `s.c : Compara la score del usuario linkeado al bot \ns.c 'usuario' : Compara la score del usuario en el argumento. \ns.c 'modo' : Compara por modo de juego \ns.c 'usuario' 'modo' : Se pueden combinar ambos.`
}

module.exports = { run, "description": run.description}