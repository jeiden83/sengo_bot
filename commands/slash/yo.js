const { SlashCommandBuilder } = require("discord.js");
const yoChatCommand = require("../chat/admin/yo.js");
const { createSlashMessagesContext } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("yo")
    .setDescription("Envía la foto de YO (Solo Admin)")
    .addBooleanOption(option =>
        option
            .setName("embed")
            .setDescription("¿Enviar la imagen dentro de un embed?")
            .setRequired(false)
    );

// Permitir instalación de usuario y contextos
if (typeof data.setIntegrationTypes === "function") {
    data.setIntegrationTypes([0, 1]);
}
if (typeof data.setContexts === "function") {
    data.setContexts([0, 1, 2]);
}

async function run(interaction, res, chat_commands) {
    const isEmbed = interaction.options.getBoolean("embed");
    const args = isEmbed ? ["-embed"] : [];
    const messages = createSlashMessagesContext(interaction, res);

    const result = await yoChatCommand.run(messages, args, chat_commands);
    return result || true;
}

module.exports = { data, run, description: "Envía la foto de YO (Solo Admin)" };
