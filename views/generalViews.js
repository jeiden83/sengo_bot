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
            text: isEs ? `Página ${pageIndex + 1}/5 • Sengo Card Studio • ${prefix}help card` : `Page ${pageIndex + 1}/5 • Sengo Card Studio • ${prefix}help card`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();

    if (pageIndex === 0) {
        embed.setTitle(isEs ? "ℹ️ Guía del Comando .card (Perfil Visual)" : "ℹ️ .card Command Guide (Visual Profile)");
        embed.setDescription(isEs
            ? "Genera una tarjeta visual de perfil de osu! con estadísticas locales del ecosistema Sengo, habilidades calculadas, personalización modular de lienzo y enlaces para userpages."
            : "Generates a visual osu! profile card with local Sengo ecosystem stats, calculated skills, modular canvas customization, and osu! userpage support."
        );
        embed.addFields([
            {
                name: isEs ? "📋 Uso del Comando" : "📋 Command Usage",
                value: `\`\`\`\n${prefix}card [usuario] [flags...]\n  ▸ [usuario]   : ${isEs ? 'Jugador a consultar (o tu cuenta vinculada)' : 'Player to check (or linked account)'}\n  ▸ -userpage   : ${isEs ? 'Envía por DM el BBCode seguro para tu perfil de osu!' : 'Sends secure BBCode to your DM for your osu! profile'}\n  ▸ -preset     : ${isEs ? 'Preset de diseño (-compact, -linea, -panoramica, etc.)' : 'Design preset (-compact, -single, -allline, etc.)'}\n  ▸ -modo       : ${isEs ? 'Modo de juego (-std, -taiko, -catch, -mania)' : 'Game mode (-std, -taiko, -catch, -mania)'}\n  ▸ -embed      : ${isEs ? 'Envía la tarjeta en un embed' : 'Send card inside an embed'}\n  ▸ -refresh    : ${isEs ? 'Fuerza recarga ignorando caché de 1h' : 'Force refresh ignoring 1h cache'}\n\`\`\``,
                inline: false
            },
            {
                name: isEs ? "🏷️ Alias Disponibles" : "🏷️ Available Aliases",
                value: `\`${prefix}tarjeta\`, \`${prefix}tarjetadeperfil\`, \`${prefix}profilecard\`, \`${prefix}idcard\``,
                inline: false
            },
            {
                name: isEs ? "📐 Presets & Userpage" : "📐 Presets & Userpage",
                value: isEs
                    ? "Puedes elegir entre **7 presets de disposición de tarjetas** y generar un enlace dinámico para tu perfil oficial de osu!.\n👉 **Usa el botón `Presets` para ver todos los formatos y ejemplos.**"
                    : "Choose between **7 card layout presets** and generate a dynamic link for your official osu! userpage.\n👉 **Use the `Presets` button to view all layouts and examples.**",
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
        embed.setTitle(isEs ? "📐 Presets de Diseño y Userpage de osu!" : "📐 Layout Presets & osu! Userpage");
        embed.setDescription(isEs
            ? "Personaliza el tamaño del lienzo y la disposición de las tarjetas modulares, o genera tu código **BBCode** dinámico para tu perfil de osu!:"
            : "Customize canvas dimensions and modular card layouts, or generate dynamic **BBCode** for your osu! profile:"
        );
        embed.addFields([
            {
                name: isEs ? "🖼️ Presets de Diseño Disponibles" : "🖼️ Available Design Presets",
                value: isEs
                    ? [
                        "• **`standard`** (`-full`): Formato original completo de 6 tarjetas (1920×1080).",
                        "• **`compact`** (`-compacto`): Formato compacto (solo avatar y skills, sin nivel ni score).",
                        "• **`linea`** (`-single`, `-1linea`): Fila única de 3 tarjetas (Avatar, Nombre y Skills).",
                        "• **`lineaplay`** (`-singleplay`): Fila única de 4 tarjetas (+ Pinned Score).",
                        "• **`panoramica`** (`-allline`): Fila panorámica de 5 tarjetas en una sola línea.",
                        "• **`ultra`**: Formato ultrawide panorámico alargado.",
                        "• **`mini`** (`-movil`): Tarjeta angosta y estilizada para móviles."
                    ].join("\n")
                    : [
                        "• **`standard`** (`-full`): Original full 6-card canvas (1920×1080).",
                        "• **`compact`**: Compact layout (avatar & skills only, no level or total score).",
                        "• **`single_row`** (`-single`, `-linea`): Single row of 3 cards (Avatar, Name, Skills).",
                        "• **`single_row_play`** (`-singleplay`): Single row of 4 cards (+ Pinned Score).",
                        "• **`single_row_all`** (`-allline`, `-panoramica`): Panoramic row of 5 cards.",
                        "• **`ultra`**: Extended ultrawide format.",
                        "• **`mini_card`** (`-mini`, `-movil`): Narrow vertical card optimized for mobile."
                    ].join("\n"),
                inline: false
            },
            {
                name: isEs ? "🔒 Flag -userpage (BBCode Privado)" : "🔒 -userpage Flag (Private BBCode)",
                value: isEs
                    ? `Usa \`${prefix}card -userpage\` (o con presets como \`${prefix}card -userpage -linea\`) para que el bot te envíe a tus **Mensajes Directos (DM)** el código BBCode seguro listo para pegar en tu perfil de osu!. La imagen se actualizará automáticamente cada vez que alguien visite tu perfil.`
                    : `Use \`${prefix}card -userpage\` (or with presets like \`${prefix}card -userpage -linea\`) to receive a secure BBCode in your **Direct Messages (DM)** ready for your osu! profile. It updates automatically whenever someone visits your profile.`,
                inline: false
            },
            {
                name: isEs ? "💡 Ejemplos Rápidos" : "💡 Quick Examples",
                value: [
                    `\`${prefix}card -userpage\``,
                    `\`${prefix}card -userpage -linea\``,
                    `\`${prefix}card -userpage -compact -mania\``,
                    `\`${prefix}card WhiteCat -panoramica\``
                ].join("\n"),
                inline: false
            }
        ]);
    } else if (pageIndex === 2) {
        embed.setTitle(isEs ? "🏆 Títulos Dinámicos: Prefijos de Habilidad (Línea 1)" : "🏆 Dynamic Titles: Skill Prefixes (Line 1)");
        embed.setDescription(isEs
            ? "El **prefijo** indica el nivel de maestría general del jugador, calculado a partir de su **PP total**:"
            : "The **prefix** indicates overall skill tier, calculated from **total PP**:"
        );
        embed.addFields([
            { name: isEs ? "👑 Legendario (Legendary)" : "👑 Legendary", value: "`> 16.000 pp`", inline: true },
            { name: isEs ? "🎖️ Experto (Expert)" : "🎖️ Expert", value: "`> 11.000 pp`", inline: true },
            { name: isEs ? "⚔️ Avanzado (Advanced)" : "⚔️ Advanced", value: "`> 6.500 pp`", inline: true },
            { name: isEs ? "🛡️ Veterano (Seasoned)" : "🛡️ Seasoned", value: "`> 3.500 pp`", inline: true },
            { name: isEs ? "🏹 Intermedio (Intermediate)" : "🏹 Intermediate", value: "`> 1.500 pp`", inline: true },
            { name: isEs ? "🎯 Competente (Competent)" : "🎯 Competent", value: "`> 500 pp`", inline: true },
            { name: isEs ? "🌱 Novato (Novice)" : "🌱 Novice", value: isEs ? "`< 500 pp` (Por defecto)" : "`< 500 pp` (Default)", inline: false }
        ]);
    } else if (pageIndex === 3) {
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
    } else if (pageIndex === 4) {
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
            .setLabel(isEs ? "Presets" : "Presets")
            .setEmoji("📐")
            .setStyle(currentPageIndex === 1 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("help_cardpage_2")
            .setLabel(isEs ? "Prefijos" : "Prefixes")
            .setEmoji("🏆")
            .setStyle(currentPageIndex === 2 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("help_cardpage_3")
            .setLabel(isEs ? "Mods" : "Mods")
            .setEmoji("⚡")
            .setStyle(currentPageIndex === 3 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("help_cardpage_4")
            .setLabel(isEs ? "Especialidad" : "Specialty")
            .setEmoji("🌟")
            .setStyle(currentPageIndex === 4 ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
}

/**
 * Genera el embed del comando s.invite
 */
function doInviteEmbed(message, locale = 'es', inviteUrl) {
    const embedColor = getEmbedColor(message);
    const botIcon = message.client?.user?.displayAvatarURL({ dynamic: true, size: 512 }) || "https://jeiden.s-ul.eu/3ssHl9Gd";

    return new EmbedBuilder()
        .setAuthor({
            name: t(locale, 'invite.title'),
            iconURL: botIcon
        })
        .setDescription(t(locale, 'invite.description', { url: inviteUrl }))
        .setColor(embedColor)
        .setThumbnail(botIcon)
        .setFooter({
            text: "Sengo • s.invite",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();
}

/**
 * Fila de botones para el enlace de invitación
 */
function buildInviteRow(locale = 'es', inviteUrl) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel(t(locale, 'invite.button_label'))
            .setStyle(ButtonStyle.Link)
            .setURL(inviteUrl)
            .setEmoji("🔗")
    );
}

module.exports = {
    doHelpListEmbed,
    doHelpCommandEmbed,
    buildHelpNavigationRow,
    doAboutEmbed,
    buildAboutNavigationRows,
    doCardHelpEmbed,
    buildCardHelpNavigationRow,
    doInviteEmbed,
    buildInviteRow
};
