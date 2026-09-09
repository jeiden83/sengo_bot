const { EmbedBuilder } = require("discord.js");
const { t, formatNumber, formatDecimal } = require("../utils/i18n.js");
const { getEmbedColor, getGradeEmoji } = require("./osuViewHelpers.js");

/**
 * Convierte un código de país ISO 3166-1 alpha-2 en emoji de bandera Unicode.
 * @param {string} countryCode Código de dos letras (ej: "VE", "MX")
 * @returns {string} Emoji de la bandera o globo terráqueo por defecto
 */
function getCountryFlag(countryCode) {
    if (!countryCode || typeof countryCode !== "string" || countryCode.length !== 2) {
        return "🌐";
    }
    const codePoints = countryCode
        .toUpperCase()
        .split("")
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}

/**
 * Extrae y formatea los mods relevantes en formato texto legible (ej: "+HDHR", "+DT").
 * Omite mods de sistema como "CL" para replicar la presentación limpia de osu!.
 * @param {Array|string} rawMods Mods de la jugada
 * @returns {string} Cadena formateada con prefijo "+" o vacía si no hay mods
 */
function formatModsCleanText(rawMods) {
    if (!rawMods) return "";
    const list = Array.isArray(rawMods)
        ? rawMods.map(m => (typeof m === "string" ? m : m.acronym || "")).filter(Boolean)
        : (typeof rawMods === "string" ? rawMods.match(/.{1,2}/g) || [] : []);

    const clean = list.filter(m => m.toUpperCase() !== "CL");
    return clean.length > 0 ? ` **+${clean.join("").toUpperCase()}**` : "";
}

/**
 * Genera el embed de Discord para el comando .skills / /skills
 * @param {object} message Mensaje o interacción de Discord de origen
 * @param {object} osuUser Datos de perfil del usuario de osu!
 * @param {object} skillsBreakdown Datos procesados por analyzeSkillsBreakdown
 * @param {string} locale Código de idioma ('es' o 'en')
 * @returns {EmbedBuilder} EmbedBuilder configurado
 */
