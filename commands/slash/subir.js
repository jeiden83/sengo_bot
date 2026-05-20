const { SlashCommandBuilder, Collection } = require("discord.js");
const subirChatCommand = require("../chat/osu/subir.js");

const data = new SlashCommandBuilder()
    .setName("subir")
    .setDescription("Sube una score (.osr o embed de bot) a la base de datos de Sengo")
    .addAttachmentOption(option =>
        option.setName("archivo")
            .setDescription("Archivo de repetición de osu! (.osr)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("mods")
            .setDescription("Sobrescribir los mods (ej: HDDT). NM para sin mods.")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("mensaje")
            .setDescription("ID o enlace de un mensaje en este canal para extraer la score")
            .setRequired(false)
    );

async function run(interaction, res) {
    const archivo = interaction.options.getAttachment("archivo");
    const mods = interaction.options.getString("mods");
    const mensaje = interaction.options.getString("mensaje");

    let replyMessage = null;

    if (mensaje) {
        try {
            let targetMessageId = mensaje.trim();
            const linkMatch = mensaje.match(/\/messages\/\d+\/(\d+)/);
            if (linkMatch) {
                targetMessageId = linkMatch[1];
            }
            replyMessage = await interaction.channel.messages.fetch(targetMessageId);
        } catch (err) {
            await interaction.editReply("⚠️ No se pudo encontrar o acceder al mensaje especificado. Asegúrate de que el ID/enlace sea correcto y esté en este canal.");
            return true;
        }
    }

    const attachments = new Collection();
    if (archivo) {
        attachments.set(archivo.id, archivo);
    }

    const args = [];
    if (mods) {
        args.push("-m", mods);
    }

    const messages = {
        message: {
            author: interaction.user,
            member: interaction.member,
            guild: interaction.guild,
            attachments: attachments,
            channel: {
                send: async (options) => {
                    return await interaction.editReply(options);
                },
                sendTyping: async () => {
                    // no-op para slash command
                },
                messages: interaction.channel.messages,
                guild: interaction.guild
            }
        },
        res: res,
        reply: replyMessage,
        logger: interaction.logger
    };

    // Llamamos al comando de chat original
    const result = await subirChatCommand.run(messages, args);

    if (result) {
        // Si devolvió un objeto (embeds, content) o un string directamente
        await interaction.editReply(result);
    }

    return true; // Auto-gestionado
}

module.exports = { data, run, description: "Sube una score a la base de datos de Sengo" };
