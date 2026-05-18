const { EmbedBuilder } = require('discord.js');
const { getUnrankedBeatmapUserAllScores, argsParser, getBeatmapUserAllScores, findBeatmapInChannel, getBeatmap, getOsuUser } = require("../../utils/osu.js");

async function doEmbed(message, user_scores, gamemode) {
    const emoji_mods = require("../../../src/emoji_mods.json");
    const emoji_grades = require("../../../src/emoji_grades.json");

    let embed_description = '';

    for (let i = 0; i < user_scores.length; i++) {
        if (i >= 20) {
            embed_description = embed_description.concat(`\n*...y ${user_scores.length - i} puntuaciones más*`);
            break;
        }

        const score = user_scores[i];
        let rank_pos = `#${i}`;

        let grade_emoji = emoji_grades[!score.passed ? "F" : score.rank];
        grade_emoji = grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}:` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`;

        let map_completion = !score.passed ? `*Map completion: \`${(score.map_completion * 100).toFixed(2)}\`%*\n` : "";
        let legacy_score = (score.legacy_total_score || score.total_score || 0).toLocaleString('es-ES');
        let accuracy = (score.accuracy * 100).toFixed(2);
        let max_combo = score.max_combo;
        let statistics = score.statistics;

        const perfect = statistics.perfect || 0;
        const great = statistics.great || 0;
        const good = statistics.good || 0;
        const ok = statistics.ok || 0;
        const meh = statistics.meh || 0;
        const miss = statistics.miss || 0;

        let stats_str = "";
        let ratio_str = "";
        if (gamemode === 'mania') {
            stats_str = `\`[${perfect}/${great}/${good}/${ok}/${meh}/${miss}]\``;
            const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
            ratio_str = ` - ${ratio}:1`;
        } else if (gamemode === 'taiko') {
            stats_str = `\`[${great}/${ok}/${miss}]\``;
        } else {
            stats_str = `\`[${great}/${ok}/${meh}/${miss}]\``;
        }
        statistics = stats_str;
        accuracy = `${accuracy}%${ratio_str}`;

        let pp = `${score.pp ? score.pp.toFixed(2) : 0}`;
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

        const score_line = i != 0 ?
            `${rank_pos} - ${grade_emoji} - ${legacy_score} - ${accuracy} - x${max_combo} - ${statistics} - ${pp}pp - ${time_set} - ${mods_used}\n${map_completion}` :
            `**${rank_pos}** - ${grade_emoji} - **${legacy_score}** - **${accuracy}** - **x${max_combo}** - ${statistics} - **${pp}pp** - ${time_set} - ${mods_used} - ${map_completion != "" ? `**${map_completion}**` : ""}\n`;

        if ((embed_description + score_line).length > 3900) {
            embed_description = embed_description.concat(`\n*...y ${user_scores.length - i} puntuaciones más*`);
            break;
        }

        embed_description = embed_description.concat(score_line);
    }

    const embed = new EmbedBuilder()
        .setDescription(embed_description)
        .setFooter({
            text: "SengoBot",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

async function doContent(parsed_args, user_found, beatmap_metadata) {
    const { title } = beatmap_metadata.beatmapset;
    const { difficulty_rating, version, url } = beatmap_metadata;

    if (parsed_args.username[0] == '') parsed_args.username[0] = user_found.osu_id;
    const username = (await getOsuUser(parsed_args)).username;

    let mapa = `[${title} [${version}] - ${difficulty_rating + '★'} ](${url})`;
    const displayMode = parsed_args.gamemode === 'osu' ? 'std' : (parsed_args.gamemode === 'fruits' ? 'ctb' : parsed_args.gamemode);
    const content = `**Puntuaciones de \`${username}\` en \`osu!${displayMode}\`: \n${mapa}**`;

    return content;
}

async function run(messages, args) {
    const { message, res, reply } = messages;

    const { beatmap_url, bad_response } = reply ? await findBeatmapInChannel(reply, true) : await findBeatmapInChannel(message, false);
    if (!beatmap_url) return bad_response;

    // Para revisar si es graveyard o no
    const beatmap_metadata = await getBeatmap(beatmap_url);
    const unranked_statuses = new Set(['pending', 'graveyard', 'wip']);

    const { fn_response, parsed_args, user_found } = await argsParser(args,                  // Si es un mapa unranked lo mandamos a buscar los scores locales, sino los rankeados
        { "message": message, "res": res, "beatmap_url": beatmap_url, "gamemode": beatmap_metadata.mode, "command_function": unranked_statuses.has(beatmap_metadata.status) ? getUnrankedBeatmapUserAllScores : getBeatmapUserAllScores });

    if (typeof fn_response === 'string') return fn_response;
    if (fn_response.length == 0) return `El usuario no tiene scores en el mapa.`;

    if (beatmap_metadata.status === 'loved') {
        const { getBeatmap_osu, calculatePP } = require("../../utils/osu.js");
        const map = await getBeatmap_osu(beatmap_metadata.beatmapset_id, beatmap_metadata.id, beatmap_metadata);
        
        for (let score of fn_response) {
            if (!score.pp) {
                const ppResult = calculatePP(score, map);
                score.pp = ppResult.pp;
            }
        }
        map.free();
    }

    const gamemode = beatmap_metadata.mode || parsed_args.gamemode || 'osu';
    const embed = await doEmbed(message, fn_response, gamemode);
    const content = await doContent(parsed_args, user_found, beatmap_metadata);

    if (reply) {
        reply.reply({ content: content, embeds: [embed] });
        return;
    }

    return { content: content, embeds: [embed] };
}

run.alias = {
    "comparar": {
        "args": ""
    },
    "compara": {
        "args": ""
    },
    "compare": {
        "args": ""
    },
    "cm": {
        "args": "-mania"
    },
    "cc": {
        "args": "-ctb"
    },
    "ct": {
        "args": "-taiko"
    }
}

run.description =
{
    'header': "El >c de toda la vida",
    'body': 'Compara una score en el ultimo mapa que consigue el Sengo. La score puede ser del usuario del comando u otro jugador',
    'usage': `s.c : Compara la score del usuario linkeado al bot \ns.c 'usuario' : Compara la score del usuario en el argumento. \ns.c 'modo' : Compara por modo de juego \ns.c 'usuario' 'modo' : Se pueden combinar ambos.`
}

module.exports = { run, "description": run.description }