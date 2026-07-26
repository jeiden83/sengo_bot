const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { t } = require('../utils/i18n.js');

/**
 * Crea un embed para listar los emojis de la aplicación de Sengo.
 * @param {string} locale 
 * @param {Collection} appEmojis 
 * @returns {EmbedBuilder}
 */
function doEmojisListEmbed(locale, appEmojis) {
    const embed = new EmbedBuilder()
        .setTitle(t(locale, "emojis.title_list"))
        .setColor("#FF66AA")
        .setFooter({ text: `Sengo • Total: ${appEmojis.size} emojis`, iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();

    if (!appEmojis || appEmojis.size === 0) {
        embed.setDescription(t(locale, "emojis.no_emojis"));
        return embed;
    }

    const emojiListText = appEmojis.map(emoji => {
        const formatted = `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
        return `${formatted} \`:${emoji.name}:\` • ID: \`${emoji.id}\``;
    }).join('\n');

    // Discord embed description standard length safety (4096 limit)
    if (emojiListText.length > 4000) {
        embed.setDescription(emojiListText.slice(0, 3950) + '\n\n*... y más emojis (usa `s.emojis -exportar` para la lista completa).*');
    } else {
        embed.setDescription(emojiListText);
    }

    return embed;
}

/**
 * Crea un embed con el resultado de la subida de uno o varios emojis.
 * @param {string} locale 
 * @param {Array<{name: string, id: string, animated: boolean}>} successList 
 * @param {Array<{name: string, error: string}>} failList 
 * @returns {EmbedBuilder}
 */
function doEmojisUploadEmbed(locale, successList = [], failList = []) {
    const embed = new EmbedBuilder()
        .setColor(failList.length === 0 ? "#57F287" : (successList.length > 0 ? "#FEE75C" : "#ED4245"))
        .setFooter({ text: "Sengo • Emojis Manager", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();

    let description = "";

    if (successList.length > 0) {
        description += `${t(locale, "emojis.upload_success", { count: successList.length })}\n`;
        successList.forEach(e => {
            const formatted = `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
            description += `${formatted} \`:${e.name}:\` (ID: \`${e.id}\`)\n`;
        });
    }

    if (failList.length > 0) {
        if (description) description += "\n";
        description += `⚠️ **Fallos al subir (${failList.length}):**\n`;
        failList.forEach(f => {
            description += `• **${f.name}**: ${f.error}\n`;
        });
    }

    embed.setDescription(description || t(locale, "emojis.upload_failed"));
    return embed;
}

/**
 * Crea el archivo adjunto (AttachmentBuilder) con el contenido exportado de los emojis en .txt
 * @param {string} locale 
 * @param {Collection} appEmojis 
 * @returns {AttachmentBuilder}
 */
function createEmojiExportAttachment(locale, appEmojis) {
    let fileContent = `===============================================\n`;
    fileContent += `   SENGO BOT - EXPORTACIÓN DE APP EMOJIS        \n`;
    fileContent += `   Total: ${appEmojis.size} emojis             \n`;
    fileContent += `===============================================\n\n`;

    fileContent += `--- LISTADO DE EMOJIS (NOMBRE: ID) ---\n`;
    
    const sortedEmojis = Array.from(appEmojis.values()).sort((a, b) => a.name.localeCompare(b.name));
    
    sortedEmojis.forEach(emoji => {
        const formattedTag = `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
        fileContent += `${emoji.name.padEnd(25, ' ')} : ${emoji.id}  (${formattedTag})\n`;
    });

    fileContent += `\n\n--- OBJETO JSON (Para src/emoji_mods.json o configuración) ---\n{\n`;
    const jsonEntries = sortedEmojis.map(emoji => `  "${emoji.name}": "${emoji.id}"`).join(",\n");
    fileContent += jsonEntries;
    fileContent += `\n}\n`;

    const buffer = Buffer.from(fileContent, 'utf-8');
    const fileName = t(locale, "emojis.export_filename") || "sengo_emojis_export.txt";

    return new AttachmentBuilder(buffer, { name: fileName });
}

module.exports = {
    doEmojisListEmbed,
    doEmojisUploadEmbed,
    createEmojiExportAttachment
};
