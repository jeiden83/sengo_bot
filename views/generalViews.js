const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getEmbedColor } = require("./osuViewHelpers.js");
const { t } = require("../utils/i18n.js");

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

    const title = `Ayuda de Comando: .${mainName}${mainName !== queryName ? ` (Alias: .${queryName})` : ''}`;

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
        .setLabel(`Anterior: .${prevCmd}`)
        .setEmoji("◀️")
        .setStyle(ButtonStyle.Primary);

    const nextButton = new ButtonBuilder()
        .setCustomId(`help_next_${nextCmd}`)
        .setLabel(`Siguiente: .${nextCmd}`)
        .setEmoji("▶️")
        .setStyle(ButtonStyle.Primary);

    return new ActionRowBuilder().addComponents(prevButton, nextButton);
}

/**
 * Genera el embed de Acerca de Sengo según el índice de página e idioma.
 * @param {any} message El mensaje de Discord original
 * @param {number} pageIndex Índice de página (0 a 6)
 * @param {string} locale Código de idioma ('es', 'en')
 * @param {string} prefix Prefijo del bot ('s.', 'sd.')
 * @returns {EmbedBuilder} EmbedBuilder configurado
 */
function doAboutEmbed(message, pageIndex = 0, locale = 'es', prefix = 's.') {
    const roleColor = message.member?.roles?.highest?.color || '#ff66aa';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ff66aa';

    const title = t(locale, `about.pages.${pageIndex}.title`);
    const descriptionTemplate = t(locale, `about.pages.${pageIndex}.description`);
    const description = descriptionTemplate.replace(/{prefix}/g, prefix);

    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(embedColor)
        .setThumbnail("https://jeiden.s-ul.eu/3ssHl9Gd")
        .setFooter({
            text: t(locale, 'about.footer', { page: pageIndex + 1, total: 7 }),
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();
}

/**
 * Crea las filas de botones de navegación para el comando acerca/about con etiquetas localizadas.
 * @param {number} currentPageIndex Índice de la página activa
 * @param {string} locale Idioma del contexto
 * @returns {ActionRowBuilder[]} Filas de botones
 */
function buildAboutNavigationRows(currentPageIndex, locale = 'es') {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("about_page_0")
            .setLabel(t(locale, 'about.buttons.home'))
            .setEmoji("🏠")
            .setStyle(currentPageIndex === 0 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("about_page_1")
            .setLabel(t(locale, 'about.buttons.oauth'))
            .setEmoji("🔒")
            .setStyle(currentPageIndex === 1 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("about_page_2")
            .setLabel(t(locale, 'about.buttons.cache'))
            .setEmoji("⚡")
            .setStyle(currentPageIndex === 2 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("about_page_3")
            .setLabel(t(locale, 'about.buttons.country_lb'))
            .setEmoji("🗺️")
            .setStyle(currentPageIndex === 3 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("about_page_4")
            .setLabel(t(locale, 'about.buttons.gap'))
            .setEmoji("👥")
            .setStyle(currentPageIndex === 4 ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("about_page_5")
            .setLabel(t(locale, 'about.buttons.recommender'))
            .setEmoji("🎯")
            .setStyle(currentPageIndex === 5 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("about_page_6")
            .setLabel(t(locale, 'about.buttons.other_commands'))
            .setEmoji("🛠️")
            .setStyle(currentPageIndex === 6 ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    return [row1, row2];
}

module.exports = {
    doHelpListEmbed,
    doHelpCommandEmbed,
    buildHelpNavigationRow,
    doAboutEmbed,
    buildAboutNavigationRows
};
