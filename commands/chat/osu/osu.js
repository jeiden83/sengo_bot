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

async function doOsuEmbed(message, osu_userdata, osu_mode, is_detailed = false){
    
    // Check por si no ha tocado el modo de juego
    const { global_ranking, discord_last_peak, peak_ranking, country_rank } = checkOsuData(osu_userdata);
    
    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ffffff';
    const icon_url = osu_userdata.team ? osu_userdata.team.flag_url : osu_userdata.avatar_url;

    const join_date = `<t:${Math.floor(new Date(osu_userdata.join_date).getTime() / 1000)}:R>`;

    let top_ranking_str = osu_userdata.server === 'gatari' ? "" : `**• Top ranking:** \`#${peak_ranking}\`  ${discord_last_peak}\n`;

    const embed = new EmbedBuilder()
    .setAuthor({
        name: `Perfil osu!${osu_mode} de ${osu_userdata.team ? `[${osu_userdata.team.short_name}]`: ""} ${osu_userdata.username}`,
        url: osu_userdata.server === 'gatari' ? `https://osu.gatari.pw/u/${osu_userdata.id}` : `https://osu.ppy.sh/users/${osu_userdata.id}`,
        iconURL: icon_url
    })
    .setDescription(`**• Ranking global:** \`#${global_ranking}\`\n${top_ranking_str}**• Ranking por pais:** :flag_${osu_userdata.country_code.toLowerCase()}: \`#${country_rank}\`${osu_userdata.team ? `\n **• Team: [[${osu_userdata.team.short_name}] ${osu_userdata.team.name}](https://osu.ppy.sh/teams/${osu_userdata.team.id})**`: ``} \n**• Fecha de inicio: **${join_date}`)
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

    if (!is_detailed) {
        return { embeds: [embed] };
    }

    // Embed detallado (Doble página)
    const emoji_grades = require("../../../src/emoji_grades.json");
    const getGradeEmoji = (gradeKey) => {
        const data = emoji_grades[gradeKey];
        if (!data) return gradeKey;
        return `<:${data[0]}:${data[1]}>`;
    };

    const grades = osu_userdata.statistics.grade_counts;
    const grades_str = 
        `${getGradeEmoji("XH")} \`${(grades.ssh || 0).toLocaleString('es-ES')}\`   ` +
        `${getGradeEmoji("X")} \`${(grades.ss || 0).toLocaleString('es-ES')}\`   ` +
        `${getGradeEmoji("SH")} \`${(grades.sh || 0).toLocaleString('es-ES')}\`   ` +
        `${getGradeEmoji("S")} \`${(grades.s || 0).toLocaleString('es-ES')}\`   ` +
        `${getGradeEmoji("A")} \`${(grades.a || 0).toLocaleString('es-ES')}\``;

    // --- CÁLCULOS PARA EL ANÁLISIS RÁPIDO ---
    const total_grades = (grades.ssh || 0) + (grades.ss || 0) + (grades.sh || 0) + (grades.s || 0) + (grades.a || 0);
    const ss_percent = total_grades > 0 ? (((grades.ssh || 0) + (grades.ss || 0)) / total_grades * 100).toFixed(1) : "0.0";
    const s_percent = total_grades > 0 ? (((grades.sh || 0) + (grades.s || 0)) / total_grades * 100).toFixed(1) : "0.0";
    const a_percent = total_grades > 0 ? ((grades.a || 0) / total_grades * 100).toFixed(1) : "0.0";

    const joinDate = new Date(osu_userdata.join_date);
    const diffDays = Math.max(1, Math.ceil(Math.abs(Date.now() - joinDate) / (1000 * 60 * 60 * 24)));
    const avg_playcount_day = (osu_userdata.statistics.play_count / diffDays).toFixed(1);
    
    const playcountVal = osu_userdata.statistics.play_count || 0;
    const pp_per_1k = playcountVal > 0 ? (osu_userdata.statistics.pp / (playcountVal / 1000)).toFixed(1) : "0.0";
    const hits_per_play = playcountVal > 0 ? (osu_userdata.statistics.total_hits / playcountVal).toFixed(1) : "0.0";
    const hits_per_min = osu_userdata.statistics.play_time > 0 ? Math.round(osu_userdata.statistics.total_hits / (osu_userdata.statistics.play_time / 60)) : 0;

    const analysis_desc = 
        `**Grados Obtenidos:**\n${grades_str}\n\n` +
        `📊 **Perfil de Precisión (Ratios):**\n` +
        ` ▸ **SS Ranks (FC Perfecto):** \`${ss_percent}%\` del total\n` +
        ` ▸ **S Ranks (FC/Buen Acc):** \`${s_percent}%\` del total\n` +
        ` ▸ **A Ranks (Pass/Bajo Acc):** \`${a_percent}%\` del total\n\n` +
        `⚡ **Análisis Rápido de Rendimiento:**\n` +
        ` ▸ **Antigüedad de la cuenta:** \`${diffDays.toLocaleString('es-ES')}\` días\n` +
        ` ▸ **Ritmo de Juego:** \`${avg_playcount_day}\` playcount/día\n` +
        ` ▸ **Eficiencia de PP:** \`${pp_per_1k}\` PP por cada 1,000 plays\n` +
        ` ▸ **Consistencia de Hits:** \`${hits_per_play}\` hits promedio por jugada\n\n` +
        `**Estadísticas de Puntuación:**`;

    const embed2 = new EmbedBuilder()
    .setAuthor({
        name: `Rendimiento Detallado de ${osu_userdata.username}`,
        url: osu_userdata.server === 'gatari' ? `https://osu.gatari.pw/u/${osu_userdata.id}` : `https://osu.ppy.sh/users/${osu_userdata.id}`,
        iconURL: icon_url
    })
    .setDescription(analysis_desc)
    .addFields(
        {
            name: "Puntuación Clasificada",
            value: `\`${(osu_userdata.statistics.ranked_score || 0).toLocaleString('es-ES')}\``,
            inline: true
        },
        {
            name: "Puntuación Total",
            value: `\`${(osu_userdata.statistics.total_score || 0).toLocaleString('es-ES')}\``,
            inline: true
        },
        {
            name: "Combo Máximo",
            value: `\`x${(osu_userdata.statistics.maximum_combo || 0).toLocaleString('es-ES')}\``,
            inline: true
        },
        {
            name: "Hits Totales",
            value: `\`${(osu_userdata.statistics.total_hits || 0).toLocaleString('es-ES')}\``,
            inline: true
        },
        {
            name: "Replays Vistas por Otros",
            value: `\`${(osu_userdata.statistics.replays_watched_by_others || 0).toLocaleString('es-ES')}\``,
            inline: true
        },
        {
            name: "Hits por Minuto",
            value: `\`${hits_per_min.toLocaleString('es-ES')}\``,
            inline: true
        }
    )
    .setColor(embedColor)
    .setFooter({
        text: "SengoBot • Página 2 de 2 • Estadísticas Detalladas",
        iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
    })
    .setTimestamp();

    return { embeds: [embed, embed2] };
}

async function run(messages, args){
    const { message, res, logger } = messages;

    if (logger) logger.process("Consultando base de datos y API de osu!");
	const osu_userdata = await argsParser(args,
		{"message" : message, "res" : res, "command_function" : getOsuUser});  

	if(!osu_userdata.fn_response || typeof osu_userdata.fn_response === 'string') {
        return osu_userdata.fn_response;
    }

    const is_detailed = osu_userdata.parsed_args.detailed || false;
    return doOsuEmbed(message, osu_userdata.fn_response, (osu_userdata.parsed_args.gamemode), is_detailed);
}

run.alias = {
    "mania" : {
        "args" : "-mania"
    },
    "minijuego" : {
        "args" : "-mania"
    },
    "ctb" : {
        "args" : "-ctb"
    },
    "taiko" : {
        "args" : "-taiko"
    },
    "std" : {
        "args" : ""
    },
    "o" : {
        "args" : ""
    },
    "scores" : {
        "args" : "-d"
    },
}

run.description = 
{
    'header' : 'Para obtener el perfil de osu!',
    'body' : 'Muestra el perfil de un usuario en osu! dado, sea el vinculado al bot o segun el argumento, con su banner bien hermoso y opción de ver detalles adicionales.',
    'usage' : `s.osu : Muestra el perfil vinculado al bot.\ns.osu 'usuario_osu' : Muestra el perfil de std del usuario en el argumento.\ns.osu 'usuario_osu' -d : Muestra el perfil completo junto a las estadísticas y grados detallados.\ns.scores : Muestra tus estadísticas y grados detallados directos.`
}

module.exports = { run }