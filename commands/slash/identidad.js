const { SlashCommandBuilder } = require("discord.js");
const identidadChatCommand = require("../chat/osu/identidad.js");

const data = new SlashCommandBuilder()
    .setName("identidad")
    .setDescription("Asigna automáticamente tus roles de país y dígitos");

async function run(interaction, res) {
    const args = [];

    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);

    const result = await identidadChatCommand.run(messages, args);

    if (result) {
        await interaction.editReply(result);
    }

    return true; // Auto-gestionado
}

module.exports = { data, run, description: "Asigna automáticamente tus roles de país y dígitos" };
