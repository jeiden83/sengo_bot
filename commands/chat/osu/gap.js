const { findBeatmapInChannel, getBeatmap, getNewBeatmapUserScores, getUnrankedUserScores, argsParserNoCommand } = require("../../utils/osu.js");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function doEmbed(message, user_scores, beatmap_metadata, startIndex = 0, total_plays = 0){
    let embed_description = '';

    const emoji_mods = require("../../../src/emoji_mods.json");
    const emoji_grades = require("../../../src/emoji_grades.json");

    let position = startIndex + 1;

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

        let total_score = score.legacy_total_score == 0 ? score.total_score.toLocaleString('es-ES') : score.legacy_total_score.toLocaleString('es-ES');
        let accuracy = (score.accuracy * 100).toFixed(2);
    
        let max_combo = score.max_combo;
        let beatmap_max_combo = beatmap_metadata.max_combo;

        let { perfect = 0, great = 0, good = 0, ok = 0, meh = 0, miss = 0 } = score.statistics;
        let statistics = "";
        let ratio_str = "";
        if (beatmap_metadata.mode === 'mania') {
            statistics = `\`[${perfect}/${great}/${good}/${ok}/${meh}/${miss}]\``;
            const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
            ratio_str = ` - ${ratio}:1`;
        } else if (beatmap_metadata.mode === 'taiko') {
            statistics = `\`[${great}/${ok}/${miss}]\``;
        } else {
            statistics = `\`[${great}/${ok}/${meh}/${miss}]\``;
        }
        accuracy = `${accuracy}%${ratio_str}`;
    
        let pp = `${score.pp ? score.pp.toFixed(2) : 0}`;
    
        let time_set = `<t:${Math.floor((new Date(score.ended_at)).getTime() / 1000)}:R>`;
    
        let grade_emoji = emoji_grades[!score.passed ? "F" : score.rank];
    	    grade_emoji = grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}: (${(score.map_completion*100).toFixed(2)}%)` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`;

        let mods_used = score.mods.reduce((acc, mod) => {
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
        }, '');

        const isFirstGlobal = position === 1;
        embed_description = embed_description.concat(isFirstGlobal ?
            `#**${position++}** - ${flag} **${username_link}** - ${time_set} - ${grade_emoji}
            **${total_score}** - **${accuracy}** - **x${max_combo}/${beatmap_max_combo}** - ${statistics} - **${pp}PP** - ${mods_used}\n\n`
            :
            `#${position++} - ${flag} ${username_link} - ${time_set} - ${grade_emoji}
            ${total_score} - ${accuracy} - x${max_combo}/${beatmap_max_combo} - ${statistics} - ${pp}PP - ${mods_used}\n\n`
        );
    
    });
    
    const embed = new EmbedBuilder()
        .setDescription(embed_description)
        .setFooter({
            text: `SengoBot • Mostrando posiciones ${startIndex + 1}-${startIndex + user_scores.length} de ${total_plays}`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

async function doContent(beatmap_metadata, user_scores, sorted_user_scores, page = 1, max_pages = 1){
    const { title } = beatmap_metadata.beatmapset;
    const { difficulty_rating, version, url} = beatmap_metadata;

    let mapa = `[${title} [${version}] - ${difficulty_rating + '★'} ](${url})`;
    let content = `**De \`${user_scores.length}\` usuarios, \`${sorted_user_scores.length}\` tienen una score en: \n${mapa}**`;

    if(sorted_user_scores.length > 5) content = content.concat(`\n**Página \`${page}/${max_pages}\`**`);

    return content;
}

async function getLinkedMembers(message, res, beatmapMode = 'osu') {
    try {
        const guildId = message.guild.id;

        // Paso 1: Consultar Supabase buscando usuarios vinculados que pertenezcan a este servidor
        const { data: linkedUsers, error } = await res.supabaseClient
            .from('users')
            .select('discord_id, osu_id, main_gamemode')
            .not('osu_id', 'is', null)
            .contains('guilds', [guildId]);

        if (error) {
            console.error('Error al consultar usuarios vinculados en Supabase:', error);
            return [];
        }

        if (!linkedUsers || linkedUsers.length === 0) {
            return [];
        }

        // Paso 2: Filtrar los usuarios que coincidan con el gamemode del mapa (estándar por defecto)
        const targetMode = beatmapMode || 'osu';
        const filteredUsers = linkedUsers.filter(user => {
            const userMode = user.main_gamemode || 'osu';
            return userMode === targetMode;
        });

        // Crear un array para almacenar las IDs y osu_id correspondientes
        return filteredUsers.map(user => {
            return {
                id: user.discord_id,
                osu_id: user.osu_id,
                main_gamemode: user.main_gamemode
            };
        });
    } catch (error) {
        console.error('Error obteniendo usuarios linkeados:', error);
        return [];
    }
}

async function run(messages, args){
    const { message, res, reply, logger } = messages;

    const {beatmap_url, bad_response} = reply ? await findBeatmapInChannel(reply, true) : await findBeatmapInChannel(message, false);
    if(!beatmap_url) return bad_response;

    // Para revisar el modo de juego y estado del beatmap
    const beatmap_metadata = await getBeatmap(beatmap_url);

    const parsed_args = argsParserNoCommand(args);
    const forcedMode = parsed_args.gamemode || null;

    if (forcedMode && beatmap_metadata.mode === 'osu') {
        beatmap_metadata.mode = forcedMode;
    }

    const usersArray = await getLinkedMembers(message, res, beatmap_metadata.mode);

    if (usersArray.length === 0) {
        const modeName = beatmap_metadata.mode === 'osu' ? 'standard' : beatmap_metadata.mode;
        return { content: `**No hay usuarios vinculados** en este servidor que jueguen principalmente el modo \`${modeName}\`.` };
    }

    const forceUpdate = args && args.some(arg => typeof arg === 'string' && arg.toLowerCase().trim() === '-force');

    const user_scores = (beatmap_metadata.status == "pending" || beatmap_metadata.status == "graveyard") ? 
        await getUnrankedUserScores(beatmap_url, beatmap_metadata.mode) : 
        await getNewBeatmapUserScores(beatmap_url, usersArray, beatmap_metadata.mode, forceUpdate, logger);

    if(user_scores.size === 0) return {content: `**De los \`${usersArray.length}\` usuarios en el servidor (modo ${beatmap_metadata.mode})** pues ninguno tiene una score en el mapa.`};

    if (beatmap_metadata.status === 'loved') {
        const { getBeatmap_osu, calculatePP } = require("../../utils/osu.js");
        const map = await getBeatmap_osu(beatmap_metadata.beatmapset_id, beatmap_metadata.id, beatmap_metadata);
        for (let [userId, score] of user_scores) {
            if (!score.pp) {
                const ppResult = calculatePP(score, map);
                score.pp = ppResult.pp;
            }
        }
        map.free();
    }

    // Si el mapa es loved, sera por puntuacion, sino por pp de manera descendente
    const sorted_user_scores = beatmap_metadata.status === "loved"
        ? user_scores.sort((a, b) => b.total_score - a.total_score)
        : user_scores.sort((a, b) => (b.pp ?? 0) - (a.pp ?? 0));

    const scoresArray = Array.from(sorted_user_scores.values());
    const total_plays = scoresArray.length;

    // Obtener la página desde los argumentos del comando
    const max_pages = Math.ceil(total_plays / 5);
    const requestedPage = parsed_args.page || 1;
    if (parsed_args.page && (requestedPage > max_pages || requestedPage < 1)) {
        const warningMsg = `⚠️ La página **${requestedPage}** no existe. Este mapa solo tiene **${max_pages}** ${max_pages === 1 ? 'página' : 'páginas'} de puntuaciones.`;
        if (reply) {
            reply.reply({ content: warningMsg });
            return;
        }
        return { content: warningMsg };
    }

    let page = requestedPage;
    let startIndex = (page - 1) * 5;

    const content = await doContent(beatmap_metadata, usersArray, scoresArray, page, max_pages);
    const initialEmbed = await doEmbed(message, scoresArray.slice(startIndex, startIndex + 5), beatmap_metadata, startIndex, total_plays);

    const getGapButtonsRow = (start, total) => {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('gap_first')
                .setLabel('<<')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start <= 0),
            new ButtonBuilder()
                .setCustomId('gap_prev')
                .setLabel('<')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start <= 0),
            new ButtonBuilder()
                .setCustomId('gap_next')
                .setLabel('>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start + 5 >= total),
            new ButtonBuilder()
                .setCustomId('gap_last')
                .setLabel('>>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start + 5 >= total)
        );
    };

    let sent_message;
    if (reply) {
        sent_message = await reply.reply({
            content: content,
            embeds: [initialEmbed],
            components: total_plays > 5 ? [getGapButtonsRow(startIndex, total_plays)] : []
        });
    } else {
        sent_message = await message.channel.send({
            content: content,
            embeds: [initialEmbed],
            components: total_plays > 5 ? [getGapButtonsRow(startIndex, total_plays)] : []
        });
    }

    if (total_plays <= 5) return;

    const filter = btnInt => btnInt.user.id === message.author.id;
    const collector = sent_message.createMessageComponentCollector({
        filter,
        idle: 30000
    });

    collector.on('collect', async i => {
        try {
            await i.deferUpdate();

            if (i.customId === 'gap_first') {
                startIndex = 0;
            } else if (i.customId === 'gap_prev') {
                startIndex = Math.max(0, startIndex - 5);
            } else if (i.customId === 'gap_next') {
                startIndex = startIndex + 5;
            } else if (i.customId === 'gap_last') {
                startIndex = Math.floor((total_plays - 1) / 5) * 5;
            }

            const currentPage = Math.floor(startIndex / 5) + 1;
            const updatedContent = await doContent(beatmap_metadata, usersArray, scoresArray, currentPage, max_pages);
            const chunk = scoresArray.slice(startIndex, startIndex + 5);
            const embed = await doEmbed(message, chunk, beatmap_metadata, startIndex, total_plays);

            await i.editReply({
                content: updatedContent,
                embeds: [embed],
                components: [getGapButtonsRow(startIndex, total_plays)]
            });
        } catch (err) {
            console.error("Error al navegar la lista de gap:", err);
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
    "g" : {
        "args" : ""
    }
}

run.description = 
{
    'header' : '>c Global entre el server',
    'body' : 'Hace un >c con respecto a los usuarios linkeados en el servidor, mostrando la lista paginada y ordenada por score o pp.',
    'usage' : `s.gap : Muestra la lista de scores del server en el último mapa.\ns.gap -p 2 : Muestra la página 2 de la lista de scores.\ns.gap -force : Fuerza a actualizar las puntuaciones desde la API de osu! sin usar la caché.\ns.gap $reply : Hace el s.gap del mapa al que se le hace el reply.`
}

module.exports = { run, "description": run.description}