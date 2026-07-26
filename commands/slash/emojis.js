const { SlashCommandBuilder, Collection } = require("discord.js");
const emojisChatCommand = require("../chat/utils/emojis.js");

const data = new SlashCommandBuilder()
    .setName("emojis")
    .setDescription("Gestión de emojis de la aplicación de Sengo")
    .addSubcommand(sub =>
        sub.setName("listar")
            .setDescription("Listar los emojis de la aplicación de Sengo")
    )
    .addSubcommand(sub =>
        sub.setName("subir")
            .setDescription("Subir un nuevo emoji a la aplicación de Sengo (Solo creador)")
            .addAttachmentOption(opt =>
                opt.setName("imagen")
                    .setDescription("Imagen a subir como emoji (PNG, JPG, GIF)")
                    .setRequired(true)
            )
            .addStringOption(opt =>
                opt.setName("nombre")
                    .setDescription("Nombre personalizado para el emoji (opcional)")
                    .setRequired(false)
            )
    )
    .addSubcommand(sub =>
        sub.setName("exportar")
            .setDescription("Exportar todos los emojis de la aplicación a un archivo .txt (Solo creador)")
    );

async function run(interaction, res) {
    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);

    const subcommand = interaction.options.getSubcommand(false) || "listar";
    const args = [];
    const attachments = new Collection();

    if (subcommand === "subir") {
        args.push("-subir");
        const imagen = interaction.options.getAttachment("imagen");
        const nombre = interaction.options.getString("nombre");

        if (imagen) {
            attachments.set(imagen.id, imagen);
        }
        if (nombre) {
            args.push(nombre);
        }
    } else if (subcommand === "exportar") {
        args.push("-exportar");
    } else {
        args.push("-lista");
    }

    messages.message.attachments = attachments;

    const result = await emojisChatCommand.run(messages, args);

    if (result) {
        await interaction.editReply(result);
    }

    return true;
}

module.exports = { data, run, description: "Gestión de emojis de la aplicación de Sengo" };
