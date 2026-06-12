const { findBeatmapInChannel, getBeatmap, getNewBeatmapUserScores, getUnrankedUserScores, argsParserNoCommand, saveUserscore, normalizeScore, getBeatmap_osu, calculatePP } = require("../../utils/osu.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const { getSupabaseClient } = require("../../../db/database.js");
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
                username: user.username,
                main_gamemode: user.main_gamemode
            };
        });
    } catch (error) {
        console.error('Error obteniendo usuarios linkeados:', error);
        return [];
    }
}

function mapDbScoreToApiScore(row) {
    if (!row) return null;
    return {
        id: Number(row.id),
        accuracy: row.accuracy,
        ended_at: row.ended_at,
        started_at: row.started_at,
        legacy_total_score: Number(row.legacy_total_score || 0),
        total_score: Number(row.total_score || 0),
        max_combo: row.max_combo,
        statistics: row.statistics || {},
        mods: row.mods || [],
        passed: row.passed,
        pp: row.pp,
        rank: row.rank,
        map_completion: row.map_completion,
        beatmap: {
            id: Number(row.beatmap_id),
            status: row.beatmap_status
        },
        user: {
            id: Number(row.user_id),
            username: row.username,
            country_code: row.country_code
        },
        user_id: Number(row.user_id)
    };
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

    let user_scores;
    if (beatmap_metadata.status == "pending" || beatmap_metadata.status == "graveyard") {
        user_scores = await getUnrankedUserScores(beatmap_url, beatmap_metadata.mode);
    } else {
        let supporterToken = null;
        let supporterUsername = null;
        if (process.env.OWNER_ID) {
            const tokenRecord = await OsuUserModel.getOAuthTokenRecord(process.env.OWNER_ID);
            if (tokenRecord) {
                const validToken = await OsuUserModel.getValidTokenForUser(process.env.OWNER_ID);
                if (validToken) {
                    supporterToken = validToken;
                    supporterUsername = tokenRecord.username;
                }
            }
        }
        if (!supporterToken) {
            // Fallback: usar el token de la persona que ejecutó el comando si tiene supporter
            const userToken = await OsuUserModel.getOAuthTokenRecord(message.author.id);
            if (userToken && userToken.is_supporter) {
                const validToken = await OsuUserModel.getValidTokenForUser(message.author.id);
                if (validToken) {
                    supporterToken = validToken;
                    supporterUsername = userToken.username;
                }
            }
        }
        if (!supporterToken) {
            // Fallback 2: usar cualquier supporter de la pool
            const supporterRes = await OsuUserModel.getSupporterTokenForCountry("ANY");
            if (supporterRes) {
                supporterToken = supporterRes.token;
                supporterUsername = supporterRes.username;
            }
        }

        if (supporterToken && !forceUpdate) {
            if (logger) logger.process(`[GAP] Optimizando consulta usando el token de supporter de ${supporterUsername}`);

            let apiFriendScores = [];
            try {
                let legacyOnlyVal = 1;
                if (parsed_args.isLazerMode === true) {
                    legacyOnlyVal = 0;
                }
                const fetch = require('node-fetch');
                const url = `https://osu.ppy.sh/api/v2/beatmaps/${beatmap_metadata.id}/scores?mode=${beatmap_metadata.mode || 'osu'}&type=friend&legacy_only=${legacyOnlyVal}`;
                const response = await fetch(url, {
                    headers: {
                        'Authorization': `Bearer ${supporterToken}`,
                        'Content-Type': 'application/json',
                        'x-api-version': '20240728'
                    }
                });
                if (response.ok) {
                    const resJson = await response.json();
                    apiFriendScores = resJson.scores || resJson || [];
                }
            } catch (e) {
                console.error("[GAP] Error al obtener amigos de la API:", e);
            }

            const supabase = getSupabaseClient();
            let dbScores = [];
            if (supabase && usersArray.length > 0) {
                try {
                    const osuIds = usersArray.map(u => u.osu_id.toString());
                    const { data, error } = await supabase
                        .from('local_scores')
                        .select('*')
                        .eq('beatmap_id', beatmap_metadata.id.toString())
                        .in('user_id', osuIds);
                    if (!error && data) {
                        dbScores = data;
                    }
                } catch (dbErr) {
                    console.error("[GAP] Error al consultar Supabase local_scores:", dbErr);
                }
            }

            const missingUsersToFetch = [];
            const now = Date.now();
            const CACHE_TTL_SCORE = 24 * 60 * 60 * 1000; // 24 horas

            for (const user of usersArray) {
                const hasApiScore = apiFriendScores.some(s => s.user_id?.toString() === user.osu_id.toString() || (s.user && s.user.id?.toString() === user.osu_id.toString()));
                if (hasApiScore) continue;

                const dbScore = dbScores.find(s => s.user_id?.toString() === user.osu_id.toString());
                const isDbFresh = dbScore && (now - new Date(dbScore.created_at || dbScore.ended_at).getTime() < CACHE_TTL_SCORE);

                if (!isDbFresh) {
                    missingUsersToFetch.push(user);
                }
            }

            if (missingUsersToFetch.length > 0) {
                if (logger) logger.process(`[GAP] Consultando de forma individual a ${missingUsersToFetch.length} usuarios faltantes/expirados`);
                const fetch = require('node-fetch');
                const usersToQuery = missingUsersToFetch.slice(0, 10);
                await Promise.all(usersToQuery.map(async (user) => {
                    try {
                        const url = `https://osu.ppy.sh/api/v2/beatmaps/${beatmap_metadata.id}/scores/users/${user.osu_id}?mode=${beatmap_metadata.mode || 'osu'}`;
                        const response = await fetch(url, {
                            headers: {
                                'Authorization': `Bearer ${supporterToken}`,
                                'Content-Type': 'application/json',
                                'x-api-version': '20240728'
                            }
                        });
                        if (response.ok) {
                            const scoreData = await response.json();
                            if (scoreData && scoreData.score) {
                                apiFriendScores.push(scoreData.score);
                            }
                        }
                    } catch (e) {
                        console.error(`[GAP] Error al consultar score individual de ${user.osu_id}:`, e);
                    }
                }));
            }

            let mapInstance = null;
            try {
                mapInstance = await getBeatmap_osu(beatmap_metadata.beatmapset_id, beatmap_metadata.id, beatmap_metadata);
            } catch (err) {
                console.error("[GAP] Error al cargar mapInstance para cálculo de PP:", err);
            }

            const { Collection } = require("discord.js");
            user_scores = new Collection();

            for (const user of usersArray) {
                const uId = user.osu_id.toString();
                const apiScore = apiFriendScores.find(s => s.user_id?.toString() === uId || (s.user && s.user.id?.toString() === uId));
                const dbScoreRow = dbScores.find(s => s.user_id?.toString() === uId);

                let selectedScore = null;
                let shouldSaveApiScore = false;

                if (apiScore && dbScoreRow) {
                    const mappedDbScore = mapDbScoreToApiScore(dbScoreRow);
                    
                    let apiIsBetter = false;
                    if (beatmap_metadata.status === 'loved') {
                        const scoreA = Number(apiScore.legacy_total_score || apiScore.total_score || apiScore.score || 0);
                        const scoreB = Number(mappedDbScore.legacy_total_score || mappedDbScore.total_score || mappedDbScore.score || 0);
                        apiIsBetter = scoreA > scoreB;
                    } else {
                        if (!apiScore.pp && mapInstance) {
                            try {
                                const ppResult = calculatePP(apiScore, mapInstance);
                                apiScore.pp = ppResult.pp;
                            } catch {}
                        }
                        const ppA = Number(apiScore.pp || 0);
                        const ppB = Number(mappedDbScore.pp || 0);
                        apiIsBetter = ppA > ppB;
                    }

                    if (apiIsBetter) {
                        selectedScore = apiScore;
                        shouldSaveApiScore = true;
                    } else {
                        selectedScore = mappedDbScore;
                    }
                } else if (apiScore) {
                    selectedScore = apiScore;
                    shouldSaveApiScore = true;
                } else if (dbScoreRow) {
                    selectedScore = mapDbScoreToApiScore(dbScoreRow);
                }

                if (selectedScore) {
                    normalizeScore(selectedScore);
                    user_scores.set(uId, selectedScore);

                    if (shouldSaveApiScore && selectedScore) {
                        const beatmap_max_combo = mapInstance ? (mapInstance.maxCombo || 0) : 0;
                        const { great = 0, ok = 0, meh = 0, miss = 0 } = selectedScore.statistics || {};
                        const total_hits = great + ok + meh + miss;
                        const map_completion = selectedScore.passed ? 100 : (mapInstance && mapInstance.nObjects > 0 ? total_hits / mapInstance.nObjects : 0);

                        const pre_calculated = {
                            pp: selectedScore.pp,
                            beatmap_max_combo,
                            map_completion
                        };

                        const scoreToSave = {
                            ...selectedScore,
                            beatmap: {
                                id: beatmap_metadata.id,
                                status: beatmap_metadata.status
                            },
                            user: {
                                id: selectedScore.user?.id || selectedScore.user_id,
                                username: selectedScore.user?.username || user.username || `User ${uId}`,
                                country_code: selectedScore.user?.country_code || null
                            },
                            user_id: selectedScore.user?.id || selectedScore.user_id
                        };

                        saveUserscore(scoreToSave, pre_calculated, true).catch(err => {
                            console.error(`[GAP] Error al guardar score de user ${uId} en Supabase:`, err);
                        });
                    }
                }
            }

            if (mapInstance) {
                try {
                    mapInstance.free();
                } catch {}
            }
        } else {
            user_scores = await getNewBeatmapUserScores(beatmap_url, usersArray, beatmap_metadata.mode, forceUpdate, logger, beatmap_metadata);
        }
    }

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
    'header' : t('es', 'commands.gap.header'),
    'body' : t('es', 'commands.gap.body'),
    'usage' : t('es', 'commands.gap.usage')
}

module.exports = { run, "description": run.description}