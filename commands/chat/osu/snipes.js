const { getOsuUser, argsParser } = require("../../utils/osu.js");
const { EmbedBuilder } = require("discord.js");
const axios = require('axios');

async function fetchSnipedPlayerData(country_code, user_id) {
    const url = `https://api.huismetbenen.nl/player/${country_code}/${user_id}/`;
    
    try {
        const response = await axios.get(url);
        return response;   
    } catch (error) {
        
        console.error('Error al obtener los datos:', error.response ? error.response.data : error.message);
        return "Error de peticion";
    }
}

async function doOsuEmbed(message, sniped_userdata, osu_userdata){
    
    // // Check por si no ha tocado el modo de juego
    // const { global_ranking, discord_last_peak, peak_ranking, country_rank } = checkOsuData(osu_userdata);

    const roleColor = message.member.roles.highest.color || '#ffffff';
    const embedColor = roleColor !== 0 ? roleColor : '#ffffff';
    const icon_url = osu_userdata.team ? osu_userdata.team.flag_url : osu_userdata.avatar_url;

    const mod_mas_usado = Object.entries(sniped_userdata.mods_count).reduce((max, entry) => entry[1] > max[1] ? entry : max);
    const mostSnipes_year = Object.entries(sniped_userdata.dates_set).reduce((max, entry) => entry[1] > max[1] ? entry : max);

    const embed = new EmbedBuilder()
    .setAuthor({
        name: `${osu_userdata.team ? `[${osu_userdata.team.short_name}]`: ""} ${osu_userdata.username}: ${osu_userdata.statistics.pp}pp`,
        url: `https://osu.ppy.sh/users/${osu_userdata.id}`,
        iconURL: icon_url
    })
    .setDescription(`**• Total de #1:** \`#${sniped_userdata.count_total}\`
**• PP promedio :** \`${Math.round(sniped_userdata.average_pp * 100) / 100}\`
**• Mod mas usado:** \`[${mod_mas_usado[0]}] = ${mod_mas_usado[1]}\`
**• Año con mas snipes:** \`[${mostSnipes_year[0]}] = ${mostSnipes_year[1]}\`
`)
    // .setImage(osu_userdata.cover_url)
    // .setThumbnail(osu_userdata.avatar_url)
    .setColor(embedColor)
    .setFooter({
        text: "SengoBot",
        iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
    })
    .setTimestamp();

    return { embeds: [embed] };
}

async function run(messages, args){
    const { message, res } = messages;

    // Parseamos args
	const osu_userdata = await argsParser(args,
		{"message" : message, "res" : res, "command_function" : getOsuUser});  

    // Obtenemos el nombre y pais, y obtenemos los datos de la pagina
    const { country_code, id } = osu_userdata.fn_response;
    const sniped_userdata = await fetchSnipedPlayerData(country_code, id);

    return doOsuEmbed(message, sniped_userdata.data, osu_userdata.fn_response);
}
run.description = 
{
    'header' : 'Numero de tops nacionales',
    'body' : 'Toma en cuenta la pagina \`https://snipe.huismetbenen.nl/\` para esto. \nTe dice cuantos tops nacionales tienes, el promedio de pp por top, los mods mas usados y el año en el que snipeaste mas gente.',
    'usage' : `s.snipes : Obtiene los snipes del usuario linkeado al bot \ns.snipes 'usuario' : Los snipes del usuario en el argumento.`
}
module.exports = { run }