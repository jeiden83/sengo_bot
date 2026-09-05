const { AttachmentBuilder, EmbedBuilder } = require("discord.js");
const { t } = require("../../../utils/i18n.js");
const { renderOsuCard, doOsuCardEmbed } = require("../../../views/osuCardViews.js");
const { getOsuUser, getUserTopScores, argsParser } = require("../../utils/osu.js");
const { getEmbedColor } = require("../../../views/osuViewHelpers.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");

async function run(messages, args) {
    const { message, res, reply, logger } = messages;
    const locale = message?.locale || "es";
    const safeArgs = Array.isArray(args) ? args : [];
    const startTime = Date.now();
    let statusMessage = null;

    const isEmbed = safeArgs.some(arg => 
        typeof arg === "string" && (
            arg.toLowerCase() === "-embed" ||
            arg.toLowerCase() === "--embed" ||
            arg.toLowerCase() === "embed"
        )
    );

    const isForce = safeArgs.some(arg => 
        typeof arg === "string" && (
            arg.toLowerCase() === "-f" ||
            arg.toLowerCase() === "-force" ||
            arg.toLowerCase() === "--force" ||
            arg.toLowerCase() === "-r" ||
            arg.toLowerCase() === "-refresh" ||
            arg.toLowerCase() === "--refresh"
        )
    );

    // Detectar modo de juego explícito si fue pasado en los argumentos
    let explicitMode = null;
    for (const arg of safeArgs) {
        if (typeof arg !== "string") continue;
        const lower = arg.toLowerCase();
        if (["-t", "-taiko", "--taiko", "taiko"].includes(lower)) explicitMode = "taiko";
        else if (["-c", "-catch", "--catch", "catch", "-ctb", "--ctb", "ctb", "-fruits", "--fruits", "fruits"].includes(lower)) explicitMode = "fruits";
        else if (["-mania", "--mania", "mania"].includes(lower) || lower === "-m") explicitMode = "mania";
        else if (["-std", "--std", "std", "-osu", "--osu", "osu"].includes(lower)) explicitMode = "osu";
    }

    // Filtrar flags para obtener argumentos de usuario limpios
    const cleanArgs = safeArgs.filter(arg => {
        if (typeof arg !== "string") return false;
        const lower = arg.toLowerCase();
        return ![
            "-embed", "--embed", "embed",
            "-f", "-force", "--force", "-r", "-refresh", "--refresh",
            "-t", "-taiko", "--taiko", "taiko",
            "-c", "-catch", "--catch", "catch", "-ctb", "--ctb", "ctb", "-fruits", "--fruits", "fruits",
            "-mania", "--mania", "mania", "-m",
            "-std", "--std", "std", "-osu", "--osu", "osu"
        ].includes(lower);
    });

    async function sendInitialProgress() {
        const totalElapsed = Date.now() - startTime;
        const progressEmbed = new EmbedBuilder()
            .setTitle(locale === "es" ? "Generando Tarjeta de Perfil..." : "Generating Profile Card...")
            .setDescription(locale === "es"
                ? "⏳ **Consultando perfil de osu!, estadísticas y dibujando tarjeta con Canvas...**"
                : "⏳ **Fetching osu! profile, statistics and rendering card with Canvas...**"
            )
            .setColor(getEmbedColor(message))
            .setFooter({
                text: locale === "es"
                    ? `Sengo • Procesando solicitud`
                    : `Sengo • Processing request`
            });

        try {
            if (reply && typeof reply.reply === "function") {
                statusMessage = await reply.reply({ embeds: [progressEmbed] });
            } else if (res && typeof res.reply === "function") {
                statusMessage = await res.reply({ embeds: [progressEmbed], fetchReply: true });
            } else if (message && typeof message.reply === "function") {
                statusMessage = await message.reply({ embeds: [progressEmbed] });
            }
        } catch {}
    }

    // Iniciar mensaje de progreso en segundo plano
    const progressPromise = sendInitialProgress();

    let osuUser = null;
    let detectedMode = explicitMode;

    if (logger) logger.process("Consultando datos de usuario para la tarjeta");

    const isSlash = !!messages?.isSlash || !!message?.isSlash;

    async function cleanupProgress() {
        if (!isSlash && statusMessage && typeof statusMessage.delete === "function") {
            await statusMessage.delete().catch(() => {});
        }
    }

    if (cleanArgs.length > 0) {
        const osuUserdata = await argsParser(cleanArgs, {
            message,
            res,
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
                await progressPromise;
                await cleanupProgress();
                return isSlash ? { content: osuUserdata.fn_response, embeds: [] } : osuUserdata.fn_response;
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
            console.warn("[s.card] Error al obtener usuario vinculado:", err.message);
        }

        // Fallback si no está vinculado
        if (!osuUser || !osuUser.id) {
            await progressPromise;
            const noUserErr = t(locale, "card.err_no_user") || `❌ No tienes una cuenta de osu! vinculada. Usa \`s.link\` para vincular tu cuenta o especifica un usuario con \`s.card [usuario]\`.`;
            await cleanupProgress();
            return isSlash ? { content: noUserErr, embeds: [] } : noUserErr;
        }
    }

    if (!osuUser || !osuUser.id || typeof osuUser === "string") {
        await progressPromise;
        const notFoundErr = t(locale, "card.err_user_not_found") || `❌ No se pudo encontrar al usuario en osu!.`;
        await cleanupProgress();
        return isSlash ? { content: notFoundErr, embeds: [] } : notFoundErr;
    }

    try {
        if (logger) logger.process(`Obteniendo mejores puntuaciones en ${targetMode} y renderizando tarjeta`);
        const topScoresPromise = getUserTopScores({ username: [String(osuUser.id)], gamemode: targetMode, server: "bancho" }).catch(() => []);

        const [topScores] = await Promise.all([
            topScoresPromise,
            progressPromise
        ]);

        const canvasBuffer = await renderOsuCard(osuUser, topScores, { forceRefresh: isForce, locale, mode: targetMode });
        const attachment = new AttachmentBuilder(canvasBuffer, { name: "card.png" });

        await cleanupProgress();

        if (isEmbed) {
            const embed = doOsuCardEmbed(message, "card.png");
            return {
                embeds: [embed],
                files: [attachment]
            };
        }

        return {
            embeds: [],
            files: [attachment]
        };
    } catch (error) {
        console.error("[s.card] Error al renderizar tarjeta en Canvas:", error);
        await cleanupProgress();
        return {
            content: `❌ Error al generar la tarjeta de perfil: \`${error.message}\``,
            embeds: []
        };
    }
}

run.alias = {
    "tarjeta": {
        "args": ""
    },
    "tarjetadeperfil": {
        "args": ""
    },
    "profilecard": {
        "args": ""
    },
    "idcard": {
        "args": ""
    }
};

run.description = {
    header: t("es", "commands.card.header"),
    body: t("es", "commands.card.body"),
    usage: t("es", "commands.card.usage")
};

module.exports = { run, description: run.description };
