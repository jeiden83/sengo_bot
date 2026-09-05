const { SlashCommandBuilder } = require("discord.js");
const fateChatCommand = require("../chat/meme/fate.js");
const { createSlashMessagesContext } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("fate")
    .setDescription("Muestra la guía con el orden para ver la serie de anime Fate");

// Permitir instalación de usuario y contextos
if (typeof data.setIntegrationTypes === 'function') {
    data.setIntegrationTypes([0, 1]);
}
if (typeof data.setContexts === 'function') {
    data.setContexts([0, 1, 2]);
}

async function run(interaction, res) {
    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);

    const result = await fateChatCommand.run(messages, []);

    if (result) {
        await interaction.editReply(result);
    }

    return true;
}

run.description = "Muestra la guía con el orden para ver la serie de anime Fate";

module.exports = {
    data,
    run,
    description: run.description
};
