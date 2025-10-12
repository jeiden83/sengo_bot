const { ActivityType } = require('discord.js');

async function login(client, config) {
    client.login(config.TOKEN);
    client.once('clientReady', () => {

        client.user.setActivity('Activo', { type: ActivityType.Playing });
        console.log(`> Bot iniciado con exito como ${client.user.tag}`);
    })    
}

module.exports = { login };