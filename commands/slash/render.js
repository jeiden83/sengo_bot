const { SlashCommandBuilder, Collection } = require("discord.js");
const renderChatCommand = require("../chat/osu/render.js");

const data = new SlashCommandBuilder()
    .setName("render")
    .setDescription("Renderiza un replay (.osr) de osu!standard a video a través de o!rdr")
    .addAttachmentOption(option =>
        option.setName("archivo")
            .setDescription("Archivo de repetición de osu! (.osr)")
            .setRequired(true)
    )
    .addStringOption(option =>
        option.setName("skin")
            .setDescription("Nombre de la skin a utilizar en el render")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("resolucion")
            .setDescription("Resolución del video a renderizar")
            .setRequired(false)
            .addChoices(
                { name: "720p (1280x720)", value: "1280x720" },
                { name: "1080p (1920x1080)", value: "1920x1080" }
            )
    );

async function run(interaction, res) {
    const archivo = interaction.options.getAttachment("archivo");
    const skin = interaction.options.getString("skin");
    const resolucion = interaction.options.getString("resolucion");

    const attachments = new Collection();
    if (archivo) {
        attachments.set(archivo.id, archivo);
    }

    const args = [];
    if (skin) {
        args.push("-skin", skin);
    }
    if (resolucion) {
        args.push("-res", resolucion);
    }

    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);
    messages.message.attachments = attachments;

    // Invocar al comando de chat original
    const result = await renderChatCommand.run(messages, args);

    if (result) {
        // Si devolvió un string de error o un embed inicial directamente (ej: validaciones fallidas antes del WebSocket)
        await interaction.editReply(result);
    }

    return true;
}

module.exports = {
    data,
    run,
    description: "Renderiza un replay (.osr) de osu!standard a video a través de o!rdr"
};
