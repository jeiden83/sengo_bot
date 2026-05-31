const { findBeatmapInChannel, getBeatmap, getNewBeatmapUserScores, getUnrankedUserScores, argsParserNoCommand } = require("../../utils/osu.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const { doOsuGapEmbed, doOsuGapContent } = require("../../../views/osuLeaderboardViews.js");
const { buildPaginationRow } = require("../../../views/osuViewHelpers.js");
const { t } = require("../../../utils/i18n.js");

async function getLinkedMembers(message, res, beatmapMode = 'osu', bypass = false, targetGuildId = null, extraDiscordIds = [], extraOsuIds = []) {
    try {
        const guildId = targetGuildId || (!bypass && message.guild ? message.guild.id : null);
        
        let guild = null;
        if (!bypass) {
            if (targetGuildId) {
                guild = await message.client.guilds.fetch(targetGuildId).catch(() => null);
            } else {
                guild = message.guild;
            }
        }
        
        const linkedUsers = await OsuUserModel.getLinkedUsers({ guildId, guild, bypass });

        if (!linkedUsers || linkedUsers.length === 0) {
            return [];
        }

        // Paso 2: Filtrar los usuarios que coincidan con el gamemode del mapa (estándar por defecto)
        const targetMode = beatmapMode || 'osu';
        const specialDiscordIds = new Set(extraDiscordIds);
        const specialOsuIds = new Set(extraOsuIds);

        const filteredUsers = linkedUsers.filter(user => {
            // Si es un modo alternativo (taiko, fruits, mania) y el servidor tiene pocos usuarios vinculados (<= 30),
            // consultamos a todos los vinculados para ver si tienen alguna play allí, dando soporte a multimodos.
            if (targetMode !== 'osu' && linkedUsers.length <= 30) {
                return true;
            }

            // Si es el autor del comando o del mensaje al que se responde (o el jugador del embed de reply),
            // lo incluimos siempre para garantizar que pueda ver su score sin importar su main_gamemode.
            if (specialDiscordIds.has(user.discord_id) || specialOsuIds.has(String(user.osu_id))) {
                return true;
            }

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
    const locale = message.locale || 'es';

    const parsed_args = argsParserNoCommand(args);
    const {beatmap_url, bad_response} = reply ? await findBeatmapInChannel(reply, true, parsed_args.index) : await findBeatmapInChannel(message, false, parsed_args.index);
    if(!beatmap_url) return bad_response;

    // Para revisar el modo de juego y estado del beatmap
    const beatmap_metadata = await getBeatmap(beatmap_url);

    const forcedMode = parsed_args.gamemode || null;

    if (forcedMode && beatmap_metadata.mode === 'osu') {
        beatmap_metadata.mode = forcedMode;
    }

    const targetGuildId = parsed_args.targetGuildId;
    if (targetGuildId) {
        const ownerId = process.env.OWNER_ID;
        if (message.author.id !== ownerId) {
            return t(locale, 'gap.err_creator_only_server');
        }
    }

    const hasBypassFlag = args && args.some(arg => typeof arg === 'string' && arg.toLowerCase().trim() === '-bypass');
    if (hasBypassFlag) {
        const ownerId = process.env.OWNER_ID;
        if (message.author.id !== ownerId) {
            return t(locale, 'gap.err_creator_only_bypass');
        }
    }

    const isSengoGuild = message.guild && message.guild.id === process.env.SENGOBOT_GUILD_ID;
    const bypass = hasBypassFlag || isSengoGuild;

    if (!message.guild && !bypass && !targetGuildId) {
        return { content: t(locale, 'gap.err_server_only') };
    }

    const extraDiscordIds = [];
    const extraOsuIds = [];

    if (message.author?.id) {
        extraDiscordIds.push(message.author.id);
    }
    if (reply) {
        if (reply.author?.id) {
            extraDiscordIds.push(reply.author.id);
        }
        // Intentar extraer osu_id de los embeds de reply (si es un embed de puntuación de Sengo o de otro bot con avatar)
        const iconUrl = reply.embeds?.[0]?.author?.iconURL || reply.embeds?.[0]?.author?.icon_url;
        const osuIdMatch = iconUrl?.match(/a\.ppy\.sh\/(\d+)/);
        if (osuIdMatch && osuIdMatch[1]) {
            extraOsuIds.push(osuIdMatch[1]);
        }
    }

    const usersArray = await getLinkedMembers(message, res, beatmap_metadata.mode, bypass, targetGuildId, extraDiscordIds, extraOsuIds);

    if (usersArray.length === 0) {
        const modeName = beatmap_metadata.mode === 'osu' ? 'standard' : beatmap_metadata.mode;
        const contextKey = targetGuildId ? 'gap.context_server_id' : (bypass ? 'gap.context_globally' : 'gap.context_server');
        const context = t(locale, contextKey, { targetGuildId });
        return { content: t(locale, 'gap.no_users', { context, mode: modeName }) };
    }

    const forceUpdate = args && args.some(arg => typeof arg === 'string' && arg.toLowerCase().trim() === '-force');
    const filterPass = parsed_args.filterPass;

    let user_scores = (beatmap_metadata.status == "pending" || beatmap_metadata.status == "graveyard") ? 
        await getUnrankedUserScores(beatmap_url, beatmap_metadata.mode) : 
        await getNewBeatmapUserScores(beatmap_url, usersArray, beatmap_metadata.mode, forceUpdate, logger, beatmap_metadata);

    if (filterPass) {
        user_scores = user_scores.filter(score => score.passed);
    }

    if (user_scores.size === 0 || (user_scores.length !== undefined && user_scores.length === 0)) {
        const contextKey = targetGuildId ? 'gap.context_server_id' : (bypass ? 'gap.context_globally' : 'gap.context_server_short');
        const context = t(locale, contextKey, { targetGuildId });
        const filterPassSuffix = filterPass ? t(locale, 'gap.filter_pass_suffix') : '';
        return { content: t(locale, 'gap.no_scores', { count: usersArray.length, context, mode: beatmap_metadata.mode, filterPass: filterPassSuffix }) };
    }

    if (beatmap_metadata.status === 'loved' || beatmap_metadata.status === 'qualified') {
        const hasMissingPP = Array.from(user_scores.values()).some(score => !score.pp);
        if (hasMissingPP) {
            const { getBeatmap_osu, calculatePP } = require("../../utils/osu.js");
            try {
                const map = await getBeatmap_osu(beatmap_metadata.beatmapset_id, beatmap_metadata.id, beatmap_metadata);
                for (let [userId, score] of user_scores) {
                    if (!score.pp) {
                        try {
                            const ppResult = calculatePP(score, map);
                            score.pp = ppResult.pp;
                        } catch (err) {
                            console.error(`[GAP] Error al calcular el PP de respaldo para el usuario ${userId}:`, err);
                        }
                    }
                }
                map.free();
            } catch (err) {
                console.error("[GAP] Error al cargar el beatmap de respaldo para el cálculo de PP:", err);
            }
        }
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
        const pagesText = max_pages === 1 ? t(locale, 'gap.pages_singular') : t(locale, 'gap.pages_plural');
        const warningMsg = t(locale, 'gap.err_page_not_found', { requestedPage, max_pages, pagesText });
        if (reply) {
            reply.reply({ content: warningMsg });
            return;
        }
        return { content: warningMsg };
    }

    let page = requestedPage;
    let startIndex = (page - 1) * 5;

    const content = await doOsuGapContent(beatmap_metadata, usersArray, scoresArray, page, max_pages, locale);
    const initialEmbed = await doOsuGapEmbed(message, scoresArray.slice(startIndex, startIndex + 5), beatmap_metadata, startIndex, total_plays, locale);

    const getGapButtonsRow = (start, total) => {
        return buildPaginationRow({ prefix: 'gap', current: start, total, pageSize: 5 });
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
            const updatedContent = await doOsuGapContent(beatmap_metadata, usersArray, scoresArray, currentPage, max_pages, locale);
            const chunk = scoresArray.slice(startIndex, startIndex + 5);
            const embed = await doOsuGapEmbed(message, chunk, beatmap_metadata, startIndex, total_plays, locale);

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
        } catch {}
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
    'usage' : `s.gap : Muestra la lista de scores del server en el último mapa.\ns.gap -p 2 : Muestra la página 2 de la lista de scores.\ns.gap -force : Fuerza a actualizar las puntuaciones desde la API de osu! sin usar la caché.\ns.gap -bypass : Bypassea la restricción del servidor y muestra las puntuaciones de todos los usuarios vinculados al bot (solo OWNER).\ns.gap -server <guild_id> : Muestra las puntuaciones de los usuarios del servidor especificado (solo OWNER).\ns.gap $reply : Hace el s.gap del mapa al que se le hace el reply.`
}

module.exports = { run, "description": run.description}