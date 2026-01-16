const { ActivityType, Events } = require('discord.js');

async function login(client, config) {
    client.once(Events.ClientReady, (c) => {
        c.user.setActivity('Activo', { type: ActivityType.Playing });
        console.log(`> Bot iniciado como ${c.user.tag}`);
    });

    await client.login(config.TOKEN);
}

module.exports = { login };