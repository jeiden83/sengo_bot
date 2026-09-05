const { SlashCommandBuilder } = require("discord.js");
const yuriChatCommand = require("../chat/meme/yuri.js");
const { createSlashMessagesContext } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("yuri")
    .setDescription("Muestra una imagen de la colección Yuri o estadísticas detalladas")
    .addIntegerOption(option =>
        option.setName("indice")
            .setDescription("El número de imagen específica que deseas ver (1 a N)")
            .setRequired(false)
            .setMinValue(1)
    )
    .addBooleanOption(option =>
        option.setName("estadisticas")
            .setDescription("¿Quieres ver estadísticas detalladas de la colección?")
            .setRequired(false)
    );

// Permitir instalación de usuario y contextos
if (typeof data.setIntegrationTypes === 'function') {
    data.setIntegrationTypes([0, 1]);
}
if (typeof data.setContexts === 'function') {
    data.setContexts([0, 1, 2]);
}

async function run(interaction, res, chat_commands) {
    const indice = interaction.options.getInteger("indice");
    const estadisticas = interaction.options.getBoolean("estadisticas");

    const args = [];
    if (estadisticas) {
        args.push("-d");
    } else if (indice !== null) {
        args.push(indice.toString());
    }

    const messages = createSlashMessagesContext(interaction, res);

    const result = await yuriChatCommand.run(messages, args, chat_commands);
    return result || true;
}

module.exports = { data, run, description: "Muestra una imagen de la colección Yuri o estadísticas detalladas" };
