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
        Logger.system("[Tournament Crawler] Buscando nuevos torneos en el foro de osu!...");
        const newTournaments = await OsuTournamentModel.syncLatestTournaments(10);
        
        if (newTournaments.length > 0) {
            Logger.system(`[Tournament Crawler] ¡Se detectaron y añadieron ${newTournaments.length} torneos nuevos a la base de datos!`);
            
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
                        for (const config of configs) {
                            try {
                                const channelId = config.tournament_feed_channel_id;
                                const locale = config.language || 'es';
                                const channel = discordClient.channels.cache.get(channelId) || await discordClient.channels.fetch(channelId).catch(() => null);
                                if (channel && channel.isTextBased()) {
                                    for (const tourney of newTournaments) {
                                        const embed = doTournamentDetailEmbed(tourney, { member: null }, locale);
                                        await channel.send({
                                            content: `📢 **¡Nuevo torneo publicado en el foro!**`,
                                            embeds: [embed]
                                        }).catch(err => {
                                            console.error(`[Tournament Crawler] Error al enviar torneo a canal ${channelId}:`, err);
                                        });
                                    }
                                }
                            } catch (err) {
                                console.error(`[Tournament Crawler] Error al procesar feed para servidor ${config.guild_id}:`, err);
                            }
                        }
                    }
                }
            }
        } else {
            Logger.system("[Tournament Crawler] Sincronización finalizada. No se encontraron nuevos torneos.");
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
    Logger.system("Inicializando worker de torneos (intervalo de 2 minutos)...");

    // Primera ejecución a los 10 segundos del encendido del bot
    setTimeout(() => {
        checkNewTournaments();
    }, 10000);

    // Intervalo de ejecución cada 2 minutos
    setInterval(() => {
        checkNewTournaments();
    }, 2 * 60 * 1000);
}

module.exports = {
    initTournamentCrawler,
    checkNewTournaments
};
