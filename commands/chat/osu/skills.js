const { t } = require("../../../utils/i18n.js");
const { getOsuUser, getUserTopScores, argsParser } = require("../../utils/osu.js");
const { analyzeSkillsBreakdown, saveUserSkills, getCountrySkillsLeaderboard } = require("../../../models/SkillsModel.js");
const { doOsuSkillsEmbed, doOsuSkillsRankingEmbed } = require("../../../views/osuSkillsView.js");
const { buildPaginationRow } = require("../../../views/osuViewHelpers.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");

async function run(messages, args) {
    const { message, res, logger } = messages;
    const locale = message?.locale || "es";
    const safeArgs = Array.isArray(args) ? args : [];

    // Mapeo de alias de habilidades para filtrado en -top y ranking nacional
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
        ln: "tech",
        pp: "pp"
    };

    // Flags que activan el ranking nacional de habilidades
    const NATIONAL_FLAGS = new Set([
        "-nacional", "--nacional", "-nac", "--nac",
        "-national", "--national",
        "-lb", "--lb", "-leaderboard", "--leaderboard"
    ]);

    let isNational = false;
    let countryArg = null;
    let selectedSkill = null;
    const countryCodesData = require("../../../src/country_codes.json");

    for (let i = 0; i < safeArgs.length; i++) {
        const arg = safeArgs[i];
        if (typeof arg !== "string") continue;
        const lower = arg.toLowerCase();
        const stripped = lower.replace(/^--?/, "");

        if (NATIONAL_FLAGS.has(lower)) {
            isNational = true;
            continue;
        }

        if (lower === "-pais" || lower === "--pais" || lower === "-country" || lower === "--country") {
            isNational = true;
            if (i + 1 < safeArgs.length && !safeArgs[i + 1].startsWith("-")) {
                countryArg = safeArgs[i + 1].trim().toUpperCase();
                i++;
            }
            continue;
        }

        if (["skills", "skill", "s"].includes(stripped)) {
            if (i + 1 < safeArgs.length) {
                const nextStripped = safeArgs[i + 1].toLowerCase().replace(/^--?/, "");
                if (SKILL_ALIASES[nextStripped]) {
                    selectedSkill = SKILL_ALIASES[nextStripped];
                    i++;
                }
            }
            continue;
        }

        if (SKILL_ALIASES[stripped]) {
            selectedSkill = SKILL_ALIASES[stripped];
            continue;
        }

        // Si es código ISO de 2 letras y coincide con el catálogo de países
        if (/^[a-zA-Z]{2}$/.test(arg)) {
            const pot = arg.toUpperCase();
            if (countryCodesData[pot]) {
                countryArg = pot;
            }
        }
    }

    // Si se especificó un país directo con -top (ej: s.skills -top VE), interpretar como ranking nacional
    if (countryArg && safeArgs.some(a => typeof a === "string" && (a.toLowerCase() === "-top" || a.toLowerCase() === "--top"))) {
        isNational = true;
    }

    // 🏆 Flujo de Ranking Nacional de Habilidades (cero llamadas on-the-fly, consulta 100% DB)
    if (isNational) {
        let targetMode = "osu";
        for (const arg of safeArgs) {
            if (typeof arg !== "string") continue;
            const lower = arg.toLowerCase();
            if (["-t", "-taiko", "--taiko", "taiko"].includes(lower)) targetMode = "taiko";
            else if (["-c", "-catch", "--catch", "catch", "-ctb", "--ctb", "ctb", "-fruits", "--fruits", "fruits"].includes(lower)) targetMode = "fruits";
            else if (["-mania", "--mania", "mania"].includes(lower) || lower === "-m") targetMode = "mania";
            else if (["-std", "--std", "std", "-osu", "--osu", "osu"].includes(lower)) targetMode = "osu";
        }

        let countryCode = countryArg;
        if (!countryCode || countryCode === "SELF") {
            try {
                const userToken = await OsuUserModel.getOAuthTokenRecord(message.author?.id);
                if (userToken && userToken.country_code) {
                    countryCode = userToken.country_code.toUpperCase();
                }
            } catch (err) {
                console.warn("[s.skills] Error al consultar país del autor en OAuth:", err.message);
            }
            if (!countryCode) countryCode = "VE";
        }

        const skillToQuery = selectedSkill || "aim";
        const pageSize = 10;
        let startIndex = 0;

        if (logger) logger.process(`Consultando ranking nacional de habilidades (${skillToQuery}) para ${countryCode}`);

        const initialData = await getCountrySkillsLeaderboard({
            countryCode,
            gamemode: targetMode,
            skill: skillToQuery,
            limit: pageSize,
            offset: startIndex
        });

        const embed = doOsuSkillsRankingEmbed({
            players: initialData.players,
            totalCount: initialData.totalCount,
            startIndex,
            countryCode: initialData.countryCode,
            gamemode: targetMode,
            skill: skillToQuery,
            message,
            locale
        });

        const total = initialData.totalCount;
        const hasButtons = total > pageSize;
        const components = hasButtons
            ? [buildPaginationRow({ prefix: "skills_lb", current: startIndex, total, pageSize })]
            : [];

        let sentMessage = null;
        if (typeof message.channel?.send === "function") {
            sentMessage = await message.channel.send({
                embeds: [embed],
                components
            });
        } else if (typeof message.reply === "function") {
            sentMessage = await message.reply({
                embeds: [embed],
                components
            });
        }

        if (!hasButtons || !sentMessage || typeof sentMessage.createMessageComponentCollector !== "function") {
            return sentMessage || { embeds: [embed], components };
        }

        const btnFilter = btnInt => btnInt.user.id === message.author?.id;
        const collector = sentMessage.createMessageComponentCollector({
            filter: btnFilter,
            idle: 60000
        });

        collector.on("collect", async i => {
            try {
                await i.deferUpdate();

                if (i.customId === "skills_lb_first") {
                    startIndex = 0;
                } else if (i.customId === "skills_lb_prev") {
                    startIndex = Math.max(0, startIndex - pageSize);
                } else if (i.customId === "skills_lb_next") {
                    startIndex = startIndex + pageSize;
                } else if (i.customId === "skills_lb_last") {
                    startIndex = Math.floor((total - 1) / pageSize) * pageSize;
                }

                const pageData = await getCountrySkillsLeaderboard({
                    countryCode,
                    gamemode: targetMode,
                    skill: skillToQuery,
                    limit: pageSize,
                    offset: startIndex
                });

                const updatedEmbed = doOsuSkillsRankingEmbed({
                    players: pageData.players,
                    totalCount: total,
                    startIndex,
                    countryCode: pageData.countryCode,
                    gamemode: targetMode,
                    skill: skillToQuery,
                    message,
                    locale
                });

                const updatedRow = buildPaginationRow({ prefix: "skills_lb", current: startIndex, total, pageSize });

                if (typeof sentMessage.edit === "function") {
                    await sentMessage.edit({
                        embeds: [updatedEmbed],
                        components: [updatedRow]
                    });
                }
            } catch (collectErr) {
                console.warn("[s.skills] Error en botón de paginación:", collectErr.message);
            }
        });

        collector.on("end", async () => {
            try {
                if (sentMessage && typeof sentMessage.edit === "function") {
                    await sentMessage.edit({ components: [] });
                }
            } catch {
                // Mensaje ya editado o borrado
            }
        });

        return sentMessage;
    }

    // ponytail: Si se incluye -top o un flag de habilidad (-reading, -aim, etc.) sin ser ranking nacional, delegar a mejores jugadas
    const hasSkillArg = safeArgs.some(arg => typeof arg === "string" && Boolean(SKILL_ALIASES[arg.toLowerCase().replace(/^--?/, "")]));
    const isTopMode = safeArgs.some(arg => typeof arg === "string" && (arg.toLowerCase() === "-top" || arg.toLowerCase() === "--top")) || hasSkillArg;
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
        try {
            const linked = await OsuUserModel.getLinkedUser(res?.User, message.author?.id);
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

        // Determinar si el osuUser consultado pertenece al autor del mensaje
        let authorDiscordId = null;
        try {
            const authorLinked = await OsuUserModel.getLinkedUser(res?.User, message.author?.id);
            if (authorLinked && String(authorLinked.osu_id) === String(osuUser.id)) {
                authorDiscordId = message.author?.id;
            }
        } catch {
            // Silenciar
        }

        // Auto-persistencia pasiva en Supabase en segundo plano (para cualquier usuario consultado)
        saveUserSkills({
            osuUser,
            skillsBreakdown,
            gamemode: targetMode,
            discordId: authorDiscordId
        }).catch(err => {
            console.warn("[s.skills] Error al persistir skills en background:", err.message);
        });

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

