const Logger = require("../utils/logger.js");

/**
 * Inicializa todos los servicios en segundo plano del bot de forma ordenada.
 * @param {import("discord.js").Client} client - El cliente de Discord.
 * @param {Object} dbRes - El resultado de connectDB.
 * @param {Object} config - Configuración global del bot.
 * @param {boolean} todayLogExists - Indica si ya existía el archivo de log para hoy.
 */
function initializeServices(client, dbRes, config, todayLogExists) {
    Logger.system("Inicializando gestor central de servicios...");

    // 1. Servidor de Webhook (Render Port Keeper)
    try {
        const { initWebhookServer } = require("../commands/utils/webhook.js");
        initWebhookServer(client, dbRes, config);
    } catch (err) {
        Logger.system(`Error al iniciar Webhook Server: ${err.message}`);
    }

    // 2. Anunciador de Cumpleaños
    try {
        const { initBirthdayAnnouncer } = require("./birthdayAnnouncer.js");
        initBirthdayAnnouncer(client);
    } catch (err) {
        Logger.system(`Error al iniciar Birthday Announcer: ${err.message}`);
    }

    // 3. Sincronizador de Supporter
    try {
        const { initSupporterSync } = require("./supporterSync.js");
        initSupporterSync();
    } catch (err) {
        Logger.system(`Error al iniciar Supporter Sync: ${err.message}`);
    }

    // 4. Crawler de Beatmaps (Sincronización diaria)
    try {
        const { initBeatmapCrawler } = require("./beatmapCrawler.js");
        initBeatmapCrawler();
    } catch (err) {
        Logger.system(`Error al iniciar Beatmap Crawler: ${err.message}`);
    }

    // 5. Servicio de Beatmap Nominators (Mappers' Guild)
    try {
        const MappersGuildModel = require("../models/MappersGuildModel.js");
        MappersGuildModel.startBnBackgroundService();
    } catch (err) {
        Logger.system(`Error al iniciar BN Background Service: ${err.message}`);
    }

    // 6. Worker silencioso de enriquecimiento de user tags (tras 60 segundos)
    setTimeout(() => {
        try {
            const { startTagEnricherWorker } = require("./tagEnricherWorker.js");
            startTagEnricherWorker().catch(err => {
                Logger.system(`Error en el worker de user tags: ${err.message}`);
            });
        } catch (err) {
            Logger.system(`Error al iniciar Worker de User Tags: ${err.message}`);
        }
    }, 60000);

    // 7. Sincronizaciones específicas de la base de datos (Supabase)
    if (dbRes && dbRes.status === 1) {
        // Sincronización de Servidores (Guilds Sync)
        try {
            const { initGuildsSync } = require("./guildsSync.js");
            initGuildsSync(client, dbRes.supabaseClient);
        } catch (err) {
            Logger.system(`Error al iniciar Guilds Sync: ${err.message}`);
        }

        // Inicializar almacenamiento persistente de cumpleaños
        try {
            const BirthdayModel = require("../models/BirthdayModel.js");
            BirthdayModel.initSupabaseStorage().catch(err => {
                Logger.system(`Error al inicializar almacenamiento de cumpleaños: ${err.message}`);
            });
        } catch (err) {
            Logger.system(`Error al inicializar almacenamiento de cumpleaños: ${err.message}`);
        }

        // Sincronización de imágenes Yuri
        try {
            const { syncYuriImages } = require("./yuriSync.js");
            syncYuriImages(dbRes.supabaseClient).catch(err => {
                Logger.system(`Error en la tarea de sincronización de imágenes yuri: ${err.message}`);
            });
        } catch (err) {
            Logger.system(`Error en la tarea de sincronización de imágenes yuri: ${err.message}`);
        }

        // Sincronización de logs antiguos (solo al primer encendido diario)
        if (!todayLogExists) {
            try {
                const { syncOlderLogs } = require("./syncLogs.js");
                syncOlderLogs(dbRes.supabaseClient).catch(err => {
                    Logger.system(`Error en la tarea de sincronización de logs antiguos: ${err.message}`);
                });
            } catch (err) {
                Logger.system(`Error en la tarea de sincronización de logs antiguos: ${err.message}`);
            }
        }

        // 8. Servicio de Tracking de osu!
        try {
            const { initOsuTracker } = require("./osuTrackerService.js");
            initOsuTracker(client).catch(err => {
                Logger.system(`Error al iniciar Osu Tracker Service: ${err.message}`);
            });
        } catch (err) {
            Logger.system(`Error al iniciar Osu Tracker Service: ${err.message}`);
        }
    }
}

module.exports = {
    initializeServices
};

