const { SlashCommandBuilder } = require("discord.js");
const contribuidoresChat = require("../chat/about/contribuidores.js");

const data = new SlashCommandBuilder()
    .setName("contribuidores")
    .setDescription("Muestra la lista de usuarios vinculados por oAuth.")
    .addBooleanOption(option => 
        option.setName("force")
            .setDescription("Fuerza la sincronización en tiempo real del estado de supporter de todos los usuarios.")
            .setRequired(false)
    );

// Permitir instalación de usuario y contextos
if (typeof data.setIntegrationTypes === 'function') {
    data.setIntegrationTypes([0, 1]);
}
if (typeof data.setContexts === 'function') {
    data.setContexts([0, 1, 2]);
}

async function run(interaction, res) {
    const force = interaction.options.getBoolean("force") || false;
    const args = force ? ["-force"] : [];

    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);

    const result = await contribuidoresChat.run(messages, args);

    if (result) {
        await interaction.editReply(result);
    }

    return true;
}

run.description = "Muestra la lista de usuarios vinculados por oAuth.";

module.exports = { data, run, description: run.description };
