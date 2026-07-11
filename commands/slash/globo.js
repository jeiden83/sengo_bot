const { SlashCommandBuilder, Collection } = require("discord.js");
const globoChatCommand = require("../chat/meme/globo.js");

const data = new SlashCommandBuilder()
    .setName("globo")
    .setDescription("Añade un globo de texto a una imagen")
    .addAttachmentOption(option =>
        option.setName("imagen")
            .setDescription("Imagen a la que añadir el globo de texto")
            .setRequired(true)
    );

async function run(interaction, res) {
    const imagen = interaction.options.getAttachment("imagen");

    const attachments = new Collection();
    if (imagen) {
        attachments.set(imagen.id, imagen);
    }

    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);
    messages.message.attachments = attachments;

    // Invocar al comando de chat original
    const result = await globoChatCommand.run(messages, []);

    if (result) {
        await interaction.editReply(result);
    }

    return true;
}

module.exports = {
    data,
    run,
    description: "Añade un globo de texto a una imagen"
};
