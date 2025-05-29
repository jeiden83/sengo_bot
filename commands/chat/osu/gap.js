const { findBeatmapInChannel, getBeatmap, getNewBeatmapUserScores, getUnrankedUserScores } = require("../../utils/osu.js");
const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function doEmbed(message, user_scores){
    let embed_description = '';

    const emoji_mods = require("../../../src/emoji_mods.json");
    const emoji_grades = require("../../../src/emoji_grades.json");

    let position = 1;

    user_scores.forEach(score => {
    
        // Convierte el código de país a un emoji real usando Unicode.
        const getFlagEmoji = (countryCode) => {
            return countryCode
                .toUpperCase()
                .replace(/./g, char => String.fromCodePoint(0x1F1E6 - 65 + char.charCodeAt()));
        };
        let flag = getFlagEmoji(score.user ? score.user.country_code : "XX");
    
        let username = score.user ? score.user.username : score.username;
        let username_link = `[${username}](https://osu.ppy.sh/users/${score.user_id})`;

        let total_score = score.total_score.toLocaleString('es-ES');
        let accuracy = (score.accuracy * 100).toFixed(2);
    
        let max_combo = score.max_combo;
        let beatmap_max_combo = score.beatmap_max_combo ?? 0;

        let { great = 0, ok = 0, meh = 0, miss = 0 } = score.statistics;
            statistics = `\`${great}/${ok}/${meh}/${miss}\``;
    
        let pp = `${score.pp.toFixed(2)}`;
    
        let time_set = `<t:${Math.floor((new Date(score.ended_at)).getTime() / 1000)}:R>`;
    
        let grade_emoji = emoji_grades[!score.passed ? "F" : score.rank];
    	    grade_emoji = grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}: (${(score.map_completion*100).toFixed(2)}%)` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`;

        let mods_used = score.mods.reduce((acc, mod) => `${acc}<:${mod.acronym}:${emoji_mods[mod.acronym]}>`, '');

        embed_description = embed_description.concat(embed_description !== '' ?
            `${position++} - ${flag} ${username_link} - ${time_set} - ${grade_emoji}
            ${total_score} - ${accuracy}% - x${max_combo}/${beatmap_max_combo} - [${statistics}] - ${pp}PP - ${mods_used}\n\n` 
            
            :
            
            `**${position++}** - ${flag} **${username_link}** - ${time_set} - ${grade_emoji}
            **${total_score}** - **${accuracy}%** - **x${max_combo}/${beatmap_max_combo}** - [${statistics}] - **${pp}PP** - ${mods_used}\n\n`
        );
    
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

async function doContent(beatmap_metadata, user_scores, sorted_user_scores){
    const { title } = beatmap_metadata.beatmapset;
    const { difficulty_rating, version, url} = beatmap_metadata;

    let mapa = `[${title} [${version}] - ${difficulty_rating + '★'} ](${url})`;
    let content = `**De \`${user_scores.length}\` usuarios, \`${sorted_user_scores.size}\` tienen una score en: \n${mapa}**`;

    if(sorted_user_scores.size > 5) content = content.concat(`\n**Mostrando los primeros \`5\`**`);

    return content;
}

async function getLinkedMembers(message, res) {
    try {
        // Paso 1: Obtener el guildId directamente del mensaje
        const guild = message.guild;
        const members = await guild.members.fetch();

        // Paso 2: Obtener usuarios linkeados de la base de datos
        const linkedUsers = await res.User.find({ osu_id: { $ne: null } });
        const linkedDiscordIds = linkedUsers.map(user => user.discord_id);

        // Paso 3: Filtrar los miembros que están en la base de datos
        const linkedMembers = members.filter(member => linkedDiscordIds.includes(member.user.id));

        // Crear un array para almacenar los nombres, IDs y osu_id
        const userArray = linkedMembers.map(member => {
            // Obtener el usuario linkeado correspondiente
            const linkedUser = linkedUsers.find(user => user.discord_id === member.user.id);
            return {
                id: member.user.id,
                username: member.user.username,
                osu_id: linkedUser.osu_id
            };
        });

        return userArray;
    } catch (error) {
        console.error('Error obteniendo usuarios linkeados:', error);
        return [];
    }
}

async function run(messages, args){
    const { message, res, reply } = messages;

    const usersArray = await getLinkedMembers(message, res);

    const {beatmap_url, bad_response} = reply ? await findBeatmapInChannel(reply, true) : await findBeatmapInChannel(message, false);
    if(!beatmap_url) return bad_response;

    // Para revisar si es graveyard o no
    const beatmap_metadata = await getBeatmap(beatmap_url); // beatmap_metadata.max_combo

    const user_scores =  (beatmap_metadata.status == "pending" || beatmap_metadata.status == "graveyard") ? 
        await getUnrankedUserScores(beatmap_url) : 
        await getNewBeatmapUserScores(beatmap_url, usersArray);

    if(user_scores.size === 0) return {content: `**De los \`${usersArray.length}\` usuarios en el servidor** pues ninguno tiene una score en el mapa.`};

    // Si el mapa es loved, sera por puntuacion, sino por pp de manera descendente
    let sorted_user_scores = beatmap_metadata.status === "loved"
        ? user_scores.sort((a, b) => b.total_score - a.total_score)
        : user_scores.sort((a, b) => (b.pp ?? 0) - (a.pp ?? 0));

    const content = await doContent(beatmap_metadata, usersArray, sorted_user_scores);

    // Si hay mas de 5 de usuarios con una score en el mapa
    if(sorted_user_scores.size > 5) sorted_user_scores = sorted_user_scores.first(5);

    const embed = await doEmbed(message, sorted_user_scores);

    if(reply){
        reply.reply({content: content, embeds: [embed]});
        return;
    }

    return {content: content, embeds: [embed]};
}

run.alias = {
    "g" : {
        "args" : ""
    }
}

run.description = 
{
    'header' : '>c Global entre el server',
    'body' : 'Hace un >c con respecto a los usuarios linkeados en el servidor, y mostrando el top 5 entre mayor score y pp.',
    'usage' : `s.gap : Muestra el top 5 del server en el ultimo mapa dado.\ns.gap $reply : Hace el s.gap del mapa al que se le hizo el reply.`
}

module.exports = { run, "description": run.description}