const { SlashCommandBuilder } = require("discord.js");
const yuriChatCommand = require("../chat/meme/yuri.js");

const data = new SlashCommandBuilder()
    .setName("yuri")
    .setDescription("Muestra una imagen de la colección Yuri o estadísticas detalladas")
    .addIntegerOption(option =>
        option.setName("indice")
            .setDescription("El número de imagen específica que deseas ver (1 a N)")
            .setRequired(false)
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
        // En los comandos de chat, el usuario ingresa 1-indexed. Sin embargo, en yuri.js:
        // si se recibe un argumento numérico, yuri.js lo maneja como 0-indexed en algunas partes
        // o hace parseo. Vamos a ver:
        // En yuri.js (Supabase):
        // const requestedIndex = parseInt(args[0]);
        // if (!isNaN(requestedIndex) && requestedIndex >= 0) {
        //     const idx = Math.min(requestedIndex, imageFiles.length - 1);
        // ...
        // Así que si pasan el índice directamente, yuri.js lo lee tal cual.
        args.push(indice.toString());
    }

    const messages = {
        message: {
            author: interaction.user,
            member: interaction.member,
            guild: interaction.guild
        },
        res: res,
        reply: null,
        logger: interaction.logger
    };

    return await yuriChatCommand.run(messages, args, chat_commands);
}

module.exports = { data, run, description: "Muestra una imagen de la colección Yuri o estadísticas detalladas" };
