const { t } = require("../../../utils/i18n.js");
const { getOsuUser, getUserTopScores, argsParser } = require("../../utils/osu.js");
const { analyzeSkillsBreakdown } = require("../../../views/osuCardViews.js");
const { doOsuSkillsEmbed } = require("../../../views/osuSkillsView.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");

async function run(messages, args) {
    const { message, res, logger } = messages;
    const locale = message?.locale || "es";
    const safeArgs = Array.isArray(args) ? args : [];

    // Validar si pasaron flags de otros modos de juego (Taiko, Catch/CTB, Mania)
    const NON_STD_MODES = [
        "-taiko", "--taiko", "taiko", "-t",
        "-catch", "--catch", "catch", "-ctb", "--ctb", "ctb", "-fruits", "--fruits", "fruits",
        "-mania", "--mania", "mania", "-m"
    ];

    const hasNonStdArg = safeArgs.some(arg => 
        typeof arg === "string" && NON_STD_MODES.includes(arg.toLowerCase())
    );

    if (hasNonStdArg) {
        return t(locale, "skills.err_only_std");
    }

    let osuUser = null;

    if (logger) logger.process("Consultando usuario de osu!");

    if (safeArgs.length > 0) {
        const osuUserdata = await argsParser(safeArgs, {
            message,
            res: res || {},
            command_function: getOsuUser,
            resolveUserByIndex: true,
            ignoreBeatmap: true
        });

        if (osuUserdata && osuUserdata.gamemode && osuUserdata.gamemode !== "osu") {
            return t(locale, "skills.err_only_std");
        }

        if (osuUserdata && osuUserdata.fn_response) {
            if (typeof osuUserdata.fn_response === "string") {
                return osuUserdata.fn_response;
            }
            osuUser = osuUserdata.fn_response;
        }
    } else {
        // Buscar usuario vinculado del autor
        try {
            const linked = await OsuUserModel.getLinkedUser(res?.User, message.author.id);
            if (linked && (linked.osu_id || linked.username)) {
                const queryUser = String(linked.osu_id || linked.username);
                osuUser = await getOsuUser({ username: [queryUser], gamemode: "osu", server: "bancho" });
            }
        } catch (err) {
            console.warn("[s.skills] Error al obtener usuario vinculado:", err.message);
        }

        if (!osuUser || !osuUser.id) {
            return t(locale, "skills.err_no_user");
        }
    }

    if (!osuUser || !osuUser.id || typeof osuUser === "string") {
        return t(locale, "skills.err_user_not_found");
    }

    try {
        if (logger) logger.process("Obteniendo Top 100 puntuaciones y analizando habilidades");
        const topScores = await getUserTopScores({ username: [String(osuUser.id)], gamemode: "osu", server: "bancho" }).catch(() => []);

        if (!topScores || topScores.length === 0) {
            return t(locale, "skills.err_no_scores", { username: osuUser.username });
        }

        const skillsBreakdown = await analyzeSkillsBreakdown(topScores);
        const embed = doOsuSkillsEmbed(message, osuUser, skillsBreakdown, locale);

        return { embeds: [embed] };
    } catch (error) {
        console.error("[s.skills] Error al procesar desglose de habilidades:", error);
        return `❌ ${t(locale, "skills.err_generic", { error: error.message })}`;
    }
}

run.alias = {
    skill: true,
    ts: true
};

run.description = "Desglosa las habilidades de osu! de la tarjeta (.card) con sus mejores jugadas";

module.exports = {
    run,
    description: run.description
};
