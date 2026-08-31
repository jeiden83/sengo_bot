const { SlashCommandBuilder } = require("discord.js");
const cardChatCommand = require("../chat/osu/card.js");
const { createSlashMessagesContext, addUsuarioOption } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("card")
    .setDescription("Genera una tarjeta de perfil dinámica de osu! con Canvas")
    .addStringOption(addUsuarioOption)
    .addBooleanOption(option =>
        option
            .setName("embed")
            .setDescription("¿Enviar la tarjeta dentro de un embed?")
            .setRequired(false)
    );

// Permitir instalación de usuario y servidores externos
if (typeof data.setIntegrationTypes === "function") {
    data.setIntegrationTypes([0, 1]);
}
if (typeof data.setContexts === "function") {
    data.setContexts([0, 1, 2]);
}

async function run(interaction, res, chat_commands) {
    const isEmbed = interaction.options.getBoolean("embed");
    const targetUser = interaction.options.getString("usuario");

    const args = [];
    if (isEmbed) args.push("-embed");
    if (targetUser) args.push(targetUser);

    const messages = createSlashMessagesContext(interaction, res);

    const result = await cardChatCommand.run(messages, args, chat_commands);
    return result || true;
}

run.description = "Genera una tarjeta de perfil dinámica de osu! con Canvas";

module.exports = { data, run, description: run.description };
