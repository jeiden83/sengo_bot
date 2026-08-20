const { ActivityType, Events } = require('discord.js');
const Logger = require("../utils/logger.js");

async function login(client, config) {
    Logger.system("Intentando iniciar sesión en Discord...");
    
    // Registrar listeners de estado y eventos de red del cliente Discord
    client.on(Events.Error, (err) => {
        Logger.system(`[Discord Error] ${err.message}`);
    });

    client.on(Events.ShardError, (err, shardId) => {
        Logger.system(`[Discord Shard Error #${shardId}] ${err.message}`);
    });

    client.on(Events.ShardDisconnect, (event, shardId) => {
        Logger.system(`[Discord Shard Desconectado #${shardId}] Código de cierre: ${event.code}`);
    });

    client.on(Events.ShardReconnecting, (shardId) => {
        Logger.system(`[Discord Shard Reconectando #${shardId}]...`);
    });

    client.on(Events.Warn, (info) => {
        Logger.system(`[Discord Warn] ${info}`);
    });

    client.on(Events.Debug, (info) => {
        // Ocultar heartbeats rutinarios de discord para evitar spam en los logs
        if (info.toLowerCase().includes('heartbeat')) return;
        Logger.system(`[Discord WS] ${info}`);
    });

    client.once(Events.ClientReady, (c) => {
        const { version } = require('../package.json');
        const activityText = `v${version} - Activo`;
        c.user.setActivity(activityText, { type: ActivityType.Playing });
        Logger.system(`Sengo iniciado y listo en Discord como ${c.user.tag}`);
        
        // Inicializar gestor de sorteos
        try {
            const { initGiveawayManager } = require('../models/GiveawayModel.js');
            initGiveawayManager(c);
            Logger.system("Gestor de sorteos (Giveaways) inicializado con éxito.");
        } catch (err) {
            Logger.system(`Error al inicializar gestor de sorteos: ${err.message}`);
        }
    });

    try {
        if (!config.TOKEN) {
            throw new Error("El token de Discord no está configurado (TOKEN es undefined o nulo)");
        }
        Logger.system(`Ejecutando client.login con token prefijo: ${config.TOKEN.substring(0, 10)}...`);
        const loginResult = await client.login(config.TOKEN);
        Logger.system(`client.login completado. Resultado de la conexión: ${loginResult ? "Conexión exitosa" : "Sin resultado"}`);
    } catch (err) {
        Logger.system(`Error crítico al iniciar sesión en Discord: ${err.message}`);
        console.error(err);
        throw err;
    }
}

module.exports = { login };