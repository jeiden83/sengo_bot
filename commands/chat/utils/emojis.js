const config = require("../../../config.js");
const { t } = require("../../../utils/i18n.js");
const { doEmojisListEmbed, doEmojisUploadEmbed, createEmojiExportAttachment } = require("../../../views/emojisViews.js");

/**
 * Verifica si el ejecutor del comando es el dueño del bot.
 */
function isOwner(author) {
    const ownerId = config.OWNER_ID || process.env.OWNER_ID;
    return ownerId && author.id === ownerId;
}

/**
 * Limpia y valida el nombre del emoji para cumplir con la especificación de Discord (2-32 caracteres alfanuméricos o guiones bajos).
 */
function sanitizeEmojiName(rawName, fallbackIndex = 1) {
    if (!rawName) return `emoji_${fallbackIndex}`;
    
    // Eliminar extensión si existe y reemplazar caracteres inválidos por _
    let cleaned = rawName
        .replace(/\.[^/.]+$/, "")
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .trim();

    // Eliminar guiones bajos duplicados
    cleaned = cleaned.replace(/_+/g, "_");

    // Limitar longitud entre 2 y 32 caracteres
    if (cleaned.length < 2) {
        cleaned = `emoji_${cleaned || fallbackIndex}`;
    }
    if (cleaned.length > 32) {
        cleaned = cleaned.slice(0, 32);
    }
    return cleaned;
}

async function run(messages, args) {
    const { message } = messages;
    const author = message.author;
    const locale = message.locale || 'es';
    const client = message.client;

    const sub = args[0] ? args[0].toLowerCase() : "";

    // -------------------------------------------------------------
    // OPCIÓN: -exportar / -export
    // -------------------------------------------------------------
    if (sub === '-exportar' || sub === 'exportar' || sub === '-export' || sub === 'export') {
        if (!isOwner(author)) {
            return t(locale, "emojis.err_owner_only");
        }

        try {
            const appEmojis = await client.application.emojis.fetch();
            const fileAttachment = createEmojiExportAttachment(locale, appEmojis);

            return {
                content: `📄 **${t(locale, "emojis.export_title")}**\n${t(locale, "emojis.export_description")}`,
                files: [fileAttachment]
            };
        } catch (error) {
            console.error("[EMOJIS-COMMAND] Error al exportar emojis:", error);
            return `❌ Error al exportar emojis: ${error.message}`;
        }
    }

    // -------------------------------------------------------------
    // OPCIÓN: -subir / -upload
    // -------------------------------------------------------------
    if (sub === '-subir' || sub === 'subir' || sub === '-upload' || sub === 'upload') {
        if (!isOwner(author)) {
            return t(locale, "emojis.err_owner_only");
        }

        const attachments = message.attachments;
        if (!attachments || attachments.size === 0) {
            return t(locale, "emojis.err_no_attachments");
        }

        const customNameArg = args[1] && !args[1].startsWith('-') ? args[1] : null;
        const successList = [];
        const failList = [];
        let index = 1;

        for (const [, attachment] of attachments) {
            const isImage = (attachment.contentType && attachment.contentType.startsWith('image/')) ||
                /\.(png|jpe?g|gif|webp)$/i.test(attachment.name);

            if (!isImage) {
                failList.push({
                    name: attachment.name || `adjunto_${index}`,
                    error: t(locale, "emojis.err_invalid_image")
                });
                index++;
                continue;
            }

            // Nombre personalizado si hay 1 sola imagen y se dio argumento, de lo contrario sanitizar nombre de archivo
            const rawName = (attachments.size === 1 && customNameArg) ? customNameArg : attachment.name;
            const emojiName = sanitizeEmojiName(rawName, index);

            try {
                const createdEmoji = await client.application.emojis.create({
                    attachment: attachment.url,
                    name: emojiName
                });

                successList.push({
                    name: createdEmoji.name,
                    id: createdEmoji.id,
                    animated: createdEmoji.animated
                });
            } catch (err) {
                console.error(`[EMOJIS-COMMAND] Error al subir emoji ${emojiName}:`, err);
                failList.push({
                    name: emojiName,
                    error: err.message || "Error desconocido al comunicarse con Discord API"
                });
            }
            index++;
        }

        const embed = doEmojisUploadEmbed(locale, successList, failList);
        return { content: "", embeds: [embed] };
    }

    // -------------------------------------------------------------
    // OPCIÓN POR DEFECTO: Listar emojis de la aplicación
    // -------------------------------------------------------------
    try {
        const appEmojis = await client.application.emojis.fetch();
        const embed = doEmojisListEmbed(locale, appEmojis);
        return { content: "", embeds: [embed] };
    } catch (error) {
        console.error("[EMOJIS-COMMAND] Error al listar emojis:", error);
        return `❌ Error al consultar la lista de emojis: ${error.message}`;
    }
}

run.description = {
    header: "Gestión de Emojis de la Aplicación (Sengo)",
    body: "Permite listar todos los emojis de la aplicación de Sengo. El creador del bot puede subir nuevos emojis adjuntando imágenes (-subir) o exportar todos los IDs a un archivo .txt (-exportar).",
    usage: "s.emojis [-subir | -exportar]"
};

module.exports = { run };
