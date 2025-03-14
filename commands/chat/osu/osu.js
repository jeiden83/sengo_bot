const { getOsuUser, argsParser } = require("../../utils/osu.js");
const { EmbedBuilder } = require("discord.js");
const fs = require('fs');
const path = require('path');

function checkOsuData(osu_userdata){
    
    const global_ranking = osu_userdata.statistics.global_rank || 0;
    const peak_ranking = osu_userdata.rank_highest ? osu_userdata.rank_highest.rank : 0;
    const discord_last_peak = osu_userdata.rank_highest ? `<t:${Math.floor((new Date(osu_userdata.rank_highest.updated_at)).getTime() / 1000)}:R>` : `\`nunca jugado\``
    const country_rank = osu_userdata.statistics.rank.country || 0 

    return {
        global_ranking, discord_last_peak, peak_ranking, country_rank
    }
}

async function doOsuEmbed(message, osu_userdata, osu_mode){
    
    // Check por si no ha tocado el modo de juego
    const { global_ranking, discord_last_peak, peak_ranking, country_rank } = checkOsuData(osu_userdata);
    
    const roleColor = message.member.roles.highest.color || '#ffffff';
    const embedColor = roleColor !== 0 ? roleColor : '#ffffff';
    const icon_url = osu_userdata.team ? osu_userdata.team.flag_url : osu_userdata.avatar_url;

    const embed = new EmbedBuilder()
    .setAuthor({
        name: `Perfil osu!${osu_mode} de ${osu_userdata.team ? `[${osu_userdata.team.short_name}]`: ""} ${osu_userdata.username}`,
        url: `https://osu.ppy.sh/users/${osu_userdata.id}`,
        iconURL: icon_url
    })
    .setDescription(`**• Ranking global:** \`#${global_ranking}\`\n**• Top ranking:** \`#${peak_ranking}\`  ${discord_last_peak}\n**• Ranking por pais:** :flag_${osu_userdata.country_code.toLowerCase()}: \`#${country_rank}\`\n ${osu_userdata.team ? `**• Team: [[${osu_userdata.team.short_name}] ${osu_userdata.team.name}](https://osu.ppy.sh/teams/${osu_userdata.team.id})**`: ``}`)
    .addFields(
        {
            name: "Medallas",
            value: `\`${osu_userdata.user_achievements.length}\``,
            inline: true
        },
        {
            name: "Tiempo de juego",
            value: `\`${Math.floor(osu_userdata.statistics.play_time / 3600)} h\``,
            inline: true
        },
        {
            name: "Nivel",
            value: `\`${osu_userdata.statistics.level.current}.${osu_userdata.statistics.level.progress}\``,
            inline: true
        },
        {
            name: "PP",
            value: `\`${Math.round(osu_userdata.statistics.pp)}\``,
            inline: true
        },
        {
            name: "Precision",
            value: `\`${osu_userdata.statistics.hit_accuracy.toFixed(2)}%\``,
            inline: true
        },
        {
            name: "Jugadas totales",
            value: `\`${osu_userdata.statistics.play_count}\``,
            inline: true
        } 
    )
    .setImage(osu_userdata.cover_url)
    .setThumbnail(osu_userdata.avatar_url)
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

	if(!osu_userdata.fn_response || typeof osu_userdata.fn_response === 'string') return osu_userdata.fn_response;

    // dump last user get
    // const osuUserPath = path.resolve('last_user_get.json');
    // await fs.promises.writeFile(osuUserPath, JSON.stringify(osu_userdata, null, 2));
    // console.log(`# Dumped user '${osu_userdata.fn_response.username}'`)

    return doOsuEmbed(message, osu_userdata.fn_response, (osu_userdata.parsed_args.gamemode));
}

run.description = 
{
    'header' : 'Para obtener el perfil de osu!',
    'body' : 'Muestra el perfil de un usuario en osu! dado, sea el vinculado al bot o segun el argumento, con su banner bien hermoso.',
    'usage' : `s.osu : Muestra el perfil vinculado al bot.\ns.osu 'usuario_osu' : Muestra el perfil de std del usuario en el argumento.\ns.osu 'usuario_osu' 'modo_juego' : Muestra con respecto al modo de juego dado.`
}

module.exports = { run }