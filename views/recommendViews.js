const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getEmbedColor } = require("./osuViewHelpers.js");
const emoji_mods = require("../src/emoji_mods.json");
const { t } = require("../utils/i18n.js");


function formatRecommendMods(modsStr) {
    if (!modsStr || modsStr === "NoMod") {
        return `<:NM:${emoji_mods["NM"] || '123'}> \`NM\``;
    }
    const modsList = modsStr.match(/.{1,2}/g) || [];
    const emojiStr = modsList.map(mod => {
        const id = emoji_mods[mod];
        return id ? `<:${mod}:${id}>` : mod;
    }).join("");
    return `${emojiStr} \`${modsStr}\``;
}

/**
 * Renderiza el embed para las recomendaciones de mapas (s.recommend / s.recomendar)
 * @param {object} message Mensaje de Discord
 * @param {object} profile Perfil del usuario
 * @param {Array} recommendations Lista de mapas recomendados
 * @param {object} params Parámetros de la búsqueda (minPP, maxPP, mods, showPlayed, style)
 * @returns {EmbedBuilder} EmbedBuilder configurado para Discord
 */
function doOsuRecommendEmbed(message, profile, recommendations, params, locale = 'es') {
    const embedColor = getEmbedColor(message);
    const { minPP, maxPP, mods, showPlayed, hasSupporter, style, customUserTag } = params;
    const redirectBase = process.env.RENDER_EXTERNAL_URL || 'https://stoppable-passcode-riot.ngrok-free.dev';
    const numLocale = locale === 'es' ? 'es-ES' : 'en-US';

    let description = "";

    const styleLabels = {
        'standard': t(locale, 'recommend.label_style_standard'),
        'aim': t(locale, 'recommend.label_style_aim'),
        'speed': t(locale, 'recommend.label_style_speed'),
        'length': t(locale, 'recommend.label_style_length'),
        'rarezas': t(locale, 'recommend.label_style_rarezas'),
        'tags': t(locale, 'recommend.label_style_tags')
    };
    let currentStyleLabel = styleLabels[style] || t(locale, 'recommend.label_style_standard');
    if (customUserTag) {
        currentStyleLabel = t(locale, 'recommend.label_style_custom_tag', { tag: customUserTag });
    }

    if (recommendations.length === 0) {
        description = t(locale, 'recommend.embed_no_recs', {
            min: minPP.toFixed(0),
            max: maxPP.toFixed(0)
        });
    } else {
        recommendations.forEach((c, index) => {
            let map_link = `[${c.artist} - ${c.title} [${c.version}]](https://osu.ppy.sh/b/${c.beatmapId})`;
            if (hasSupporter) {
                map_link += ` [ [📥 osu!direct](${redirectBase}/osu/${c.beatmapsetId}) ]`;
            }
            description += `**${index + 1}.** ${map_link}\n`;
            
            const affinityStr = locale === 'es' ? `${c.matchScore}% de Afinidad` : `${c.matchScore}% Affinity`;
            
            const randFlags = [];
            if (c.isRandomMod) randFlags.push(locale === 'es' ? 'Mod alternativo' : 'Alt Mod');
            if (c.isRandomAffinity) randFlags.push(locale === 'es' ? 'Afinidad variable' : 'Alt Affinity');
            if (c.isRandomTag) randFlags.push(locale === 'es' ? 'Tag aleatorio' : 'Alt Tag');
            if (c.isPPExpanded) randFlags.push(locale === 'es' ? 'Rango PP ampliado' : 'Expanded PP Range');
            
            const randStr = randFlags.length > 0 ? ` 🎲 *(${randFlags.join(", ")})*` : "";
            
            description += `   ▸ ⭐ **${c.stars.toFixed(2)}★** | Mod sugerido: ${formatRecommendMods(c.mods)} | **${affinityStr}**${randStr}\n`;
            if (c.pushPP && c.pushAcc) {
                const pushPct = (c.pushAcc * 100).toFixed(1);
                description += `   ▸ **${c.maxPP}pp** (100% FC) | **${c.pp99}pp** (99% FC) | 🎯 **${c.pushPP}pp** (~${pushPct}% Push)\n`;
            } else {
                description += `   ▸ **${c.maxPP}pp** (100% FC) | **${c.pp99}pp** (99% FC)\n`;
            }

            const speedMultiplier = (c.mods.includes("DT") || c.mods.includes("NC")) ? 1.5 : (c.mods.includes("HT") ? 0.75 : 1.0);
            const adjustedLength = Math.floor(c.length / speedMultiplier);
            const minutes = Math.floor(adjustedLength / 60);
            const seconds = adjustedLength % 60;
            const durationStr = `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
            const displayBpm = c.bpm ? Math.round(c.bpm * speedMultiplier) : 0;
            description += `   ▸ Stats: \`${durationStr}\` | AR: \`${c.ar}\` | OD: \`${c.od}\` | BPM: \`${displayBpm}\` | Pop: \`${(c.popularity || 0).toLocaleString(numLocale)}\`\n`;
            if (c.matchReasons && c.matchReasons.length > 0) {
                const reasonsPrefix = locale === 'es' ? 'Razones' : 'Reasons';
                description += `   ▸ *${reasonsPrefix}: ${c.matchReasons.join(" • ")}*\n`;
            }
            description += `\n`;
        });
    }

    const modeNameMap = {
        'osu': 'osu!',
        'taiko': 'osu!taiko',
        'fruits': 'osu!catch',
        'catch': 'osu!catch',
        'ctb': 'osu!catch',
        'mania': 'osu!mania'
    };
    const currentMode = params.gamemode || 'osu';
    const modeBadge = currentMode !== 'osu' ? ` [${modeNameMap[currentMode] || currentMode}]` : '';

    const embed = new EmbedBuilder()
        .setAuthor({
            name: t(locale, 'recommend.embed_author', { username: profile.username }) + modeBadge,
            url: `https://osu.ppy.sh/users/${profile.id}`,
            iconURL: profile.avatar_url
        })
        .setTitle(t(locale, 'recommend.embed_title', { pp: ((minPP + maxPP) / 2).toFixed(0) }))
        .setDescription(description)
        .addFields(
            {
                name: t(locale, 'recommend.embed_field_filters'),
                value: t(locale, 'recommend.embed_field_filters_value', {
                    min: minPP.toFixed(0),
                    max: maxPP.toFixed(0),
                    mods: mods || t(locale, 'recommend.label_mods_any'),
                    played: showPlayed ? t(locale, 'recommend.label_yes') : t(locale, 'recommend.label_no'),
                    style: currentStyleLabel
                }) + (currentMode !== 'osu' ? `\n▸ **Modo:** \`${modeNameMap[currentMode] || currentMode}\`` : '')
            }
        )
        .setColor(embedColor)
        .setFooter({
            text: t(locale, 'recommend.embed_footer'),
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();

    return embed;
}

/**
 * Construye las filas de botones interactivos para la recomendación.
 * @param {object} params Parámetros actuales (minPP, maxPP, mods, showPlayed, style)
 * @param {string} suggestedMod El mod alternativo sugerido según su perfil (ej: "HDDT", "NM")
 * @param {boolean} hasRecs Si hay recomendaciones disponibles
 * @param {Array} recommendations Lista de mapas recomendados
 * @param {boolean} hasSupporter Si el usuario que ejecuta el comando tiene supporter activo
 * @param {string} locale Código de idioma local
 * @returns {Array} Array de ActionRowBuilder
 */
function buildRecommendButtons(params, suggestedMod, hasRecs, recommendations = [], hasSupporter = false, locale = 'es') {
    const { showPlayed, style } = params;
    const rows = [];

    // Fila 1: Controles Básicos de Rango y Estado
    const btnRefresh = new ButtonBuilder()
        .setCustomId("rec_refresh")
        .setLabel(t(locale, 'recommend.btn_refresh'))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasRecs);

    const btnMorePP = new ButtonBuilder()
        .setCustomId("rec_more_pp")
        .setLabel(t(locale, 'recommend.btn_more_pp'))
        .setStyle(ButtonStyle.Success);

    const btnLessPP = new ButtonBuilder()
        .setCustomId("rec_less_pp")
        .setLabel(t(locale, 'recommend.btn_less_pp'))
        .setStyle(ButtonStyle.Success);

    const toggleLabel = t(locale, 'recommend.btn_toggle_mods', { mod: suggestedMod || "Mods" });
    const btnToggleMods = new ButtonBuilder()
        .setCustomId("rec_toggle_mods")
        .setLabel(toggleLabel)
        .setStyle(ButtonStyle.Primary);

    const btnTogglePlayed = new ButtonBuilder()
        .setCustomId("rec_toggle_played")
        .setLabel(showPlayed ? t(locale, 'recommend.btn_exclude_played') : t(locale, 'recommend.btn_include_played'))
        .setStyle(showPlayed ? ButtonStyle.Danger : ButtonStyle.Primary);

    const controlRow = new ActionRowBuilder().addComponents(
        btnRefresh,
        btnMorePP,
        btnLessPP,
        btnToggleMods,
        btnTogglePlayed
    );
    rows.push(controlRow);

    // Fila 2: Estilos de Juego y Especialidad (Filtros principales)
    const btnAim = new ButtonBuilder()
        .setCustomId("rec_style_aim")
        .setLabel(t(locale, 'recommend.btn_aim'))
        .setStyle(style === 'aim' ? ButtonStyle.Success : ButtonStyle.Secondary);

    const btnSpeed = new ButtonBuilder()
        .setCustomId("rec_style_speed")
        .setLabel(t(locale, 'recommend.btn_speed'))
        .setStyle(style === 'speed' ? ButtonStyle.Success : ButtonStyle.Secondary);

    const btnLength = new ButtonBuilder()
        .setCustomId("rec_style_length")
        .setLabel(t(locale, 'recommend.btn_length'))
        .setStyle(style === 'length' ? ButtonStyle.Success : ButtonStyle.Secondary);

    const btnRarezas = new ButtonBuilder()
        .setCustomId("rec_style_rarezas")
        .setLabel(t(locale, 'recommend.btn_loved'))
        .setStyle(style === 'rarezas' ? ButtonStyle.Success : ButtonStyle.Secondary);

    const btnTags = new ButtonBuilder()
        .setCustomId("rec_style_tags")
        .setLabel(t(locale, 'recommend.btn_tags'))
        .setStyle(style === 'tags' ? ButtonStyle.Success : ButtonStyle.Secondary);

    const styleRow = new ActionRowBuilder().addComponents(
        btnAim,
        btnSpeed,
        btnLength,
        btnRarezas,
        btnTags
    );
    rows.push(styleRow);

    // Fila 3: Acciones especiales (Reset)
    const btnReset = new ButtonBuilder()
        .setCustomId("rec_style_reset")
        .setLabel(t(locale, 'recommend.btn_reset'))
        .setStyle(ButtonStyle.Danger)
        .setDisabled(style === 'standard' || !style);

    const resetRow = new ActionRowBuilder().addComponents(btnReset);
    rows.push(resetRow);

    return rows;
}


/**
 * Genera el embed con el catálogo de user tags comunitarios disponibles para recomendaciones.
 */
function doRecommendUserTagsEmbed(message, categories, categoryEmojis, locale = 'es') {
    const embed = new EmbedBuilder()
        .setTitle(t(locale, 'recommend.usertags_title'))
        .setColor(getEmbedColor(message))
        .setDescription(t(locale, 'recommend.usertags_desc'))
        .setFooter({
            text: "Sengo",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();

    for (const [cat, items] of Object.entries(categories)) {
        const displayName = categoryEmojis[cat] ? categoryEmojis[cat].toUpperCase() : cat.toUpperCase();
        items.sort((a, b) => b.count - a.count);
        const itemsStr = items.map(item => `\`${item.full}\` (${item.count.toLocaleString()})`).join(" • ");
        const truncatedStr = itemsStr.length > 1020 ? itemsStr.substring(0, 1017) + "..." : itemsStr;
        embed.addFields({ name: displayName, value: truncatedStr || t(locale, 'recommend.usertags_none') });
    }
    return embed;
}

/**
 * Genera el embed de carga temporal durante la interacción con botones de recomendación.
 * @param {EmbedBuilder} embed Embed previo base
 * @param {string} locale Idioma del usuario ('es' o 'en')
 * @returns {EmbedBuilder} Embed de estado de carga
 */
function doRecommendLoadingEmbed(embed, locale = 'es') {
    return EmbedBuilder.from(embed)
        .setDescription(t(locale, 'recommend.msg_searching_custom'));
}

module.exports = {
    doOsuRecommendEmbed,
    doRecommendUserTagsEmbed,
    doRecommendLoadingEmbed,
    buildRecommendButtonsRow: buildRecommendButtons
};

