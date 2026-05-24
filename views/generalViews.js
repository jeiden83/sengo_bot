const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getEmbedColor } = require("./osuViewHelpers.js");

/**
 * Genera el embed del listado general de ayuda.
 */
function doHelpListEmbed(message, fields, description) {
    const embedColor = getEmbedColor(message);
    const icon_url = message.author.displayAvatarURL({ dynamic: true, size: 512 });

    const embed = new EmbedBuilder()
        .setAuthor({
            name: 'Menú de Ayuda • Sengo',
            iconURL: icon_url
        })
        .setDescription(description)
        .setColor(embedColor)
        .setFooter({
            text: "Sengo • s.help [comando]",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    if (fields && fields.length > 0) {
        embed.addFields(fields);
    }

    return embed;
}

/**
 * Genera el embed de ayuda para un comando específico.
 */
function doHelpCommandEmbed(message, mainName, queryName, helpData) {
    const embedColor = getEmbedColor(message);
    const icon_url = message.author.displayAvatarURL({ dynamic: true, size: 512 });

    const title = `Ayuda de Comando: s.${mainName}${mainName !== queryName ? ` (Alias: s.${queryName})` : ''}`;

    const embed = new EmbedBuilder()
        .setAuthor({
            name: title,
            iconURL: icon_url
        })
        .setDescription(`*${helpData.headerText}*`)
        .setColor(embedColor)
        .setFooter({
            text: "Sengo • s.help [comando]",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    if (helpData.fields && helpData.fields.length > 0) {
        embed.addFields(helpData.fields);
    }

    return embed;
}

/**
 * Crea la fila de botones para navegar entre los comandos de una misma categoría.
 */
function buildHelpNavigationRow(currentCmd, categoryCmds) {
    if (categoryCmds.length <= 1) return null;

    const currentIndex = categoryCmds.indexOf(currentCmd);
    
    // Anterior
    const prevIndex = (currentIndex - 1 + categoryCmds.length) % categoryCmds.length;
    const prevCmd = categoryCmds[prevIndex];
    
    // Siguiente
    const nextIndex = (currentIndex + 1) % categoryCmds.length;
    const nextCmd = categoryCmds[nextIndex];

    const prevButton = new ButtonBuilder()
        .setCustomId(`help_prev_${prevCmd}`)
        .setLabel(`Anterior: s.${prevCmd}`)
        .setEmoji("◀️")
        .setStyle(ButtonStyle.Primary);

    const nextButton = new ButtonBuilder()
        .setCustomId(`help_next_${nextCmd}`)
        .setLabel(`Siguiente: s.${nextCmd}`)
        .setEmoji("▶️")
        .setStyle(ButtonStyle.Primary);

    return new ActionRowBuilder().addComponents(prevButton, nextButton);
}

module.exports = {
    doHelpListEmbed,
    doHelpCommandEmbed,
    buildHelpNavigationRow
};
