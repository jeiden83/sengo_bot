const Logger = require("../utils/logger.js");
const OsuTournamentModel = require("../models/OsuTournamentModel.js");

let isRunning = false;
let discordClient = null;

/**
 * Realiza una comprobación de los últimos torneos en el foro de osu!
 * y los añade a la base de datos si no existen.
 */
async function checkNewTournaments() {
    if (isRunning) return;
    isRunning = true;

    try {
        Logger.system("[Tournament Crawler] Buscando nuevos torneos y actualizaciones en el foro de osu!...");
        const { newTournaments, updatedTournaments } = await OsuTournamentModel.syncLatestTournaments(10);
        
        const hasNew = newTournaments && newTournaments.length > 0;
        const hasUpdated = updatedTournaments && updatedTournaments.length > 0;

        if (hasNew || hasUpdated) {
            if (hasNew) {
                Logger.system(`[Tournament Crawler] ¡Se detectaron y añadieron ${newTournaments.length} torneos nuevos a la base de datos!`);
            }
            if (hasUpdated) {
                Logger.system(`[Tournament Crawler] ¡Se detectaron cambios en ${updatedTournaments.length} torneos existentes!`);
            }
            
            // Notificar a los canales configurados en el feed de torneos
            if (discordClient) {
                const { getSupabaseClient } = require("../db/database.js");
                const supabase = getSupabaseClient();
                if (supabase) {
                    const { data: configs, error } = await supabase
                        .from('guild_configs')
                        .select('guild_id, tournament_feed_channel_id, language')
                        .not('tournament_feed_channel_id', 'is', null);

                    if (!error && configs && configs.length > 0) {
                        const { doTournamentDetailEmbed } = require("../views/osuTournamentViews.js");
                        
                        // 1. Enviar nuevos torneos
                        if (hasNew) {
                            for (const config of configs) {
                                try {
                                    const channelId = config.tournament_feed_channel_id;
                                    const guildId = config.guild_id;
                                    const locale = config.language || 'es';
                                    const channel = discordClient.channels.cache.get(channelId) || await discordClient.channels.fetch(channelId).catch(() => null);
                                    if (channel && channel.isTextBased()) {
                                        for (const tourney of newTournaments) {
                                            const embed = doTournamentDetailEmbed(tourney, { member: null }, locale);
                                            const message = await channel.send({
                                                content: `📢 **¡Nuevo torneo publicado en el foro!**`,
                                                embeds: [embed]
                                            }).catch(err => {
                                                console.error(`[Tournament Crawler] Error al enviar torneo a canal ${channelId}:`, err);
                                                return null;
                                            });

                                            if (message) {
                                                // Guardar el mensaje enviado para futuras ediciones
                                                await OsuTournamentModel.saveSentMessage(tourney.id, guildId, channelId, message.id);
                                            }
                                        }
                                    }
                                } catch (err) {
                                    console.error(`[Tournament Crawler] Error al procesar feed de nuevos torneos para servidor ${config.guild_id}:`, err);
                                }
                            }
                        }

                        // 2. Editar torneos actualizados
                        if (hasUpdated) {
                            for (const tourney of updatedTournaments) {
                                try {
                                    // Obtener todos los mensajes de feed que enviamos antes para este torneo
                                    const sentMessages = await OsuTournamentModel.getSentMessages(tourney.id);
                                    if (sentMessages && sentMessages.length > 0) {
                                        for (const msgRecord of sentMessages) {
                                            try {
                                                const guildConfig = configs.find(c => c.guild_id === msgRecord.guild_id);
                                                const locale = guildConfig ? (guildConfig.language || 'es') : 'es';
                                                
                                                const channel = discordClient.channels.cache.get(msgRecord.channel_id) || await discordClient.channels.fetch(msgRecord.channel_id).catch(() => null);
                                                if (channel && channel.isTextBased()) {
                                                    const message = await channel.messages.fetch(msgRecord.message_id).catch(() => null);
                                                    if (message) {
                                                        const embed = doTournamentDetailEmbed(tourney, { member: null }, locale);
                                                        await message.edit({
                                                            embeds: [embed]
                                                        }).catch(err => {
                                                            console.error(`[Tournament Crawler] Error al editar mensaje ${msgRecord.message_id} en canal ${msgRecord.channel_id}:`, err);
                                                        });
                                                        Logger.system(`[Tournament Crawler] Embed editado/actualizado para torneo ${tourney.id} en servidor ${msgRecord.guild_id}`);
                                                    } else {
                                                        // Si el mensaje ya no existe (fue borrado), eliminamos el registro del tracker
                                                        await OsuTournamentModel.deleteSentMessage(tourney.id, msgRecord.guild_id);
                                                    }
                                                }
                                            } catch (msgErr) {
                                                console.error(`[Tournament Crawler] Error al procesar edición de mensaje de torneo ${tourney.id} en servidor ${msgRecord.guild_id}:`, msgErr);
                                            }
                                        }
                                    }
                                } catch (tourneyErr) {
                                    console.error(`[Tournament Crawler] Error al editar torneo actualizado ${tourney.id}:`, tourneyErr);
                                }
                            }
                        }
                    }
                }
            }
        } else {
            Logger.system("[Tournament Crawler] Sincronización finalizada. No se encontraron nuevos torneos ni actualizaciones.");
        }
    } catch (error) {
        Logger.system(`[Tournament Crawler] Error durante la sincronización de torneos: ${error.message}`);
    } finally {
        isRunning = false;
    }
}

/**
 * Inicializa el worker de torneos para que se ejecute cada 2 minutos.
 * @param {Object} client - Cliente de Discord.js
 */
function initTournamentCrawler(client) {
    discordClient = client;
    Logger.system("Inicializando worker de torneos (intervalo de 10 minutos)...");

    // Primera ejecución a los 10 segundos del encendido del bot
    setTimeout(() => {
        checkNewTournaments();
    }, 10000);

    // Intervalo de ejecución cada 10 minutos
    setInterval(() => {
        checkNewTournaments();
    }, 10 * 60 * 1000);
}

module.exports = {
    initTournamentCrawler,
    checkNewTournaments
};
