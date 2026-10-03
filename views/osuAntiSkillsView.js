const { EmbedBuilder } = require("discord.js");
const { t, formatNumber, formatDecimal } = require("../utils/i18n.js");
const { getEmbedColor } = require("./osuViewHelpers.js");

/**
 * Convierte un código de país ISO 3166-1 alpha-2 en emoji de bandera Unicode.
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
 * ponytail: Genera la tabla gráfica de barras horizontales coloreadas en ANSI para Discord.
 */
function buildAntiSkillsAnsiTable(deficits, peakKey, peakScore, locale = "es") {
    const ansi = {
        reset: "\x1b[0m",
        red: "\x1b[1;31m",
        yellow: "\x1b[1;33m",
        green: "\x1b[1;32m",
        cyan: "\x1b[1;36m",
        white: "\x1b[1;37m",
        gray: "\x1b[1;30m"
    };

    const header = locale === "en"
        ? "SKILL         PTS    PROGRESS (PEAK)   GAP"
        : "HABILIDAD     PTS    PROGRESO PICO     BRECHA";
    const peakTag = locale === "en" ? "★ PEAK MAX" : "★ PICO MAX";

    const lines = [header, "───────────────────────────────────────────────"];
    const BAR_WIDTH = 12;

    deficits.forEach(item => {
        const isPeak = item.key === peakKey;
        const skillName = t(locale, `antiskills.skill_${item.key}`) || t(locale, `skills.avg_${item.key}`) || item.key;
        const shortName = skillName.split(" ")[0] || item.key;
        const namePad = (shortName + (isPeak ? " 👑" : "")).padEnd(12);

        const ptsStr = formatDecimal(item.score, locale, 1).padStart(5);
        const pct = Math.max(0, Math.min(100, item.ratio));
        const filled = Math.round((pct / 100) * BAR_WIDTH);
        const empty = BAR_WIDTH - filled;

        let color = ansi.green;
        let tag = `-${formatDecimal(item.deficit, locale, 1)} (${formatDecimal(pct, locale, 0)}%)`;

        if (isPeak) {
            color = ansi.yellow;
            tag = peakTag;
        } else if (item.severity === "critical") {
            color = ansi.red;
        } else if (item.severity === "moderate") {
            color = ansi.yellow;
        } else if (item.severity === "mild") {
            color = ansi.cyan;
        }

        const bar = `${color}${"█".repeat(filled)}${ansi.gray}${"░".repeat(empty)}${ansi.reset}`;
        const line = `${color}${namePad}${ansi.reset} ${ansi.white}${ptsStr}${ansi.reset} [${bar}] ${color}${tag.padStart(13)}${ansi.reset}`;
        lines.push(line);
    });

    return `\`\`\`ansi\n${lines.join("\n")}\n\`\`\``;
}

/**
 * ponytail: Genera las métricas compactas (Consistencia, Choke, BPM) en formato nativo Discord (blockquote).
 * Reemplaza el bloque ANSI para evitar recuadros oscuros de código y texto negro de baja legibilidad.
 */
function buildMetricsNative(antiSkills, locale = "es") {
    const cons = antiSkills.consistency;
    const bpm = antiSkills.bpmLimits;

    let chokeBadge = "🟢";
    let chokeText = locale === "en" ? "Solid" : "Sólido";
    if (cons.severity === "severe_choke") {
        chokeBadge = "🔴";
        chokeText = locale === "en" ? "Choker" : "Choker";
    } else if (cons.severity === "moderate_choke") {
        chokeBadge = "🟡";
        chokeText = locale === "en" ? "Inconsistent" : "Inconsistente";
    }

    const nonFcRatePct = Math.round(cons.nonFcRate * 100);
    const isEn = locale === "en";

    const titleCons = isEn ? "Consistency" : "Consistencia";
    const titleBpm = isEn ? "Tempo (BPM)" : "Tempo (BPM)";
    const comfortLabel = isEn ? "Comfort" : "Confort";
    const wallLabel = isEn ? "Wall" : "Muro";

    const line1 = `> ⚖️ **${titleCons}:** \`~${formatDecimal(cons.fcStars, locale, 2)}★ FC\` *(Push ${formatDecimal(cons.pushStars, locale, 2)}★)* • Choke: \`${formatDecimal(cons.chokeGap, locale, 2)}★\` ${chokeBadge} **${chokeText}** *(${nonFcRatePct}% no-fc)*`;
    const line2 = `> 🥁 **${titleBpm}:** \`~${bpm.comfortBpm} BPM\` ${comfortLabel} *(Avg ${bpm.weightedAvgBpm})* • ${wallLabel}: \`~${bpm.maxBpmWall}+ BPM\` 🧱`;

    return `${line1}\n${line2}`;
}

const buildMetricsAnsi = buildMetricsNative;

/**
 * Genera el embed de Discord para el comando .antiskills / /antiskills
 * Optimizada para legibilidad visual con bloques ANSI y densidad sin muros de texto.
 */
