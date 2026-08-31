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

    // Filtrar flags para obtener argumentos de usuario
    const cleanArgs = safeArgs.filter(arg => 
        typeof arg === "string" && ![
            "-embed", "--embed", "embed",
            "-f", "-force", "--force", "-r", "-refresh", "--refresh"
        ].includes(arg.toLowerCase())
    );

    async function updateProgress(stepIndex, state, extraMsg = "") {
        const steps = locale === "es" ? [
            "Consultando perfil y estadísticas...",
            "Obteniendo jugada pineada y tops...",
            "Renderizando tarjeta con Canvas..."
        ] : [
            "Fetching profile and statistics...",
            "Retrieving pinned play and tops...",
            "Rendering profile card with Canvas..."
        ];

        const descriptionLines = steps.map((step, idx) => {
            let icon = "⚪";
            if (idx < stepIndex) icon = "✅";
            else if (idx === stepIndex) {
                if (state === "loading") icon = "⏳";
                else if (state === "success") icon = "✅";
                else if (state === "error") icon = "❌";
            }
            return `${icon} **${locale === "es" ? "Paso" : "Step"} ${idx + 1}:** ${step}${idx === stepIndex && extraMsg ? ` ${extraMsg}` : ""}`;
        });

        const totalElapsed = Date.now() - startTime;
        const progressEmbed = new EmbedBuilder()
            .setTitle(locale === "es" ? "Generando Tarjeta de Perfil..." : "Generating Profile Card...")
            .setDescription(descriptionLines.join("\n"))
            .setColor(getEmbedColor(message))
            .setFooter({
                text: locale === "es"
                    ? `Sengo • Tiempo transcurrido: ${(totalElapsed / 1000).toFixed(2)}s`
                    : `Sengo • Elapsed time: ${(totalElapsed / 1000).toFixed(2)}s`
            });

        try {
            if (!statusMessage) {
                if (reply && typeof reply.reply === "function") {
                    statusMessage = await reply.reply({ embeds: [progressEmbed] });
                } else if (res && typeof res.reply === "function") {
                    statusMessage = await res.reply({ embeds: [progressEmbed], fetchReply: true });
                } else if (message && typeof message.reply === "function") {
                    statusMessage = await message.reply({ embeds: [progressEmbed] });
                }
            } else if (typeof statusMessage.edit === "function") {
                await statusMessage.edit({ embeds: [progressEmbed] });
            }
        } catch {}
    }

    let osuUser = null;

    if (logger) logger.process("Consultando datos de usuario para la tarjeta");
    await updateProgress(0, "loading");

    if (cleanArgs.length > 0) {
        const osuUserdata = await argsParser(cleanArgs, {
            message,
            res,
            command_function: getOsuUser,
            resolveUserByIndex: true,
            ignoreBeatmap: true
        });

        if (osuUserdata && osuUserdata.fn_response) {
            if (typeof osuUserdata.fn_response === "string") {
                await updateProgress(0, "error", `(${osuUserdata.fn_response})`);
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
                osuUser = await getOsuUser({ username: [queryUser], gamemode: linked.main_gamemode || "osu", server: "bancho" });
            }
        } catch (err) {
            console.warn("[s.card] Error al obtener usuario vinculado:", err.message);
        }

        // Fallback si no está vinculado
        if (!osuUser || !osuUser.id) {
            const noUserErr = t(locale, "card.err_no_user") || `❌ No tienes una cuenta de osu! vinculada. Usa \`s.link\` para vincular tu cuenta o especifica un usuario con \`s.card [usuario]\`.`;
            await updateProgress(0, "error");
            return noUserErr;
        }
    }

    if (!osuUser || !osuUser.id || typeof osuUser === "string") {
        const notFoundErr = t(locale, "card.err_user_not_found") || `❌ No se pudo encontrar al usuario en osu!.`;
        await updateProgress(0, "error");
        return notFoundErr;
    }

    await updateProgress(0, "success");

    try {
        if (logger) logger.process("Obteniendo mejores puntuaciones y renderizando tarjeta");
        await updateProgress(1, "loading");
        const topScores = await getUserTopScores({ username: [String(osuUser.id)], gamemode: "osu", server: "bancho" }).catch(() => []);
        await updateProgress(1, "success");

        await updateProgress(2, "loading");
        const canvasBuffer = await renderOsuCard(osuUser, topScores, { forceRefresh: isForce, locale });
        const attachment = new AttachmentBuilder(canvasBuffer, { name: "card.png" });

        if (isEmbed) {
            const embed = doOsuCardEmbed(message, "card.png");
            if (statusMessage && typeof statusMessage.edit === "function") {
                await statusMessage.edit({ embeds: [embed], files: [attachment] });
                return statusMessage;
            }
            return {
                embeds: [embed],
                files: [attachment]
            };
        }

        if (statusMessage && typeof statusMessage.edit === "function") {
            await statusMessage.edit({ embeds: [], files: [attachment] });
            return statusMessage;
        }

        return {
            files: [attachment]
        };
    } catch (error) {
        console.error("[s.card] Error al renderizar tarjeta en Canvas:", error);
        await updateProgress(2, "error", `(${error.message})`);
        return `❌ Error al generar la tarjeta de perfil: \`${error.message}\``;
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
