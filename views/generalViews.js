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
 * Genera el embed de Acerca de Sengo según el índice de página.
 */
function doAboutEmbed(message, pageIndex = 0) {
    const roleColor = message.member?.roles?.highest?.color || '#ff66aa';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ff66aa';

    const pages = [
        // Página 0: Inicio
        {
            title: "🌸 Acerca de Sengo",
            description: "Sengo es un bot de Discord de alto rendimiento especializado para la comunidad de **osu!**, diseñado con un enfoque centrado en la velocidad extrema, la automatización y la integración social.\n\nA continuación se presentan las características avanzadas que lo hacen sobresalir frente a otras alternativas tradicionales. Usa los botones de abajo para explorar cada sección con detalle y ejemplos de uso:"
        },
        // Página 1: OAuth 2.0
        {
            title: "🔒 OAuth 2.0 Seguro",
            description: "**Vinculación Segura con OAuth 2.0**\n\nOlvídate de cambiar tu perfil o usar métodos tediosos. Con `s.link -oauth` vinculas tu cuenta en segundos de forma oficial.\n\n**Detalle y Uso:**\n• **Detección Automática**: Al autorizar mediante OAuth, Sengo detecta automáticamente tu avatar, bandera del país y tu estado de **osu! Supporter** 💖.\n• **Seguridad**: No necesitamos tu contraseña ni datos sensibles. Todo se gestiona a través de los servidores oficiales de osu!.\n• **Pool de Soporte**: Si tienes supporter, tu cuenta ayudará de forma segura a consultar rankings nacionales para todo el servidor."
        },
        // Página 2: Latencia & Caché
        {
            title: "⚡ Latencia & Caché",
            description: "**Tiempos de Respuesta Sub-Milisegundo (Caché)**\n\nSengo está optimizado para responder al instante. Cuando consultas tu jugada reciente con `.r`, el bot inicia un proceso predictivo en segundo plano.\n\n**Detalle y Uso:**\n• **Precarga Inteligente**: Precarga en caché local los datos del compare (`.c`), perfil y metadatos del mapa.\n• **Velocidad Extrema**: Al ejecutar `.c` inmediatamente después, el bot responde en **menos de 1ms**, evitando peticiones redundantes a la API de osu! y eliminando la latencia de espera."
        },
        // Página 3: Leaderboards Nacionales
        {
            title: "🗺️ Leaderboards Nacionales",
            description: "**Leaderboards Nacionales Inteligentes**\n\nConsulta quién tiene la mejor puntuación de tu país en cualquier mapa de forma rápida y sencilla.\n\n**Detalle y Uso:**\n• **Comando**: Usa `.lb -pais` para ver la tabla de clasificación nacional del mapa.\n• **Autodetección**: Si estás vinculado mediante OAuth, Sengo autodetectará tu bandera y nacionalidad sin que tengas que especificar el código de país (ej: `MX`, `ES`, `VE`, `AR`).\n• **Flexibilidad**: También puedes buscar de forma manual especificando el código (ej: `.lb -pais cl`)."
        },
        // Página 4: Brecha de Scores
        {
            title: "👥 Brecha de Scores (.gap)",
            description: "**Brecha de Puntuaciones (.gap / -friends)**\n\nCompara y analiza cómo te posicionas frente a tus amigos y conocidos del servidor en un abrir y cerrar de ojos.\n\n**Detalle y Uso:**\n• **Comando `.gap`**: Muestra la brecha y diferencia exacta de puntuación, precisión y PP de los usuarios del servidor en el mapa consultado.\n• **Filtro `-friends`**: Añade el flag `-friends` a tus comandos (como `.lb -friends`) para aislar la tabla de clasificación y competir únicamente contra tus amigos de osu!."
        },
        // Página 5: Otros Comandos
        {
            title: "🛠️ Lista de Comandos",
            description: "**Otros Comandos de Sengo**\n\nAquí tienes una guía rápida de otros comandos esenciales del bot:\n\n• **Comandos de osu!**:\n  ▸ `s.r` / `s.rs`: Muestra tu jugada reciente más reciente. Admite `-l` para listar las últimas 10 y `-b` para ordenar por PP.\n  ▸ `s.c`: Compara tu puntuación en el último beatmap del canal.\n  ▸ `s.lb`: Muestra la tabla de clasificación global del beatmap.\n  ▸ `s.osu`: Muestra tu perfil de osu! o de otro jugador (admite modo detallado).\n  ▸ `s.top`: Muestra tus mejores puntuaciones de PP.\n  ▸ `s.daily`: Muestra los detalles y clasificación del Osu! Daily Challenge actual.\n  ▸ `s.subir`: Guarda/sube una puntuación manualmente al sistema del bot.\n• **Comandos de Utilidad & Comunidad**:\n  ▸ `s.link`: Vincula tu cuenta de Discord con la de osu!.\n  ▸ `s.amigos`: Gestiona y audita tu lista de amigos de osu! dentro del bot.\n  ▸ `s.contribuidores`: Conoce al equipo de desarrolladores y colaboradores detrás de Sengo.\n  ▸ `s.sorteo`: Crea y gestiona sorteos/giveaways avanzados con filtros de rol, booster y nitro.\n• **Diversión**:\n  ▸ `s.fumo`: Comando de entretenimiento con imágenes de Fumos."
        }
    ];

    const page = pages[pageIndex] || pages[0];

    return new EmbedBuilder()
        .setTitle(page.title)
        .setDescription(page.description)
        .setColor(embedColor)
        .setThumbnail("https://jeiden.s-ul.eu/3ssHl9Gd")
        .setFooter({
            text: `Sengo • s.acerca • Página ${pageIndex + 1} de ${pages.length}`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();
}

/**
 * Crea las filas de botones de navegación para el comando acerca/about.
 */
function buildAboutNavigationRows(currentPageIndex) {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("about_page_0")
            .setLabel("Inicio")
            .setEmoji("🏠")
            .setStyle(currentPageIndex === 0 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("about_page_1")
            .setLabel("OAuth")
            .setEmoji("🔒")
            .setStyle(currentPageIndex === 1 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("about_page_2")
            .setLabel("Caché")
            .setEmoji("⚡")
            .setStyle(currentPageIndex === 2 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("about_page_3")
            .setLabel("LB País")
            .setEmoji("🗺️")
            .setStyle(currentPageIndex === 3 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("about_page_4")
            .setLabel("Gap")
            .setEmoji("👥")
            .setStyle(currentPageIndex === 4 ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("about_page_5")
            .setLabel("Otros Comandos")
            .setEmoji("🛠️")
            .setStyle(currentPageIndex === 5 ? ButtonStyle.Success : ButtonStyle.Secondary)
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