function doOsuAntiSkillsEmbed({ message, osuUser, antiSkillsData, locale = "es" }) {
    const embedColor = getEmbedColor(message);

    const flag = getCountryFlag(osuUser.country_code);
    const username = osuUser.username || "Jugador";
    const userUrl = osuUser.server === "droid"
        ? `https://osudroid.moe/profile.php?uid=${osuUser.id}`
        : `https://osu.ppy.sh/users/${osuUser.id}`;
    const avatarUrl = osuUser.avatar_url || "https://osu.ppy.sh/images/layout/avatar-guest.png";

    const stats = osuUser.statistics || {};
    const rawPP = Number(stats.pp || 0);
    const ppFormatted = formatDecimal(rawPP, locale, 2);
    const globalRank = stats.global_rank ? `#${formatNumber(stats.global_rank, locale)}` : "#-";
    const countryCode = (osuUser.country_code || "").toUpperCase();
    const countryRank = stats.country_rank ? `${countryCode}${formatNumber(stats.country_rank, locale)}` : `${countryCode}-`;

    const authorName = `${flag} ${username}: ${ppFormatted}pp (${globalRank} ${countryRank})`;

    const mode = antiSkillsData.mode || "osu";
    const MODE_NAMES = {
        osu: "osu!",
        taiko: "osu!taiko",
        fruits: "osu!catch",
        catch: "osu!catch",
        mania: "osu!mania"
    };
    const modeDisplayName = MODE_NAMES[mode] || "osu!";

    const primary = antiSkillsData.primaryDeficit;
    const peak = antiSkillsData.strongestSkill;
    const peakName = t(locale, `antiskills.skill_${peak.key}`) || t(locale, `skills.avg_${peak.key}`) || peak.key.toUpperCase();
    const primaryName = t(locale, `antiskills.skill_${primary.key}`) || t(locale, `skills.avg_${primary.key}`) || primary.key.toUpperCase();

    // Bloques gráficos: tabla de barras ANSI y métricas en formato nativo Discord
    const ansiBars = buildAntiSkillsAnsiTable(antiSkillsData.deficits, peak.key, peak.score, locale);
    const nativeMetrics = buildMetricsNative(antiSkillsData, locale);

    // Némesis Cinemático & Kryptonita combinados
    const nemesis = antiSkillsData.nemesisArchetype;
    const nemesisName = t(locale, `antiskills.nemesis.${nemesis.id}.name`) || "Mapa Némesis";
    const modAnalysis = antiSkillsData.modAnalysis;

    const krypMod = modAnalysis.kryptoniteMods.length > 0
        ? `\`+${modAnalysis.kryptoniteMods.join("`, `+")}\``
        : `*${t(locale, "antiskills.mods_kryptonite_none")}*`;

    const domMod = modAnalysis.dominantMods.length > 0
        ? `\`+${modAnalysis.dominantMods.join("`, `+")}\``
        : (t(locale, "antiskills.mods_dominant_none") || "*Sin mod predominante*");

    const krypDesc = modAnalysis.kryptoniteMods[0]
        ? t(locale, `antiskills.mods_kryptonite_desc_${modAnalysis.kryptoniteMods[0].toLowerCase()}`) || ""
        : "";
    const cleanKrypDesc = krypDesc ? krypDesc.replace(/^•\s*\*\*[^*]+\*\*:\s*/, "") : "";

    const nemesisSection = [
        `▸ **${t(locale, "antiskills.label_nemesis_map") || "Mapa Némesis"}:** ${nemesisName} (**~${formatDecimal(nemesis.estimatedDangerSR, locale, 2)}★** con \`${nemesis.triggerMods}\`)`,
        `  ↳ *${t(locale, "antiskills.label_zone") || "Zona"}:* \`${nemesis.arZone}\``,
        `▸ **${t(locale, "antiskills.label_kryptonite") || "Kryptonita"}:** ☣️ ${krypMod}${cleanKrypDesc ? ` • *${cleanKrypDesc}*` : ""}`,
        `▸ **${t(locale, "antiskills.label_dominant_mods") || "Mods Dominantes"}:** ${domMod}`
    ].filter(Boolean).join("\n");

    // Prescripción concisa de entrenamiento
    const trainingLines = (antiSkillsData.recommendations || []).map(rKey => {
        return t(locale, `antiskills.${rKey}`, {
            targetBpm: antiSkillsData.bpmLimits.comfortBpm + 15,
            fcStars: formatDecimal(antiSkillsData.consistency.fcStars, locale, 1),
            kryptonite: modAnalysis.kryptoniteMods[0] ? `+${modAnalysis.kryptoniteMods[0]}` : "mods secundarios"
        });
    }).filter(line => Boolean(line) && !line.startsWith("antiskills."));

    const description = `${t(locale, "antiskills.primary_deficit_label")} **${primaryName}** (\`${formatDecimal(primary.score, locale, 1)} pts\`) ▸ Brecha: **-${formatDecimal(primary.deficit, locale, 1)} pts** (*${formatDecimal(primary.ratio, locale, 1)}%* de tu pico en ${peakName})\n${ansiBars}\n${nativeMetrics}`;

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({ name: authorName, iconURL: avatarUrl, url: userUrl })
        .setTitle(`${t(locale, "antiskills.title")} • ${modeDisplayName}`)
        .setDescription(description)
        .setThumbnail(avatarUrl)
        .addFields({
            name: t(locale, "antiskills.field_nemesis_combined_title") || "💀 Némesis Cinemático & Kryptonita",
            value: nemesisSection,
            inline: false
        })
        .setFooter({ text: t(locale, "antiskills.footer") });

    if (trainingLines.length > 0) {
        embed.addFields({
            name: t(locale, "antiskills.field_training_title") || "💡 Prescripción de Entrenamiento",
            value: trainingLines.join("\n"),
            inline: false
        });
    }

    return embed;
}

module.exports = {
    doOsuAntiSkillsEmbed,
    getCountryFlag,
    buildAntiSkillsAnsiTable,
    buildMetricsNative,
    buildMetricsAnsi
};
