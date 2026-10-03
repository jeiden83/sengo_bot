const { t } = require("../../../utils/i18n.js");
const { getOsuUser, getUserTopScores, argsParser } = require("../../utils/osu.js");
const { calculateAntiSkills, analyzeSkillsBreakdown } = require("../../../models/SkillsModel.js");
const { doOsuAntiSkillsEmbed } = require("../../../views/osuAntiSkillsView.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");

/**
 * ponytail: Controlador del comando s.antiskills.
 * Coordina la extracción de parámetros, consulta de perfil y scores,
 * cálculo analítico de debilidades y delegación a la vista.
 */
async function run(messages, args) {
    const { message, res, logger } = messages;
    const locale = message?.locale || "es";
    const safeArgs = Array.isArray(args) ? args : [];

    let explicitMode = null;
    let explicitServer = null;
    let isForce = false;

    for (const arg of safeArgs) {
        if (typeof arg !== "string") continue;
        const lower = arg.toLowerCase().trim();

        if (["-force", "--force", "-f", "-refresh", "--refresh", "-recargar"].includes(lower)) {
            isForce = true;
        } else if (["-t", "-taiko", "--taiko", "taiko"].includes(lower)) {
            explicitMode = "taiko";
        } else if (["-c", "-catch", "--catch", "catch", "-ctb", "--ctb", "ctb", "-fruits", "--fruits", "fruits"].includes(lower)) {
            explicitMode = "fruits";
        } else if (["-mania", "--mania", "mania"].includes(lower) || lower === "-m") {
            explicitMode = "mania";
        } else if (["-std", "--std", "std", "-osu", "--osu", "osu"].includes(lower)) {
            explicitMode = "osu";
        } else if (["-droid", "--droid", "droid", "-osudroid", "--osudroid", "osudroid", "-od", "-odroid"].includes(lower)) {
            explicitServer = "droid";
        } else if (["-gatari", "--gatari", "gatari"].includes(lower)) {
            explicitServer = "gatari";
        } else if (["-bancho", "--bancho", "bancho"].includes(lower)) {
            explicitServer = "bancho";
        }
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
            server: explicitServer,
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
            const isDroid = explicitServer === "droid" || safeArgs.some(a => typeof a === "string" && ["-droid", "--droid", "-osudroid", "--osudroid", "droid", "osudroid"].includes(a.toLowerCase()));
            if (isDroid) {
                if (linked && linked.droid_uid) {
                    osuUser = await getOsuUser({ username: [String(linked.droid_uid)], gamemode: "osu", server: "droid" });
                } else {
                    return `⚠️ No tienes una cuenta de \`osu!droid\` vinculada. Usa \`s.droid link <nombre_o_uid>\` o especifica un usuario con \`s.antiskills -droid <usuario>\`.`;
                }
            } else if (linked && (linked.osu_id || linked.username)) {
                const queryUser = String(linked.osu_id || linked.username);
                osuUser = await getOsuUser({ username: [queryUser], gamemode: targetMode, server: explicitServer || "bancho" });
            }
        } catch (err) {
            console.warn("[s.antiskills] Error al obtener usuario vinculado:", err.message);
        }

        if (!osuUser || !osuUser.id) {
            return t(locale, "antiskills.err_no_user");
        }
    }

    if (!osuUser || !osuUser.id || typeof osuUser === "string") {
        return t(locale, "antiskills.err_user_not_found");
    }

    try {
        const targetServer = osuUser.server || explicitServer || "bancho";
        if (logger) logger.process(`Obteniendo Top 100 de ${osuUser.username} en ${targetMode} (${targetServer}) para diagnóstico de debilidades`);

        const topScores = await getUserTopScores({
            username: [String(osuUser.id)],
            gamemode: targetMode,
            server: targetServer,
            force: isForce
        }).catch(() => []);

        if (!topScores || topScores.length === 0) {
            return t(locale, "antiskills.err_no_scores", { username: osuUser.username });
        }

        const skillsBreakdown = await analyzeSkillsBreakdown(topScores, targetMode, {
            userId: osuUser.id,
            server: targetServer,
            forceRefresh: isForce
        });

        const antiSkillsData = await calculateAntiSkills(topScores, targetMode, {
            skillsBreakdown,
            userId: osuUser.id,
            server: targetServer,
            forceRefresh: isForce
        });

        const embed = doOsuAntiSkillsEmbed({
            message,
            osuUser,
            antiSkillsData,
            locale
        });

        const responsePayload = { embeds: [embed] };

        if (typeof message.reply === "function") {
            return await message.reply(responsePayload);
        }
        return message.channel?.send ? await message.channel.send(responsePayload) : responsePayload;
    } catch (err) {
        console.error("[s.antiskills] Error al procesar comando:", err);
        const errMsg = t(locale, "general.error_unexpected") || "❌ Ocurrió un error inesperado al procesar el comando.";
        if (typeof message.reply === "function") return await message.reply(errMsg);
        return message.channel?.send ? await message.channel.send(errMsg) : errMsg;
    }
}

run.description = {
    header: "Diagnóstico cinemático de debilidades, puntos ciegos, kryptonitas de mods y mapa némesis",
    body: "Analiza el Top 100 del jugador calculando la brecha relativa de habilidades frente a su pico, tasa de choke, límites de tempo (BPM) y perfil de mapa que más le cuesta.",
    usage: "s.antiskills [usuario] [-std|-taiko|-catch|-mania] [-droid|-gatari|-bancho] [-force]"
};

run.alias = ["antiskill", "antihabilidades", "debilidades", "weaknesses", "blindspots"];
run.flags = ["-modo", "-server", "-force"];

module.exports = { run, description: run.description };
