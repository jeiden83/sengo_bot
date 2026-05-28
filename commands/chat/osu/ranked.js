const { getOsuUser, argsParser, argsParserNoCommand } = require("../../utils/osu.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const OsuMatchmakingModel = require("../../../models/OsuMatchmakingModel.js");
const { doOsuRankedProfileEmbed, doOsuRankedLeaderboardEmbed } = require("../../../views/osuRankingViews.js");
const { buildPaginationRow } = require("../../../views/osuViewHelpers.js");

async function run(messages, args) {
    const { message, res, logger } = messages;

    const hasTop = args.some(arg => typeof arg === 'string' && ['-top', '-t'].includes(arg.toLowerCase().trim()));
    const hasServer = args.some(arg => typeof arg === 'string' && ['-server', '-srv'].includes(arg.toLowerCase().trim()));
    const isWinsSort = args.some(arg => typeof arg === 'string' && ['-wins', '-w'].includes(arg.toLowerCase().trim()));

    // 1. MODO TABLA DE CLASIFICACIÓN GLOBAL (s.ranked -top)
    if (hasTop && !hasServer) {
        const parsed_args = argsParserNoCommand(args);
        let currentPage = parsed_args.page || 1;

        if (logger) logger.process("Obteniendo ranking global de Ranked Play...");
        let loadingMsg;
        try {
            loadingMsg = await message.channel.send("⏳ Obteniendo tabla de clasificación global...");
        } catch (e) {
            console.error("Error al enviar mensaje temporal en ranked -top:", e);
        }

        try {
            let currentOsuPage = Math.ceil(currentPage / 5);
            let { players, maxPages: maxOsuPages } = await OsuMatchmakingModel.fetchRankedPlayLeaderboard(currentOsuPage);
            const totalPlayers = maxOsuPages * 50;

            if (players.length === 0) {
                if (loadingMsg) await loadingMsg.edit("❌ No se encontraron jugadores en el ranking global.");
                return;
            }

            const sortAndSlice = (pageVal, playersList) => {
                let list = [...playersList];
                if (isWinsSort) {
                    list.sort((a, b) => {
                        if (b.wins !== a.wins) return b.wins - a.wins;
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
                isWinsSort,
                message
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
                        isWinsSort,
                        message
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
            if (loadingMsg) await loadingMsg.edit("❌ Hubo un error al consultar el ranking global de Ranked Play.");
        }
        return;
    }

    // 2. MODO TABLA DE CLASIFICACIÓN DEL SERVIDOR (s.ranked -server)
    if (hasServer) {
        const parsed_args = argsParserNoCommand(args);
        let targetGuildId = parsed_args.targetGuildId;

        if (targetGuildId && targetGuildId !== "SELF") {
            const ownerId = process.env.OWNER_ID;
            if (message.author.id !== ownerId) {
                return "❌ Solo el creador del bot puede consultar otros servidores con `-server <id>`.";
            }
        } else {
            if (message.guild) {
                targetGuildId = message.guild.id;
            } else {
                return "❌ Este comando debe ejecutarse en un servidor o especificar un ID de servidor válido con `-server <id>`.";
            }
        }

        if (logger) logger.process("Obteniendo usuarios vinculados del servidor...");
        const linkedUsers = await OsuUserModel.getLinkedUsers({ guildId: targetGuildId });

        if (!linkedUsers || linkedUsers.length === 0) {
            return "❌ No hay usuarios vinculados en este servidor.";
        }

        const total = linkedUsers.length;
        let loadingMsg;
        try {
            loadingMsg = await message.channel.send(`⏳ Obteniendo estadísticas de Ranked Play para los usuarios del servidor (0/${total})...`);
        } catch (e) {
            console.error("Error al enviar mensaje temporal en ranked -server:", e);
        }

        const playersData = [];
        const batchSize = 5;
        try {
            for (let i = 0; i < total; i += batchSize) {
                const batch = linkedUsers.slice(i, i + batchSize);
                await Promise.all(batch.map(async (u) => {
                    try {
                        const osuUser = await OsuUserModel.getOsuUser({ username: [u.osu_id.toString()], gamemode: u.main_gamemode || 'osu' });
                        if (osuUser && osuUser.matchmaking_stats) {
                            const matchmaking = osuUser.matchmaking_stats.find(m => m.pool && m.pool.type === 'ranked_play') || osuUser.matchmaking_stats[0];
                            if (matchmaking && matchmaking.plays > 0) {
                                playersData.push({
                                    username: osuUser.username,
                                    userId: osuUser.id.toString(),
                                    countryCode: osuUser.country_code,
                                    rating: matchmaking.rating || 0,
                                    wins: matchmaking.first_placements || 0,
                                    plays: matchmaking.plays || 0,
                                    isProvisional: matchmaking.is_rating_provisional || false
                                });
                            }
                        }
                    } catch (err) {
                        console.error(`[RANKED] Error al obtener perfil de ${u.osu_id}:`, err);
                    }
                }));

                const currentCount = Math.min(i + batchSize, total);
                if (loadingMsg) {
                    try {
                        await loadingMsg.edit(`⏳ Obteniendo estadísticas de Ranked Play para los usuarios del servidor (${currentCount}/${total})...`);
                    } catch {}
                }
            }

            if (playersData.length === 0) {
                if (loadingMsg) await loadingMsg.edit("❌ Ningún usuario vinculado en este servidor ha jugado partidas de Ranked Play esta temporada.");
                return;
            }

            // Ordenar lista
            if (isWinsSort) {
                playersData.sort((a, b) => {
                    if (b.wins !== a.wins) return b.wins - a.wins;
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

            const guildName = message.guild ? message.guild.name : "Servidor";

            const getEmbed = (pageVal) => {
                const startIdx = (pageVal - 1) * 10;
                const chunk = playersData.slice(startIdx, startIdx + 10);
                return doOsuRankedLeaderboardEmbed({
                    chunk,
                    total: totalPlayers,
                    startIndex: startIdx,
                    isServer: true,
                    serverName: guildName,
                    isWinsSort,
                    message
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

            let sent_message;
            if (loadingMsg) {
                sent_message = await loadingMsg.edit({
                    content: null,
                    embeds: [getEmbed(currentPage)],
                    components: totalPlayers > 10 ? [getButtons(currentPage)] : []
                });
            } else {
                sent_message = await message.channel.send({
                    embeds: [getEmbed(currentPage)],
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

        } catch (err) {
            console.error("Error en ranked -server:", err);
            if (loadingMsg) await loadingMsg.edit("❌ Hubo un error al procesar la clasificación del servidor.");
        }
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
        return `❌ El usuario **${osuUser.username}** no tiene estadísticas de Ranked Play.`;
    }

    const matchmaking = osuUser.matchmaking_stats.find(m => m.pool && m.pool.type === 'ranked_play') || osuUser.matchmaking_stats[0];
    if (!matchmaking) {
        return `❌ El usuario **${osuUser.username}** no tiene estadísticas de Ranked Play.`;
    }

    const embed = doOsuRankedProfileEmbed(message, osuUser, matchmaking);
    return { embeds: [embed] };
}

run.alias = {
    "rk": {
        "args": ""
    },
    "ranked": {
        "args": ""
    }
};

run.description = {
    'header': 'Detalles de Ranked Play de un usuario',
    'body': 'Muestra el rango global, rating (ELO), victorias, partidas jugadas y tasa de victoria de Ranked Play (lazer) del usuario.',
    'usage': `s.ranked : Muestra tus estadísticas.\ns.ranked 'usuario_osu' : Muestra las estadísticas del usuario especificado.\ns.ranked -top : Muestra la clasificación global de Ranked Play.\ns.ranked -top -wins : Muestra la clasificación global ordenada por victorias.\ns.ranked -server : Muestra la clasificación de los usuarios del servidor.`
};

module.exports = { run };
