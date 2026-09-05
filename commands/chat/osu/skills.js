const { t } = require("../../../utils/i18n.js");
const { getOsuUser, getUserTopScores, argsParser } = require("../../utils/osu.js");
const { analyzeSkillsBreakdown } = require("../../../models/SkillsModel.js");
const { doOsuSkillsEmbed } = require("../../../views/osuSkillsView.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");

async function run(messages, args) {
    const { message, res, logger } = messages;
    const locale = message?.locale || "es";
    const safeArgs = Array.isArray(args) ? args : [];

    // Mapeo de alias de habilidades para filtrado en -top
    const SKILL_ALIASES = {
        aim: "aim",
        speed: "speed",
        acc: "acc",
        accuracy: "acc",
        precision: "acc",
        reading: "reading",
        read: "reading",
        stamina: "stamina",
        stam: "stamina",
        color: "color",
        colour: "color",
        rhythm: "rhythm",
        movement: "movement",
        move: "movement",
        stream: "stream",
        jack: "jack",
        jacks: "jack",
        tech: "tech",
        ln: "tech"
    };

    // ponytail: Si se incluye -top, delegar al flujo de mejores jugadas desglosadas por habilidad
    const isTopMode = safeArgs.some(arg => typeof arg === "string" && (arg.toLowerCase() === "-top" || arg.toLowerCase() === "--top"));
    if (isTopMode) {
        let requestedSkill = null;
        const cleanArgs = [];
        for (const arg of safeArgs) {
            if (typeof arg !== "string") continue;
            const lower = arg.toLowerCase();
            if (lower === "-top" || lower === "--top") continue;

            const stripped = lower.replace(/^--?/, "");
            if (SKILL_ALIASES[stripped]) {
                requestedSkill = SKILL_ALIASES[stripped];
                continue;
            }
            cleanArgs.push(arg);
        }

        const topCommand = require("./top.js");
        return await topCommand.run(messages, cleanArgs, {
            isSkillTop: true,
            requestedSkill
        });
    }

    // Detectar modo explícito si fue especificado por argumentos
    let explicitMode = null;
    for (const arg of safeArgs) {
        if (typeof arg !== "string") continue;
        const lower = arg.toLowerCase();
        if (["-t", "-taiko", "--taiko", "taiko"].includes(lower)) explicitMode = "taiko";
        else if (["-c", "-catch", "--catch", "catch", "-ctb", "--ctb", "ctb", "-fruits", "--fruits", "fruits"].includes(lower)) explicitMode = "fruits";
        else if (["-mania", "--mania", "mania"].includes(lower) || lower === "-m") explicitMode = "mania";
        else if (["-std", "--std", "std", "-osu", "--osu", "osu"].includes(lower)) explicitMode = "osu";
    }

    let osuUser = null;
    let detectedMode = explicitMode;

    if (logger) logger.process("Consultando usuario de osu!");

    if (safeArgs.length > 0) {
        const osuUserdata = await argsParser(safeArgs, {
            message,
            res: res || {},
            command_function: getOsuUser,
            gamemode: explicitMode,
            ignore_main_gamemode: Boolean(explicitMode),
            resolveUserByIndex: true,
            ignoreBeatmap: true
        });

        if (osuUserdata && osuUserdata.gamemode) {
            detectedMode = explicitMode || osuUserdata.gamemode;
        }

        if (osuUserdata && osuUserdata.fn_response) {
            if (typeof osuUserdata.fn_response === "string") {
                return osuUserdata.fn_response;
            }
            osuUser = osuUserdata.fn_response;
        }
    }

    const targetMode = detectedMode || osuUser?.playmode || "osu";

    if (!osuUser || !osuUser.id) {
        // Buscar usuario vinculado del autor
        try {
            const linked = await OsuUserModel.getLinkedUser(res?.User, message.author.id);
            if (linked && (linked.osu_id || linked.username)) {
                const queryUser = String(linked.osu_id || linked.username);
                osuUser = await getOsuUser({ username: [queryUser], gamemode: targetMode, server: "bancho" });
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
        if (logger) logger.process(`Obteniendo Top 100 puntuaciones en ${targetMode} y analizando habilidades`);
        const topScores = await getUserTopScores({ username: [String(osuUser.id)], gamemode: targetMode, server: "bancho" }).catch(() => []);

        if (!topScores || topScores.length === 0) {
            return t(locale, "skills.err_no_scores", { username: osuUser.username });
        }

        const skillsBreakdown = await analyzeSkillsBreakdown(topScores, targetMode);
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
