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
 * Genera una barra de progreso visual compacta en caracteres Unicode.
 * @param {number} current Puntuación actual
 * @param {number} max Puntuación máxima de referencia
 * @param {number} length Cantidad de bloques (por defecto 10)
 */
function generateProgressBar(current, max, length = 10) {
    if (max <= 0) return "□".repeat(length);
    const filled = Math.max(0, Math.min(length, Math.round((current / max) * length)));
    const empty = length - filled;
    return "■".repeat(filled) + "□".repeat(empty);
}

/**
 * Genera el embed de Discord para el comando .antiskills / /antiskills
 * @param {object} params
 * @param {object} params.message Mensaje o contexto de interacción de Discord
 * @param {object} params.osuUser Datos del usuario de osu!
 * @param {object} params.antiSkillsData Resultado devuelto por SkillsModel.calculateAntiSkills
 * @param {string} params.locale Idioma ('es' o 'en')
 * @returns {EmbedBuilder} Embed configurado
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

    // 1. Descripción principal: Punto ciego destacado
    const descLines = [
        `${t(locale, "antiskills.primary_deficit_label")} ${t(locale, "antiskills.primary_deficit_desc", {
            skill: primaryName,
            score: formatDecimal(primary.score, locale, 1),
            deficit: formatDecimal(primary.deficit, locale, 1),
            ratio: formatDecimal(primary.ratio, locale, 1),
            peakSkill: peakName
        })}`
    ];

    // 2. Campo: Desglose de brechas relativas
    const deficitLines = antiSkillsData.deficits.map(item => {
        const skillTranslated = t(locale, `antiskills.skill_${item.key}`) || t(locale, `skills.avg_${item.key}`) || item.key.toUpperCase();
        if (item.key === peak.key) {
            return t(locale, "antiskills.skill_peak_label", {
                skill: skillTranslated,
                score: formatDecimal(item.score, locale, 1)
            });
        }

        let emoji = "🟢";
        if (item.severity === "critical") emoji = "🔴";
        else if (item.severity === "moderate") emoji = "🟡";
        else if (item.severity === "mild") emoji = "🔵";

        const bar = generateProgressBar(item.score, item.maxScore, 8);
        return t(locale, "antiskills.skill_deficit_line", {
            emoji,
            skill: skillTranslated,
            score: formatDecimal(item.score, locale, 1),
            bar,
            deficit: formatDecimal(item.deficit, locale, 1),
            ratio: formatDecimal(item.ratio, locale, 0)
        });
    });

    // 3. Campo: Consistencia y Techo de FC
    const cons = antiSkillsData.consistency;
    let chokeEmoji = "🟢";
    let chokeStatus = t(locale, "antiskills.choke_consistent");
    if (cons.severity === "severe_choke") {
        chokeEmoji = "🔴";
        chokeStatus = t(locale, "antiskills.choke_severe");
    } else if (cons.severity === "moderate_choke") {
        chokeEmoji = "🟡";
        chokeStatus = t(locale, "antiskills.choke_moderate");
    }

    const consistencyLines = [
        t(locale, "antiskills.consistency_line_fc", {
            fcStars: formatDecimal(cons.fcStars, locale, 2),
            pushStars: formatDecimal(cons.pushStars, locale, 2)
        }),
        t(locale, "antiskills.consistency_line_choke", {
            chokeGap: formatDecimal(cons.chokeGap, locale, 2),
            emoji: chokeEmoji,
            status: chokeStatus
        }),
        t(locale, "antiskills.consistency_line_rate", {
            rate: formatDecimal(cons.nonFcRate * 100, locale, 0),
            nonFcCount: Math.round(cons.nonFcRate * 100),
            totalCount: 100
        })
    ];

    // 4. Campo: Límites de Tempo (BPM)
    const bpmLimits = antiSkillsData.bpmLimits;
    const bpmLines = [
        t(locale, "antiskills.bpm_line_avg", { avgBpm: bpmLimits.weightedAvgBpm }),
        t(locale, "antiskills.bpm_line_comfort", { comfortBpm: bpmLimits.comfortBpm }),
        t(locale, "antiskills.bpm_line_wall", { wallBpm: bpmLimits.maxBpmWall })
    ];

    // 5. Campo: Mod Analysis & Kryptonite
    const modAnalysis = antiSkillsData.modAnalysis;
    const domModsStr = modAnalysis.dominantMods.length > 0
        ? modAnalysis.dominantMods.map(m => `\`+${m}\``).join(" • ")
        : t(locale, "antiskills.mods_dominant_none");

    const krypModsStr = modAnalysis.kryptoniteMods.length > 0
        ? modAnalysis.kryptoniteMods.map(m => `\`+${m}\``).join(" • ")
        : t(locale, "antiskills.mods_kryptonite_none");

    const modLines = [
        t(locale, "antiskills.mods_dominant", { mods: domModsStr }),
        t(locale, "antiskills.mods_kryptonite", { mods: krypModsStr })
    ];

    modAnalysis.kryptoniteMods.forEach(kMod => {
        const lowerMod = kMod.toLowerCase();
        const descKey = `antiskills.mods_kryptonite_desc_${lowerMod}`;
        const desc = t(locale, descKey);
        if (desc && desc !== descKey) {
            modLines.push(desc);
        }
    });

    // 6. Campo: Nemesis Archetype
    const nemesis = antiSkillsData.nemesisArchetype;
    const nemesisName = t(locale, `antiskills.nemesis.${nemesis.id}.name`) || "Mapa Némesis";
    const nemesisDesc = t(locale, `antiskills.nemesis.${nemesis.id}.desc`) || "";
    const nemesisLines = [
        `*${nemesisDesc}*`,
        t(locale, "antiskills.nemesis_zone", {
            zone: nemesis.arZone,
            sr: formatDecimal(nemesis.estimatedDangerSR, locale, 2)
        }),
        t(locale, "antiskills.nemesis_mods", { mods: `\`${nemesis.triggerMods}\`` })
    ];

    // 7. Campo: Prescripción de entrenamiento
    const adviceLines = (antiSkillsData.recommendations || []).map(rKey => {
        return t(locale, `antiskills.${rKey}`, {
            targetBpm: bpmLimits.comfortBpm + 15,
            fcStars: formatDecimal(cons.fcStars, locale, 1),
            kryptonite: modAnalysis.kryptoniteMods[0] ? `+${modAnalysis.kryptoniteMods[0]}` : "mods secundarios"
        });
    }).filter(line => Boolean(line) && !line.startsWith("antiskills."));

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({ name: authorName, iconURL: avatarUrl, url: userUrl })
        .setTitle(`${t(locale, "antiskills.title")} • ${modeDisplayName}`)
        .setDescription(descLines.join("\n\n"))
        .setThumbnail(avatarUrl)
        .addFields(
            {
                name: t(locale, "antiskills.field_deficits_title", {
                    peakScore: formatDecimal(peak.score, locale, 1)
                }),
                value: deficitLines.join("\n"),
                inline: false
            },
            {
                name: t(locale, "antiskills.field_consistency_title"),
                value: consistencyLines.join("\n"),
                inline: false
            },
            {
                name: t(locale, "antiskills.field_bpm_title"),
                value: bpmLines.join("\n"),
                inline: true
            },
            {
                name: t(locale, "antiskills.field_mods_title"),
                value: modLines.join("\n"),
                inline: true
            },
            {
                name: t(locale, "antiskills.field_nemesis_title", { name: nemesisName }),
                value: nemesisLines.join("\n"),
                inline: false
            }
        )
        .setFooter({ text: t(locale, "antiskills.footer") });

    if (adviceLines.length > 0) {
        embed.addFields({
            name: t(locale, "antiskills.field_training_title"),
            value: adviceLines.join("\n\n"),
            inline: false
        });
    }

    return embed;
}

module.exports = {
    doOsuAntiSkillsEmbed,
    getCountryFlag,
    generateProgressBar
};
