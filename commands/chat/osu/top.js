const { getBeatmap_osu, getUserTopScores, argsParser, getBeatmap, calculatePP } = require("../../utils/osu.js");
const { colorear } = require("../../utils/admin.js");
const { EmbedBuilder } = require("discord.js");

async function doOsuListEmbed(message, parsed_args, top_scores_chunk, startIndex, total_plays, loadingIndex = null) {
    const emoji_mods = require("../../../src/emoji_mods.json");
    const emoji_grades = require("../../../src/emoji_grades.json");

    let embed_description = '';

    for (let i = 0; i < top_scores_chunk.length; i++) {
        const score = top_scores_chunk[i];
        const globalIndex = startIndex + i + 1; // 1-indexed for display

        let grade_emoji = emoji_grades[!score.passed ? "F" : score.rank];
        grade_emoji = grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}:` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`;

        const { perfect = 0, great = 0, good = 0, ok = 0, meh = 0, miss = 0 } = score.statistics;
        const total_hits = great + ok + meh + miss;

        let map_completion = "";
        if (score.calculatedPassPercent !== undefined) {
            if (!score.passed && score.calculatedPassPercent > 0) {
                map_completion = `*(${score.calculatedPassPercent.toFixed(1)}% pass)*`;
            }
        } else if (!score.passed) {
            const count_circles = score.beatmap.count_circles || 0;
            const count_sliders = score.beatmap.count_sliders || 0;
            const count_spinners = score.beatmap.count_spinners || 0;
            const total_objects = count_circles + count_sliders + count_spinners;
            if (total_objects > 0) {
                map_completion = `*(${((score.statistics.great + score.statistics.ok + score.statistics.meh + score.statistics.miss) / total_objects * 100).toFixed(1)}% pass)*`;
            }
        }
        
        let legacy_score = (score.legacy_total_score || score.total_score || 0).toLocaleString('es-ES');
        let accuracy = (score.accuracy * 100).toFixed(2);
        let max_combo = score.max_combo;

        let stats_str = "";
        let ratio_str = "";
        const gamemode = score.beatmap.mode || parsed_args.gamemode || 'osu';
        if (gamemode === 'mania') {
            stats_str = `\`[${perfect}/${great}/${good}/${ok}/${meh}/${miss}]\``;
            const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
            ratio_str = ` ▸ **${ratio}:1**`;
        } else if (gamemode === 'taiko') {
            stats_str = `\`[${great}/${ok}/${miss}]\``;
        } else {
            stats_str = `\`[${great}/${ok}/${meh}/${miss}]\``;
        }

        let ppVal = score.calculatedPP !== undefined ? score.calculatedPP : score.pp;
        let pp = `${ppVal ? ppVal.toFixed(2) + "pp" : "⏳ pp"}`;
        
        let starsVal = score.calculatedStars !== undefined ? score.calculatedStars : score.beatmap.difficulty_rating;
        const stars = starsVal ? `${starsVal.toFixed(2)}★` : "";
        
        let time_set = `<t:${Math.floor((new Date(score.ended_at)).getTime() / 1000)}:R>`;

        const mods_used = score.mods.length > 0 ? score.mods.reduce((acc, mod) => {
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

        const map_link = `[${score.beatmapset.title} [${score.beatmap.version}]](https://osu.ppy.sh/b/${score.beatmap.id})`;

        const score_line = `**#${globalIndex}** ▸ ${map_link} +${mods_used} [${stars}]\n` +
            ` ▸ ${grade_emoji} ▸ **${pp}** ▸ **${accuracy}%**${ratio_str} ▸ x${max_combo} ▸ ${stats_str} ▸ ${time_set} ${map_completion != "" ? `▸ ${map_completion}` : ""}\n\n`;

        embed_description = embed_description.concat(score_line);
    }

    const username = top_scores_chunk[0].user.username;
    const user_url = top_scores_chunk[0].user.server === 'gatari' ? `https://osu.gatari.pw/u/${top_scores_chunk[0].user.id}` : `https://osu.ppy.sh/users/${top_scores_chunk[0].user.id}`;
    const avatar_url = top_scores_chunk[0].user.avatar_url;

    const roleColor = message.member.roles.highest.color || '#ffffff';
    const embedColor = roleColor !== 0 ? roleColor : '#ffffff';

    let footerText = `Mostrando jugadas ${startIndex + 1}-${startIndex + top_scores_chunk.length} de ${total_plays} mejores`;
    if (loadingIndex !== null) {
        footerText = `⏳ Calculando pp de la play #${loadingIndex} de ${total_plays}...`;
    }

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Mejores puntuaciones de ${username} en osu!${parsed_args.gamemode || 'std'}`,
            url: user_url,
            iconURL: avatar_url
        })
        .setDescription(embed_description)
        .setColor(embedColor)
        .setFooter({
            text: footerText,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

async function run(messages, args) {
    const { message, res } = messages;

    // Parseamos args
    const parser_res = await argsParser(args, {
        "message": message,
        "res": res,
        "command_function": getUserTopScores
    });

    if (typeof parser_res.fn_response === 'string') return parser_res.fn_response;
    if (!Array.isArray(parser_res.fn_response) || parser_res.fn_response.length === 0) {
        return `Pero si no tienes puntuaciones registradas`;
    }

    const total_plays = parser_res.fn_response.length;

    let index = parser_res.parsed_args.index || 1;
    if (index > total_plays) index = total_plays;
    if (index < 1) index = 1;

    let startIndex = Math.floor((index - 1) / 5) * 5;

    const initialListEmbed = await doOsuListEmbed(message, parser_res.parsed_args, parser_res.fn_response.slice(startIndex, startIndex + 5), startIndex, total_plays);

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

    const getListButtonsRow = (start, total) => {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('rsl_first')
                .setLabel('<<')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start <= 0),
            new ButtonBuilder()
                .setCustomId('rsl_prev')
                .setLabel('<')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start <= 0),
            new ButtonBuilder()
                .setCustomId('rsl_next')
                .setLabel('>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start + 5 >= total),
            new ButtonBuilder()
                .setCustomId('rsl_last')
                .setLabel('>>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start + 5 >= total)
        );
    };

    const sent_message = await message.channel.send({
        embeds: [initialListEmbed],
        components: [getListButtonsRow(startIndex, total_plays)]
    });

    // Función para procesar secuencialmente el chunk en segundo plano y actualizar UX
    const processChunk = async (msg_obj, start) => {
        const chunk = parser_res.fn_response.slice(start, start + 5);
        
        for (let i = 0; i < chunk.length; i++) {
            const score = chunk[i];
            const globalIndex = start + i + 1;

            if (score.calculatedPP !== undefined) continue;

            // Actualizar footer para la play actual si seguimos en la misma página
            if (start === startIndex) {
                const tempEmbed = await doOsuListEmbed(message, parser_res.parsed_args, chunk, start, total_plays, globalIndex);
                try {
                    await msg_obj.edit({ embeds: [tempEmbed] });
                } catch (e) {}
            }

            const { perfect = 0, great = 0, good = 0, ok = 0, meh = 0, miss = 0 } = score.statistics;
            const total_hits = great + ok + meh + miss;
            let ppVal = score.pp;
            let starsVal = score.beatmap.difficulty_rating;
            let passPercent = 0;

            try {
                const beatmap = await getBeatmap(score.beatmap.id);
                const map = await getBeatmap_osu(score.beatmap.beatmapset_id, score.beatmap.id, beatmap);
                const maxAttrs = calculatePP(score, map, "maximo_pp");
                
                if (!ppVal) {
                    ppVal = calculatePP(score, map, null, maxAttrs).pp;
                }

                if (map.nObjects > 0) {
                    passPercent = (total_hits / map.nObjects * 100);
                }

                if (maxAttrs && maxAttrs.difficulty && maxAttrs.difficulty.stars !== undefined) {
                    starsVal = maxAttrs.difficulty.stars;
                }
                
                map.free();
            } catch (err) {
                console.error(`Error al procesar PP de #${globalIndex}:`, err);
            }

            score.calculatedPP = ppVal || 0;
            score.calculatedStars = starsVal;
            score.calculatedPassPercent = passPercent;
        }

        // Renderizado final
        if (start === startIndex) {
            const finalEmbed = await doOsuListEmbed(message, parser_res.parsed_args, chunk, start, total_plays, null);
            try {
                await msg_obj.edit({ embeds: [finalEmbed] });
            } catch (e) {}
        }
    };

    // Iniciamos el cálculo en background para la primera página
    processChunk(sent_message, startIndex);

    const filter = btnInt => btnInt.user.id === message.author.id;
    const collector = sent_message.createMessageComponentCollector({
        filter,
        idle: 30000
    });

    collector.on('collect', async i => {
        try {
            await i.deferUpdate();

            if (i.customId === 'rsl_first') {
                startIndex = 0;
            } else if (i.customId === 'rsl_prev') {
                startIndex = Math.max(0, startIndex - 5);
            } else if (i.customId === 'rsl_next') {
                startIndex = startIndex + 5;
            } else if (i.customId === 'rsl_last') {
                startIndex = Math.floor((total_plays - 1) / 5) * 5;
            }

            const chunk = parser_res.fn_response.slice(startIndex, startIndex + 5);
            const embed = await doOsuListEmbed(message, parser_res.parsed_args, chunk, startIndex, total_plays);

            await i.editReply({
                embeds: [embed],
                components: [getListButtonsRow(startIndex, total_plays)]
            });

            // Lanzar procesamiento en background para la nueva página seleccionada
            processChunk(sent_message, startIndex);
        } catch (err) {
            console.error("Error al navegar la lista de mejores scores:", err);
        }
    });

    collector.on('end', async () => {
        try {
            await sent_message.edit({ components: [] });
        } catch (e) {}
    });

    return;
}

run.alias = {
    "maniatop" : {
        "args" : "-mania"
    },
    "ctbtop" : {
        "args" : "-ctb"
    },
    "taikotop" : {
        "args" : "-taiko"
    },
    "osutop" : {
        "args" : ""
    },
}

run.description = {
    'header' : 'Obtén el top 100 de jugadas de PP',
    'body' : `Muestra una lista paginada de las mejores jugadas (top) de un jugador de osu!`,
    'usage' : `s.top : Muestra tus mejores jugadas.\ns.top 'usuario' : Muestra las mejores jugadas de ese usuario.\ns.top -i 15 : Empieza mostrando desde la jugada #15.`
}

module.exports = { run, "description": run.description }