const { getOsuUser, argsParser, argsParserNoCommand } = require("../../utils/osu.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const OsuMatchmakingModel = require("../../../models/OsuMatchmakingModel.js");
const { doOsuRankedProfileEmbed, doOsuRankedLeaderboardEmbed } = require("../../../views/osuRankingViews.js");
const { buildPaginationRow } = require("../../../views/osuViewHelpers.js");
const { t } = require("../../../utils/i18n.js");

const serverLeaderboardCache = new Map();
const SERVER_CACHE_TTL = 300000; // 5 minutos en milisegundos

async function run(messages, args) {
    const { message, res, logger } = messages;
    const locale = message.locale || 'es';

    const hasTop = args.some(arg => typeof arg === 'string' && ['-top', '-t'].includes(arg.toLowerCase().trim()));
    const hasServer = args.some(arg => typeof arg === 'string' && ['-server', '-srv'].includes(arg.toLowerCase().trim()));
    
    let sortType = 'rating';
    const hasPlaysSort = args.some((arg, index) => {
        if (typeof arg !== 'string') return false;
        const clean = arg.toLowerCase().trim();
        if (['-plays', '-play', '-pl'].includes(clean)) return true;
        if (clean === '-p') {
            if (index + 1 < args.length) {
                const nextNum = parseInt(args[index + 1]);
                if (!isNaN(nextNum)) return false;
            }
            return true;
        }
        return false;
    });

    if (args.some(arg => typeof arg === 'string' && ['-wins', '-w'].includes(arg.toLowerCase().trim()))) {
        sortType = 'wins';
    } else if (args.some(arg => typeof arg === 'string' && ['-wr', '-winrate'].includes(arg.toLowerCase().trim()))) {
        sortType = 'winrate';
    } else if (hasPlaysSort) {
        sortType = 'plays';
    }

    // 1. MODO TABLA DE CLASIFICACIÓN GLOBAL (s.ranked -top)
    if (hasTop && !hasServer) {
        const parsed_args = argsParserNoCommand(args);
        let currentPage = parsed_args.page || 1;

        if (logger) logger.process("Obteniendo ranking global de Ranked Play...");
        let loadingMsg;
        try {
            loadingMsg = await message.channel.send(t(locale, 'ranked.msg_loading_global'));
        } catch (e) {
            console.error("Error al enviar mensaje temporal en ranked -top:", e);
        }

        try {
            let currentOsuPage = Math.ceil(currentPage / 5);
            let { players, maxPages: maxOsuPages } = await OsuMatchmakingModel.fetchRankedPlayLeaderboard(currentOsuPage);
            const totalPlayers = maxOsuPages * 50;

            if (players.length === 0) {
                if (loadingMsg) await loadingMsg.edit(t(locale, 'ranked.err_no_players_global'));
                return;
            }

            const sortAndSlice = (pageVal, playersList) => {
                let list = [...playersList];
                if (sortType === 'wins') {
                    list.sort((a, b) => {
                        if (b.wins !== a.wins) return b.wins - a.wins;
                        return b.rating - a.rating;
                    });
                } else if (sortType === 'winrate') {
                    list.sort((a, b) => {
                        const wrA = a.plays > 0 ? (a.wins / a.plays) : 0;
                        const wrB = b.plays > 0 ? (b.wins / b.plays) : 0;
                        if (wrB !== wrA) return wrB - wrA;
                        return b.rating - a.rating;
                    });
                } else if (sortType === 'plays') {
                    list.sort((a, b) => {
                        if (b.plays !== a.plays) return b.plays - a.plays;
                        return b.rating - a.rating;
                    });
                }
                const startIdx = ((pageVal - 1) % 5) * 10;
                return list.slice(startIdx, startIdx + 10);
            };

            const initialChunk = sortAndSlice(currentPage, players);
            const embed = doOsuRankedLeaderboardEmbed({
                chunk: initialChunk,
                total: totalPlayers,
                startIndex: (currentPage - 1) * 10,
                isServer: false,
                sortType,
                message,
                locale
            });

            const getButtons = (pageVal) => {
                return buildPaginationRow({
                    prefix: 'ranked_top',
                    current: (pageVal - 1) * 10,
                    total: totalPlayers,
                    pageSize: 10
                });
            };

            let sent_message;
            if (loadingMsg) {
                sent_message = await loadingMsg.edit({
                    content: null,
                    embeds: [embed],
                    components: totalPlayers > 10 ? [getButtons(currentPage)] : []
                });
            } else {
                sent_message = await message.channel.send({
                    embeds: [embed],
                    components: totalPlayers > 10 ? [getButtons(currentPage)] : []
                });
            }

            if (totalPlayers <= 10) return;

            const filter = btnInt => btnInt.user.id === message.author.id;
            const collector = sent_message.createMessageComponentCollector({
                filter,
                idle: 60000
            });

            collector.on('collect', async i => {
                try {
                    await i.deferUpdate();

                    const maxDiscordPages = maxOsuPages * 5;
                    if (i.customId === 'ranked_top_first') {
                        currentPage = 1;
                    } else if (i.customId === 'ranked_top_prev') {
                        currentPage = Math.max(1, currentPage - 1);
                    } else if (i.customId === 'ranked_top_next') {
                        currentPage = Math.min(maxDiscordPages, currentPage + 1);
                    } else if (i.customId === 'ranked_top_last') {
                        currentPage = maxDiscordPages;
                    }

                    const targetOsuPage = Math.ceil(currentPage / 5);
                    if (targetOsuPage !== currentOsuPage) {
                        const fetched = await OsuMatchmakingModel.fetchRankedPlayLeaderboard(targetOsuPage);
                        players = fetched.players;
                        maxOsuPages = fetched.maxPages;
                        currentOsuPage = targetOsuPage;
                    }

                    const chunk = sortAndSlice(currentPage, players);
                    const updatedEmbed = doOsuRankedLeaderboardEmbed({
                        chunk,
                        total: maxOsuPages * 50,
                        startIndex: (currentPage - 1) * 10,
                        isServer: false,
                        sortType,
                        message,
                        locale
                    });

                    await i.editReply({
                        embeds: [updatedEmbed],
                        components: [getButtons(currentPage)]
                    });
                } catch (err) {
                    console.error("Error al navegar ranking global de ranked play:", err);
                }
            });

            collector.on('end', async () => {
                try {
                    await sent_message.edit({ components: [] });
                } catch {}
            });

        } catch (err) {
            console.error("Error en ranked -top:", err);
            if (loadingMsg) await loadingMsg.edit(t(locale, 'ranked.err_global_api'));
        }
        return;
    }

    // 2. MODO TABLA DE CLASIFICACIÓN DEL SERVIDOR (s.ranked -server)
    if (hasServer) {
        const parsed_args = argsParserNoCommand(args);
        let targetGuildId = parsed_args.targetGuildId;

        let guildFilterId = null;
        let isAllServers = false;

        if (targetGuildId) {
            if (targetGuildId.toUpperCase() === "ALL") {
                isAllServers = true;
            } else {
                guildFilterId = targetGuildId;
            }
        } else {
            if (message.guild) {
                guildFilterId = message.guild.id;
            } else {
                return t(locale, 'ranked.err_not_in_guild');
            }
        }

        let playersData = [];

        if (logger) logger.process(isAllServers ? "Obteniendo usuarios vinculados de todos los servidores desde la base de datos..." : "Obteniendo usuarios vinculados del servidor desde la base de datos...");
        
        let guild = null;
        if (!isAllServers && guildFilterId) {
            guild = await message.client.guilds.fetch(guildFilterId).catch(() => null);
        }

        const linkedUsers = await OsuUserModel.getLinkedUsers({ guildId: guildFilterId, guild, bypass: isAllServers });

        if (!linkedUsers || linkedUsers.length === 0) {
            return isAllServers ? t(locale, 'ranked.err_no_linked_bot') : t(locale, 'ranked.err_no_linked_guild');
        }

        const linkedOsuIds = linkedUsers.map(u => u.osu_id.toString());

        try {
            const dbPlayers = await OsuMatchmakingModel.fetchServerRankedLeaderboard(linkedOsuIds);
            playersData = dbPlayers
                .filter(p => p.plays > 0)
                .map(p => ({
                    username: p.username,
                    userId: p.osu_id,
                    countryCode: p.country_code,
                    rating: p.rating,
                    wins: p.wins,
                    plays: p.plays,
                    isProvisional: p.is_provisional
                }));

            // Identificar usuarios vinculados que faltan en la base de datos
            const foundOsuIds = new Set(dbPlayers.map(p => p.osu_id));
            const missingUsers = linkedUsers.filter(u => !foundOsuIds.has(u.osu_id.toString()));

            if (missingUsers.length > 0) {
                // Actualizar en segundo plano de manera asíncrona
                (async () => {
                    console.log(`[BACKGROUND-RANKED] Detectados ${missingUsers.length} usuarios vinculados sin datos en la DB. Iniciando actualización...`);
                    for (const u of missingUsers) {
                        try {
                            // Delay de 1 segundo para ser gentiles con la API de osu!
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            const osuUser = await OsuUserModel.getOsuUser({ 
                                username: [u.osu_id.toString()], 
                                gamemode: u.main_gamemode || 'osu' 
                            });
                            if (osuUser) {
                                await OsuMatchmakingModel.updateUserRankedStats(osuUser);
                            }
                        } catch (err) {
                            console.error(`[BACKGROUND-RANKED] Error al actualizar usuario faltante ${u.osu_id}:`, err.message);
                        }
                    }
                })().catch(() => {});
            }
        } catch (err) {
            console.error("Error al obtener ranking del servidor desde la base de datos:", err);
            return t(locale, 'ranked.err_db_stats');
        }

        if (playersData.length === 0) {
            return isAllServers 
                ? t(locale, 'ranked.err_no_plays_bot') 
                : t(locale, 'ranked.err_no_plays_guild');
        }

        // Ordenar lista
        if (sortType === 'wins') {
            playersData.sort((a, b) => {
                if (b.wins !== a.wins) return b.wins - a.wins;
                return b.rating - a.rating;
            });
        } else if (sortType === 'winrate') {
            playersData.sort((a, b) => {
                const wrA = a.plays > 0 ? (a.wins / a.plays) : 0;
                const wrB = b.plays > 0 ? (b.wins / b.plays) : 0;
                if (wrB !== wrA) return wrB - wrA;
                return b.rating - a.rating;
            });
        } else if (sortType === 'plays') {
            playersData.sort((a, b) => {
                if (b.plays !== a.plays) return b.plays - a.plays;
                return b.rating - a.rating;
            });
        } else {
            playersData.sort((a, b) => {
                if (b.rating !== a.rating) return b.rating - a.rating;
                return b.wins - a.wins;
            });
        }

        // Paginación en memoria
        const totalPlayers = playersData.length;
        const maxDiscordPages = Math.ceil(totalPlayers / 10);
        let currentPage = parsed_args.page || 1;

        if (currentPage > maxDiscordPages) currentPage = maxDiscordPages;
        if (currentPage < 1) currentPage = 1;

        let guildName = t(locale, 'ranked.label_all_servers');
        if (guildFilterId) {
            try {
                const guild = await message.client.guilds.fetch(guildFilterId);
                if (guild) guildName = guild.name;
            } catch {
                guildName = `Servidor (ID: ${guildFilterId})`;
            }
        }

        const getEmbed = (pageVal) => {
            const startIdx = (pageVal - 1) * 10;
            const chunk = playersData.slice(startIdx, startIdx + 10);
            return doOsuRankedLeaderboardEmbed({
                chunk,
                total: totalPlayers,
                startIndex: startIdx,
                isServer: true,
                serverName: guildName,
                sortType,
                message,
                locale
            });
        };

        const getButtons = (pageVal) => {
            return buildPaginationRow({
                prefix: 'ranked_srv',
                current: (pageVal - 1) * 10,
                total: totalPlayers,
                pageSize: 10
            });
        };

        const sent_message = await message.channel.send({
            embeds: [getEmbed(currentPage)],
            components: totalPlayers > 10 ? [getButtons(currentPage)] : []
        });

        if (totalPlayers <= 10) return;

        const filter = btnInt => btnInt.user.id === message.author.id;
        const collector = sent_message.createMessageComponentCollector({
            filter,
            idle: 60000
        });

        collector.on('collect', async i => {
            try {
                await i.deferUpdate();

                if (i.customId === 'ranked_srv_first') {
                    currentPage = 1;
                } else if (i.customId === 'ranked_srv_prev') {
                    currentPage = Math.max(1, currentPage - 1);
                } else if (i.customId === 'ranked_srv_next') {
                    currentPage = Math.min(maxDiscordPages, currentPage + 1);
                } else if (i.customId === 'ranked_srv_last') {
                    currentPage = maxDiscordPages;
                }

                await i.editReply({
                    embeds: [getEmbed(currentPage)],
                    components: [getButtons(currentPage)]
                });
            } catch (err) {
                console.error("Error al navegar ranking de servidor de ranked play:", err);
            }
        });

        collector.on('end', async () => {
            try {
                await sent_message.edit({ components: [] });
            } catch {}
        });

        return;
    }

    // 3. MODO DETALLES DE UN USUARIO (s.ranked)
    if (logger) logger.process("Consultando perfil de osu! y estadísticas de matchmaking...");

    const osu_userdata = await argsParser(args, {
        "message": message,
        "res": res,
        "command_function": getOsuUser,
        "resolveUserByIndex": true,
        "ignoreBeatmap": true
    });

    if (!osu_userdata.fn_response || typeof osu_userdata.fn_response === 'string') {
        return osu_userdata.fn_response;
    }

    const osuUser = osu_userdata.fn_response;
    if (!osuUser.matchmaking_stats || osuUser.matchmaking_stats.length === 0) {
        return t(locale, 'ranked.err_no_stats', { username: osuUser.username });
    }

    const matchmaking = osuUser.matchmaking_stats.find(m => m.pool && m.pool.type === 'ranked_play') || osuUser.matchmaking_stats[0];
    if (!matchmaking) {
        return t(locale, 'ranked.err_no_stats', { username: osuUser.username });
    }

    // Actualizar estadísticas de Ranked Play en segundo plano en la base de datos
    OsuMatchmakingModel.updateUserRankedStatsInBackground(osuUser);

    const embed = doOsuRankedProfileEmbed(message, osuUser, matchmaking, locale);
    return { embeds: [embed] };
}

run.alias = {
    "rk": {
        "args": ""
    },
    "ranked": {
        "args": ""
    },
    "rks": {
        "args": "-server"
    }
};

run.description = {
    'header': t('es', 'commands.ranked.header'),
    'body': t('es', 'commands.ranked.body'),
    'usage': t('es', 'commands.ranked.usage')
};

module.exports = { run };

