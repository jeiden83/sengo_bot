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

    const messages = {
        message: {
            author: interaction.user,
            member: interaction.member,
            guild: interaction.guild,
            attachments: attachments,
            locale: interaction.locale || interaction.resolvedLocale || 'es',
            channel: {
                send: async (options) => {
                    return await interaction.editReply(options);
                },
                sendTyping: async () => {
                    // Sin acción en comandos slash
                },
                messages: interaction.channel?.messages,
                guild: interaction.guild
            }
        },
        res: res,
        reply: null,
        logger: interaction.logger
    };

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
