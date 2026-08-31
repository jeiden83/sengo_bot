const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getEmbedColor } = require("./osuViewHelpers.js");
const { t } = require("../utils/i18n.js");

/**
 * Genera el embed del listado general de ayuda.
 */
function doHelpListEmbed(message, fields, description, locale = 'es') {
    const embedColor = getEmbedColor(message);
    const icon_url = message.author.displayAvatarURL({ dynamic: true, size: 512 });

    const embed = new EmbedBuilder()
        .setAuthor({
            name: t(locale, 'help.menu_title'),
            iconURL: icon_url
        })
        .setDescription(description)
        .setColor(embedColor)
        .setFooter({
            text: t(locale, 'help.footer'),
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
function doHelpCommandEmbed(message, mainName, queryName, helpData, locale = 'es', prefix = 's.') {
    const embedColor = getEmbedColor(message);
    const icon_url = message.author.displayAvatarURL({ dynamic: true, size: 512 });

    const aliasInfo = mainName !== queryName 
        ? t(locale, 'help.alias_info', { prefix, queryName }) 
        : '';
    const title = t(locale, 'help.command_title', { prefix, mainName, aliasInfo });

    const embed = new EmbedBuilder()
        .setAuthor({
            name: title,
            iconURL: icon_url
        })
        .setDescription(`*${helpData.headerText}*`)
        .setColor(embedColor)
        .setFooter({
            text: t(locale, 'help.footer'),
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    if (helpData.fields && helpData.fields.length > 0) {
        const safeFields = helpData.fields.map(f => {
            let safeValue = f.value || "";
            if (safeValue.length > 1024) {
                safeValue = safeValue.slice(0, 1021) + "...";
            }
            let safeName = f.name || "";
            if (safeName.length > 256) {
                safeName = safeName.slice(0, 253) + "...";
            }
            return {
                name: safeName,
                value: safeValue,
                inline: !!f.inline
            };
        });
        embed.addFields(safeFields);
    }

    return embed;
}

/**
 * Crea la fila de botones para navegar entre los comandos de una misma categoría.
 */
function buildHelpNavigationRow(currentCmd, categoryCmds, locale = 'es', prefix = 's.') {
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
        .setLabel(t(locale, 'help.buttons.prev', { prefix, cmd: prevCmd }))
        .setEmoji("◀️")
        .setStyle(ButtonStyle.Primary);

    const nextButton = new ButtonBuilder()
        .setCustomId(`help_next_${nextCmd}`)
        .setLabel(t(locale, 'help.buttons.next', { prefix, cmd: nextCmd }))
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

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(embedColor)
        .setThumbnail("https://jeiden.s-ul.eu/3ssHl9Gd")
        .setFooter({
            text: t(locale, 'about.footer', { page: pageIndex + 1, total: 7 }),
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();

    if (pageIndex === 0) {
        embed.addFields({
            name: t(locale, 'about.creator_title'),
            value: t(locale, 'about.creator_value'),
            inline: false
        });
    }

    return embed;
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
            .setLabel(t(locale, 'about.buttons.snipes'))
            .setEmoji("🎯")
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
            .setStyle(currentPageIndex === 3 ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("about_page_4")
            .setLabel(t(locale, 'about.buttons.gap'))
            .setEmoji("👥")
            .setStyle(currentPageIndex === 4 ? ButtonStyle.Success : ButtonStyle.Secondary),
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

/**
 * Genera el embed de ayuda para .card con paginación interactiva por botones.
 */
function doCardHelpEmbed(message, pageIndex = 0, locale = 'es', prefix = 's.') {
    const isEs = locale === 'es';
    const roleColor = message.member?.roles?.highest?.color || '#ff66aa';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ff66aa';

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setThumbnail("https://jeiden.s-ul.eu/3ssHl9Gd")
        .setFooter({
            text: isEs ? `Página ${pageIndex + 1}/4 • Sengo Card Studio • .help card` : `Page ${pageIndex + 1}/4 • Sengo Card Studio • .help card`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();

    if (pageIndex === 0) {
        embed.setTitle(isEs ? "ℹ️ Guía del Comando .card (Perfil Visual)" : "ℹ️ .card Command Guide (Visual Profile)");
        embed.setDescription(isEs
            ? "Genera una tarjeta visual de perfil de osu! con estadísticas locales del ecosistema Sengo y habilidades calculadas."
            : "Generates a visual osu! profile card with local Sengo ecosystem stats and calculated skills."
        );
        embed.addFields([
            {
                name: isEs ? "📋 Uso del Comando" : "📋 Command Usage",
                value: `\`\`\`\n${prefix}card\n  ▸ [usuario] : ${isEs ? 'Especifica el jugador a consultar' : 'Specify player to check'}\n  ▸ -embed    : ${isEs ? 'Envía la tarjeta en un embed' : 'Send card inside an embed'}\n  ▸ -refresh  : ${isEs ? 'Fuerza recarga ignorando caché de 1h' : 'Force refresh ignoring 1h cache'}\n\`\`\``,
                inline: false
            },
            {
                name: isEs ? "🏷️ Alias Disponibles" : "🏷️ Available Aliases",
                value: `\`${prefix}tarjeta\`, \`${prefix}tarjetadeperfil\`, \`${prefix}profilecard\`, \`${prefix}idcard\``,
                inline: false
            },
            {
                name: isEs ? "✨ Títulos Dinámicos" : "✨ Dynamic Titles",
                value: isEs
                    ? "La tarjeta calcula automáticamente un título de 2 líneas (`[Prefijo] [Descriptor]` / `[Sufijo]`).\n👉 **Usa los botones de abajo para navegar por las tablas de títulos.**"
                    : "The card calculates a 2-line title (`[Prefix] [Descriptor]` / `[Suffix]`).\n👉 **Use the buttons below to browse the title tables.**",
                inline: false
            }
        ]);
    } else if (pageIndex === 1) {
        embed.setTitle(isEs ? "🏆 Títulos Dinámicos: Prefijos de Habilidad (Línea 1)" : "🏆 Dynamic Titles: Skill Prefixes (Line 1)");
        embed.setDescription(isEs
            ? "El **prefijo** indica el nivel de maestría general del jugador, calculado a partir de su **PP total** o el valor más alto en sus 4 barras de skills (`ACC`, `AIM`, `SPEED`, `READING`):"
            : "The **prefix** indicates overall skill tier, calculated from **total PP** or the highest skill bar (`ACC`, `AIM`, `SPEED`, `READING`):"
        );
        embed.addFields([
            { name: isEs ? "👑 Legendario (Legendary)" : "👑 Legendary", value: "`> 16.000 pp` o Skill ≥ 80", inline: true },
            { name: isEs ? "🎖️ Experto (Expert)" : "🎖️ Expert", value: "`> 11.000 pp` o Skill ≥ 68", inline: true },
            { name: isEs ? "⚔️ Avanzado (Advanced)" : "⚔️ Advanced", value: "`> 6.500 pp` o Skill ≥ 50", inline: true },
            { name: isEs ? "🛡️ Veterano (Seasoned)" : "🛡️ Seasoned", value: "`> 3.500 pp` o Skill ≥ 38", inline: true },
            { name: isEs ? "🏹 Intermedio (Intermediate)" : "🏹 Intermediate", value: "`> 1.500 pp` o Skill ≥ 26", inline: true },
            { name: isEs ? "🎯 Competente (Competent)" : "🎯 Competent", value: "`> 500 pp`", inline: true },
            { name: isEs ? "🌱 Novato (Novice)" : "🌱 Novice", value: isEs ? "`< 500 pp` (Por defecto)" : "`< 500 pp` (Default)", inline: false }
        ]);
    } else if (pageIndex === 2) {
        embed.setTitle(isEs ? "⚡ Títulos Dinámicos: Descriptores de Mods (Línea 1)" : "⚡ Dynamic Titles: Mod Descriptors (Line 1)");
        embed.setDescription(isEs
            ? "El **descriptor** refleja la afinidad o estilo de mods predominante según sus 100 mejores puntuaciones:"
            : "The **descriptor** reflects mod affinity based on the player's top 100 plays:"
        );
        embed.addFields([
            { name: isEs ? "🔘 Anti-Mods (Mod-Hating)" : "🔘 Mod-Hating", value: isEs ? "≥ 55% de jugadas en NoMod (NM)" : "≥ 55% of top plays in NoMod", inline: true },
            { name: isEs ? "⏩ Veloz (Speedy)" : "⏩ Speedy", value: isEs ? "≥ 40% en DoubleTime (DT/NC)" : "≥ 40% in DoubleTime (DT/NC)", inline: true },
            { name: isEs ? "🎯 Preciso (Ant-Clicking)" : "🎯 Ant-Clicking", value: isEs ? "≥ 35% en HardRock (HR)" : "≥ 35% in HardRock (HR)", inline: true },
            { name: isEs ? "👻 Abusador de HD (HD abusing)" : "👻 HD abusing", value: isEs ? "≥ 45% en Hidden (HD)" : "≥ 45% in Hidden (HD)", inline: true },
            { name: isEs ? "🔦 Ciego (Blindsighted)" : "🔦 Blindsighted", value: isEs ? "≥ 5% en Flashlight (FL)" : "≥ 5% in Flashlight (FL)", inline: true },
            { name: isEs ? "🐢 Paciente (Patient)" : "🐢 Patient", value: isEs ? "≥ 10% en Easy (EZ)" : "≥ 10% in Easy (EZ)", inline: true },
            { name: isEs ? "💖 Amante de Mods (Mod-Loving)" : "💖 Mod-Loving", value: isEs ? "≤ 15% en NoMod (alta variedad)" : "≤ 15% in NoMod (high variety)", inline: true },
            { name: isEs ? "✨ Versátil (Versatile)" : "✨ Versatile", value: isEs ? "Distribución balanceada de mods" : "Balanced mod distribution", inline: true }
        ]);
    } else if (pageIndex === 3) {
        embed.setTitle(isEs ? "🌟 Títulos Dinámicos: Sufijos de Especialidad (Línea 2)" : "🌟 Dynamic Titles: Specialty Suffixes (Line 2)");
        embed.setDescription(isEs
            ? "El **sufijo** destaca el logro, especialidad o rasgo más sobresaliente del jugador en Sengo y osu!:"
            : "The **suffix** highlights the player's standout achievement or trait in Sengo and osu!:"
        );
        embed.addFields([
            { name: isEs ? "🏆 Némesis Nacional (National Nemesis)" : "🏆 National Nemesis", value: isEs ? "≥ 500 puestos #1 Nacionales en Sengo" : "≥ 500 #1 National ranks in Sengo", inline: false },
            { name: isEs ? "🎯 Amenaza de Snipes (Snipe Menace)" : "🎯 Snipe Menace", value: isEs ? "≥ 200 puestos #1 Nacionales en Sengo" : "≥ 200 #1 National ranks in Sengo", inline: false },
            { name: isEs ? "🔨 Creador de Beatmaps (Beatmap Crafter)" : "🔨 Beatmap Crafter", value: isEs ? "Posee al menos 1 mapa rankeado en osu!" : "Has at least 1 ranked beatmap in osu!", inline: false },
            { name: isEs ? "📖 Demonio de Lectura (Sightread Demon)" : "📖 Sightread Demon", value: isEs ? "Lectura (Reading) supera a Aim y Speed" : "Reading skill exceeds Aim & Speed", inline: true },
            { name: isEs ? "🕹️ Cazador de Círculos (Whack-A-Mole)" : "🕹️ Whack-A-Mole", value: isEs ? "Puntería (Aim) es su mayor habilidad" : "Aim is the highest skill", inline: true },
            { name: isEs ? "⚡ Mecanógrafo Veloz (speedtypist)" : "⚡ speedtypist", value: isEs ? "Velocidad (Speed) es su mayor habilidad" : "Speed is the highest skill", inline: true },
            { name: isEs ? "🎵 Ritmo Encarnado (Rhythm-Incarnate)" : "🎵 Rhythm-Incarnate", value: isEs ? "Precisión (ACC) es su mayor habilidad" : "Accuracy is the highest skill", inline: true },
            { name: isEs ? "🌐 Todoterreno (All-Rounder)" : "🌐 All-Rounder", value: isEs ? "Estadísticas balanceadas (Por defecto)" : "Balanced statistics (Default)", inline: true }
        ]);
    }

    return embed;
}

/**
 * Fila de botones para navegar entre las páginas de ayuda de .card
 */
function buildCardHelpNavigationRow(currentPageIndex = 0, locale = 'es') {
    const isEs = locale === 'es';
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("help_cardpage_0")
            .setLabel(isEs ? "Información" : "Info")
            .setEmoji("ℹ️")
            .setStyle(currentPageIndex === 0 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("help_cardpage_1")
            .setLabel(isEs ? "Prefijos" : "Prefixes")
            .setEmoji("🏆")
            .setStyle(currentPageIndex === 1 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("help_cardpage_2")
            .setLabel(isEs ? "Mods" : "Mods")
            .setEmoji("⚡")
            .setStyle(currentPageIndex === 2 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("help_cardpage_3")
            .setLabel(isEs ? "Especialidad" : "Specialty")
            .setEmoji("🌟")
            .setStyle(currentPageIndex === 3 ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
}

module.exports = {
    doHelpListEmbed,
    doHelpCommandEmbed,
    buildHelpNavigationRow,
    doAboutEmbed,
    buildAboutNavigationRows,
    doCardHelpEmbed,
    buildCardHelpNavigationRow
};
