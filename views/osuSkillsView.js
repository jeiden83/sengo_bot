const { EmbedBuilder } = require("discord.js");
const { t } = require("../utils/i18n.js");
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
    const ppFormatted = rawPP.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const globalRank = stats.global_rank ? `#${stats.global_rank.toLocaleString()}` : "#-";
    const countryCode = (osuUser.country_code || "").toUpperCase();
    const countryRank = stats.country_rank ? `${countryCode}${stats.country_rank}` : `${countryCode}-`;

    const authorName = `${flag} ${username}: ${ppFormatted}pp (${globalRank} ${countryRank})`;

    const aimScore = skillsBreakdown.aim ?? 0;
    const speedScore = skillsBreakdown.speed ?? 0;
    const accScore = skillsBreakdown.acc ?? 0;
    const readingScore = skillsBreakdown.reading ?? 0;

    // Encabezado de promedios en puntos
    const avgLines = [
        `**${t(locale, "skills.avg_aim")}:** ${aimScore.toFixed(2)} pts`,
        `**${t(locale, "skills.avg_speed")}:** ${speedScore.toFixed(2)} pts`,
        `**${t(locale, "skills.avg_acc")}:** ${accScore.toFixed(2)} pts`,
        `**${t(locale, "skills.avg_reading")}:** ${readingScore.toFixed(2)} pts`
    ];

    /**
     * Construye las líneas de jugadas para una habilidad específica mostrando sus puntos
     */
    const buildSkillLines = (plays, skillKey) => {
        if (!plays || plays.length === 0) {
            return `*${t(locale, "skills.no_plays")}*`;
        }
        return plays.map(item => {
            const sc = item.score;
            const points = Number(item[skillKey] != null ? item[skillKey] : (item.points || 0)).toFixed(2);
            const grade = getGradeEmoji(sc.rank, sc.passed !== false);
            const songTitle = sc.beatmapset?.title || sc.beatmap?.title || "Beatmap";
            const diffName = sc.beatmap?.version || "Normal";
            const mapUrl = `https://osu.ppy.sh/b/${sc.beatmap?.id}`;
            const mods = formatModsCleanText(sc.mods);

            return `\`${points} pts\` ${grade} [${songTitle} [${diffName}]](${mapUrl})${mods}`;
        }).join("\n");
    };

    const description = [
        avgLines.join("\n"),
        "",
        `**${t(locale, "skills.section_aim")}**`,
        buildSkillLines(skillsBreakdown.topAim, "aim"),
        "",
        `**${t(locale, "skills.section_speed")}**`,
        buildSkillLines(skillsBreakdown.topSpeed, "speed"),
        "",
        `**${t(locale, "skills.section_acc")}**`,
        buildSkillLines(skillsBreakdown.topAcc, "acc"),
        "",
        `**${t(locale, "skills.section_reading")}**`,
        buildSkillLines(skillsBreakdown.topReading, "reading")
    ].join("\n");

    return new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: authorName,
            iconURL: avatarUrl,
            url: userUrl
        })
        .setTitle(t(locale, "skills.embed_title"))
        .setThumbnail(avatarUrl)
        .setDescription(description)
        .setFooter({
            text: `Sengo • ${t(locale, "skills.embed_footer")}`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();
}

module.exports = {
    doOsuSkillsEmbed,
    getCountryFlag,
    formatModsCleanText
};
