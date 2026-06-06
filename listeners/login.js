const { ActivityType, Events } = require('discord.js');
const Logger = require("../utils/logger.js");

async function login(client, config) {
    Logger.system("Intentando iniciar sesión en Discord...");
    
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