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
        option.setName("mensaje")
            .setDescription("ID o enlace de un mensaje en este canal para extraer la score")
            .setRequired(false)
    );

async function run(interaction, res) {
    const archivo = interaction.options.getAttachment("archivo");
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

    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);
    messages.message.attachments = attachments;
    messages.reply = replyMessage;

    // Llamamos al comando de chat original
    const result = await subirChatCommand.run(messages, args);

    if (result) {
        // Si devolvió un objeto (embeds, content) o un string directamente
        await interaction.editReply(result);
    }

    return true; // Auto-gestionado
}

module.exports = { data, run, description: "Sube una score a la base de datos de Sengo" };