function doOsuSkillsEmbed(message, osuUser, skillsBreakdown, locale = "es") {
    const embedColor = getEmbedColor(message);

    const flag = getCountryFlag(osuUser.country_code);
    const username = osuUser.username || "Jugador";
    const userUrl = `https://osu.ppy.sh/users/${osuUser.id}`;
    const avatarUrl = osuUser.avatar_url || "https://osu.ppy.sh/images/layout/avatar-guest.png";

    const stats = osuUser.statistics || {};
    const rawPP = Number(stats.pp || 0);
    const ppFormatted = formatDecimal(rawPP, locale, 2);
    const globalRank = stats.global_rank ? `#${formatNumber(stats.global_rank, locale)}` : "#-";
    const countryCode = (osuUser.country_code || "").toUpperCase();
    const countryRank = stats.country_rank ? `${countryCode}${formatNumber(stats.country_rank, locale)}` : `${countryCode}-`;

    const authorName = `${flag} ${username}: ${ppFormatted}pp (${globalRank} ${countryRank})`;

    const mode = skillsBreakdown.mode || "osu";
    const MODE_NAMES = {
        osu: "osu!",
        taiko: "osu!taiko",
        fruits: "osu!catch",
        mania: "osu!mania"
    };
    const modeDisplayName = MODE_NAMES[mode] || "osu!";

    const skillKeys = skillsBreakdown.skillKeys || ["aim", "speed", "acc", "reading"];

    // Encabezado de promedios en puntos
    const avgLines = skillKeys.map(k => {
        const val = formatDecimal(skillsBreakdown[k] ?? 0, locale, 2);
        return `**${t(locale, `skills.avg_${k}`)}:** ${val} pts`;
    });

    if (skillsBreakdown.keymodeInfo) {
        avgLines.push(t(locale, "skills.keymode_info", {
            mode: skillsBreakdown.keymodeInfo.mode,
            pct: skillsBreakdown.keymodeInfo.pct
        }));
    }

    /**
     * Construye las líneas de jugadas para una habilidad específica mostrando sus puntos
     */
    const buildSkillLines = (plays, skillKey) => {
        if (!plays || plays.length === 0) {
            return `*${t(locale, "skills.no_plays")}*`;
        }
        return plays.map(item => {
            const sc = item.score;
            const points = formatDecimal(item[skillKey] != null ? item[skillKey] : (item.points || 0), locale, 2);
            const grade = getGradeEmoji(sc.rank, sc.passed !== false);
            const songTitle = sc.beatmapset?.title || sc.beatmap?.title || "Beatmap";
            const diffName = sc.beatmap?.version || "Normal";
            const mapUrl = `https://osu.ppy.sh/b/${sc.beatmap?.id}`;
            const mods = formatModsCleanText(sc.mods);

            return `\`${points} pts\` ${grade} [${songTitle} [${diffName}]](${mapUrl})${mods}`;
        }).join("\n");
    };

    const descBlocks = [avgLines.join("\n")];
    skillKeys.forEach(k => {
        const cap = k.charAt(0).toUpperCase() + k.slice(1);
        const plays = skillsBreakdown[`top${cap}`] || [];
        descBlocks.push("");
        descBlocks.push(`**${t(locale, `skills.section_${k}`)}**`);
        descBlocks.push(buildSkillLines(plays, k));
    });

    const description = descBlocks.join("\n");

    return new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: authorName,
            iconURL: avatarUrl,
            url: userUrl
        })
        .setTitle(t(locale, "skills.embed_title", { mode: modeDisplayName }))
        .setThumbnail(avatarUrl)
        .setDescription(description)
        .setFooter({
            text: `Sengo • ${t(locale, "skills.embed_footer")}`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();
}

/**
 * Genera el embed con la tabla de clasificación de habilidades por país.
 * @param {object} params
 * @param {Array} params.players Lista de jugadores obtenidos de user_skills
 * @param {number} params.totalCount Total de jugadores en la categoría
 * @param {number} params.startIndex Índice inicial para la numeración (0-based)
 * @param {string} params.countryCode Código de dos letras del país (ej: "VE")
 * @param {string} params.gamemode Modo de juego ("osu", "taiko", etc.)
 * @param {string} params.skill Habilidad ordenada ("aim", "speed", "acc", "reading", "stamina", "pp")
 * @param {object} params.message Mensaje o interacción de Discord
 * @param {string} params.locale Idioma ('es' o 'en')
 * @returns {EmbedBuilder} EmbedBuilder configurado
 */
function doOsuSkillsRankingEmbed({
    players = [],
    totalCount = 0,
    startIndex = 0,
    countryCode = "VE",
    gamemode = "osu",
    skill = "aim",
    message,
    locale = "es"
}) {
    const embedColor = getEmbedColor(message);
    const countryCodesData = require("../src/country_codes.json");
    const countryInfo = countryCodesData[countryCode.toUpperCase()];
    const countryName = countryInfo ? countryInfo.country : countryCode.toUpperCase();
    const flag = getCountryFlag(countryCode);

    const MODE_NAMES = {
        osu: "osu!",
        taiko: "osu!taiko",
        fruits: "osu!catch",
        mania: "osu!mania"
    };
    const modeDisplayName = MODE_NAMES[gamemode] || "osu!";

    const skillUpper = (skill || "aim").toUpperCase();
    const title = `${flag} ${t(locale, "skills.ranking_title", {
        country: countryName,
        skill: skillUpper,
        mode: modeDisplayName
    })}`;

    if (!players || players.length === 0) {
        return new EmbedBuilder()
            .setColor(embedColor)
            .setTitle(title)
            .setDescription(`*${t(locale, "skills.ranking_no_players", { country: countryName })}*`)
            .setFooter({
                text: `Sengo • ${t(locale, "skills.ranking_footer_empty")}`,
                iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
            })
            .setTimestamp();
    }

    const lines = players.map((p, index) => {
        const rankNum = startIndex + index + 1;
        const userUrl = `https://osu.ppy.sh/users/${p.osu_id}`;
        const skillVal = formatDecimal(p[skill] ?? 0, locale, 2);
        const ppFormatted = formatNumber(Math.round(p.pp || 0), locale);

        let subDetails = `  ↳ **${ppFormatted} pp**`;
        if (p.country_rank && p.country_rank > 0) {
            subDetails += ` (#${formatNumber(p.country_rank, locale)} ${p.country_code})`;
        }
        if (p.global_rank && p.global_rank > 0) {
            subDetails += ` • Global: **#${formatNumber(p.global_rank, locale)}**`;
        }
        if (p.top_play_pp && p.top_play_pp > 0) {
            subDetails += ` • Top: **${formatNumber(Math.round(p.top_play_pp), locale)}pp**`;
        }

        // Mostrar habilidades secundarias clave si no es la habilidad ordenada
        const secondarySkills = [];
        if (skill !== "aim" && p.aim > 0) secondarySkills.push(`Aim: ${formatDecimal(p.aim, locale, 1)}`);
        if (skill !== "speed" && p.speed > 0) secondarySkills.push(`Spd: ${formatDecimal(p.speed, locale, 1)}`);
        if (skill !== "acc" && p.acc > 0) secondarySkills.push(`Acc: ${formatDecimal(p.acc, locale, 1)}`);
        if (skill !== "reading" && p.reading > 0) secondarySkills.push(`Read: ${formatDecimal(p.reading, locale, 1)}`);

        let secStr = "";
        if (secondarySkills.length > 0) {
            secStr = `\n    *${secondarySkills.slice(0, 3).join(" • ")}*`;
        }

        return `**#${rankNum}** [${p.username}](${userUrl}) ▸ **${skillVal} pts** \`${skillUpper}\`\n${subDetails}${secStr}`;
    });

    const currentPage = Math.floor(startIndex / 10) + 1;
    const totalPages = Math.max(1, Math.ceil(totalCount / 10));

    return new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(title)
        .setDescription(lines.join("\n\n"))
        .setFooter({
            text: `Sengo • ${t(locale, "skills.ranking_page_info", { page: currentPage, totalPages, totalPlayers: totalCount })}`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();
}

module.exports = {
    doOsuSkillsEmbed,
    doOsuSkillsRankingEmbed,
    getCountryFlag,
    formatModsCleanText
};

