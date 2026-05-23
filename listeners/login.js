const { ActivityType, Events } = require('discord.js');
const Logger = require("../utils/logger.js");

async function login(client, config) {
    client.once(Events.ClientReady, (c) => {
        const { version } = require('../package.json');
        const activityText = `v${version} - Activo`;
        c.user.setActivity(activityText, { type: ActivityType.Playing });
        Logger.system(`Bot iniciado y listo en Discord como ${c.user.tag}`);
        
        // Inicializar gestor de sorteos
        try {
            const { initGiveawayManager } = require('../models/GiveawayModel.js');
            initGiveawayManager(c);
            Logger.system("Gestor de sorteos (Giveaways) inicializado con éxito.");
        } catch (err) {
            Logger.system(`Error al inicializar gestor de sorteos: ${err.message}`);
        }
    });

    await client.login(config.TOKEN);
}

module.exports = { login };