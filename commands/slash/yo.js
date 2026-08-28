const { SlashCommandBuilder } = require("discord.js");
let yoChatCommand = null;
try {
    yoChatCommand = require("../chat/admin/yo.js");
} catch (e) {
    // Si la carpeta commands/chat/admin/ es privada y no está en Render por .gitignore
}
const { createSlashMessagesContext } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("yo")
    .setDescription("Envía la foto de YO o genera la tarjeta en Canvas (Solo Admin)")
    .addBooleanOption(option =>
        option
            .setName("canvas")
            .setDescription("¿Generar la tarjeta de perfil dinámica con Canvas?")
            .setRequired(false)
    )
    .addStringOption(option =>
        option
            .setName("usuario")
            .setDescription("Usuario de osu! o mención para la tarjeta (opcional)")
            .setRequired(false)
    )
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
    if (!yoChatCommand) {
        return "❌ Este comando no está disponible en este entorno.";
    }
    const isCanvas = interaction.options.getBoolean("canvas");
    const isEmbed = interaction.options.getBoolean("embed");
    const targetUser = interaction.options.getString("usuario");

    const args = [];
    if (isCanvas) args.push("-canva");
    if (isEmbed) args.push("-embed");
    if (targetUser) args.push(targetUser);

    const messages = createSlashMessagesContext(interaction, res);

    const result = await yoChatCommand.run(messages, args, chat_commands);
    return result || true;
}

module.exports = { data, run, description: "Envía la foto de YO o genera la tarjeta en Canvas (Solo Admin)" };
