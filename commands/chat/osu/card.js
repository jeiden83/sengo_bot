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

    const isUserpage = safeArgs.some(arg => 
        typeof arg === "string" && (
            arg.toLowerCase() === "-userpage" ||
            arg.toLowerCase() === "--userpage" ||
            arg.toLowerCase() === "userpage" ||
            arg.toLowerCase() === "-up" ||
            arg.toLowerCase() === "--up" ||
            arg.toLowerCase() === "-bbcode" ||
            arg.toLowerCase() === "--bbcode" ||
            arg.toLowerCase() === "bbcode"
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

    // Detectar preset de formato de tarjeta (ej: -compact, -linea, -ultra, etc.)
    let explicitPreset = null;
    for (const arg of safeArgs) {
        if (typeof arg !== "string") continue;
        const lower = arg.toLowerCase();
        if (["-compact", "--compact", "compact", "-compacto", "--compacto"].includes(lower)) explicitPreset = "compact";
        else if (["-linea", "--linea", "-1linea", "--1linea", "-single", "--single", "single", "-fila", "--fila"].includes(lower)) explicitPreset = "single_row";
        else if (["-lineaplay", "--lineaplay", "-playline", "--playline", "-singleplay", "--singleplay"].includes(lower)) explicitPreset = "single_row_play";
        else if (["-panoramica", "--panoramica", "-allline", "--allline", "-lineatodo", "--lineatodo"].includes(lower)) explicitPreset = "single_row_all";
        else if (["-ultra", "--ultra", "ultra"].includes(lower)) explicitPreset = "ultra";
        else if (["-mini", "--mini", "mini", "-movil", "--movil"].includes(lower)) explicitPreset = "mini_card";
        else if (["-standard", "--standard", "standard", "-full", "--full"].includes(lower)) explicitPreset = "standard";
    }

    // Filtrar flags para obtener argumentos de usuario limpios
    const cleanArgs = safeArgs.filter(arg => {
        if (typeof arg !== "string") return false;
        const lower = arg.toLowerCase();
        return ![
            "-embed", "--embed", "embed",
            "-userpage", "--userpage", "userpage", "-up", "--up", "-bbcode", "--bbcode", "bbcode",
            "-f", "-force", "--force", "-r", "-refresh", "--refresh",
            "-t", "-taiko", "--taiko", "taiko",
            "-c", "-catch", "--catch", "catch", "-ctb", "--ctb", "ctb", "-fruits", "--fruits", "fruits",
            "-mania", "--mania", "mania", "-m",
            "-std", "--std", "std", "-osu", "--osu", "osu",
            "-compact", "--compact", "compact", "-compacto", "--compacto",
            "-linea", "--linea", "-1linea", "--1linea", "-single", "--single", "single", "-fila", "--fila",
            "-lineaplay", "--lineaplay", "-playline", "--playline", "-singleplay", "--singleplay",
            "-panoramica", "--panoramica", "-allline", "--allline", "-lineatodo", "--lineatodo",
            "-ultra", "--ultra", "ultra",
            "-mini", "--mini", "mini", "-movil", "--movil",
            "-standard", "--standard", "standard", "-full", "--full"
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

    // Iniciar mensaje de progreso en segundo plano (omitir si es solo consulta de enlace de userpage)
    const progressPromise = isUserpage ? Promise.resolve() : sendInitialProgress();

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

    if (isUserpage) {
        await cleanupProgress();

        const crypto = require("crypto");
        const secretKey = process.env.CARD_API_KEY || process.env.OSU_CLIENT_SECRET || (res?.Config && res.Config.OSU_CLIENT_SECRET) || "sengo_card_secure_token";
        const userToken = crypto.createHmac("sha256", secretKey).update(osuUser.username.toLowerCase()).digest("hex").slice(0, 16);

        const rawBaseUrl = process.env.CARD_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "https://sengo-bot-q981.onrender.com";
        const baseUrl = rawBaseUrl.replace(/\/+$/, "");
        const presetParam = explicitPreset ? `&preset=${encodeURIComponent(explicitPreset)}` : "";
        const cardUrl = `${baseUrl}/api/card.png?u=${encodeURIComponent(osuUser.username)}&m=${encodeURIComponent(targetMode)}${presetParam}&token=${userToken}`;

        const bbcodeClickable = `[center][url=https://osu.ppy.sh/users/${osuUser.id}][img]${cardUrl}[/img][/url][/center]`;
        const bbcodeImageOnly = `[img]${cardUrl}[/img]`;

        const dmEmbed = new EmbedBuilder()
            .setTitle(locale === "es" ? "🎨 Tarjeta Dinámica para tu Userpage de osu!" : "🎨 Dynamic Profile Card for your osu! Userpage")
            .setDescription(locale === "es"
                ? `¡Aquí tienes tu código **BBCode** listo para colocar en tu perfil o página de usuario de osu!.\nCada vez que alguien visite tu perfil, la imagen se mostrará actualizada automáticamente.`
                : `Here is your **BBCode** snippet ready for your osu! profile/userpage.\nEvery time someone visits your profile, the card will display your updated stats.`
            )
            .setColor(getEmbedColor(message))
            .addFields(
                {
                    name: locale === "es" ? "📋 BBCode Clickeable (Recomendado: abre tu perfil)" : "📋 Clickable BBCode (Recommended)",
                    value: "```bbcode\n" + bbcodeClickable + "\n```"
                },
                {
                    name: locale === "es" ? "🖼️ BBCode (Solo Imagen)" : "🖼️ Image Only BBCode",
                    value: "```bbcode\n" + bbcodeImageOnly + "\n```"
                },
                {
                    name: locale === "es" ? "⚙️ Parámetros Aplicados" : "⚙️ Applied Configuration",
                    value: `• **Usuario:** \`${osuUser.username}\` (#${osuUser.id})\n• **Modo:** \`${targetMode}\`\n• **Preset:** \`${explicitPreset || "standard"}\`\n• **Enlace directo:** [Ver Tarjeta en Navegador](${cardUrl})`
                }
            )
            .setFooter({
                text: locale === "es"
                    ? "Sengo • Mantén este enlace seguro (incluye un token privado asociado a tu usuario)."
                    : "Sengo • Keep this link secure (it contains a private token tied to your user)."
            });

        const author = message?.author || message?.user;
        const isAlreadyDM = Boolean(
            message?.channel?.isDMBased?.() ||
            message?.channel?.type === 1 ||
            !message?.guild
        );

        if (isAlreadyDM) {
            return {
                embeds: [dmEmbed]
            };
        }

        try {
            if (author && typeof author.send === "function") {
                await author.send({ embeds: [dmEmbed] });
            } else {
                throw new Error("No direct message function available on author");
            }

            const confirmEmbed = new EmbedBuilder()
                .setTitle(locale === "es" ? "📩 ¡Código BBCode Enviado por Privado!" : "📩 BBCode Sent via DM!")
                .setDescription(locale === "es"
                    ? `He enviado el código BBCode y el enlace seguro de tu tarjeta a tus **Mensajes Directos** (<@${author.id}>) para no exponer tu enlace en este canal.`
                    : `I have sent the BBCode and secure card link to your **Direct Messages** (<@${author.id}>) to keep your link private.`
                )
                .setColor(getEmbedColor(message));

            return {
                embeds: [confirmEmbed]
            };
        } catch (dmError) {
            console.error("[s.card] Error al enviar DM de userpage:", dmError?.message || dmError);
            const failEmbed = new EmbedBuilder()
                .setTitle(locale === "es" ? "❌ No se pudo enviar el Mensaje Privado" : "❌ Could not send Direct Message")
                .setDescription(locale === "es"
                    ? `No pude enviarte el código por privado porque tienes los Mensajes Directos bloqueados o cerrados en este servidor.\n\nPor favor, **habilita los mensajes directos de miembros del servidor** en tus ajustes de privacidad de Discord y vuelve a intentar.`
                    : `I couldn't send you the BBCode via DM because your Direct Messages are closed or blocked.\n\nPlease enable **Direct Messages from server members** in your Discord Privacy Settings and try again.`
                )
                .setColor("#ff4757");

            return {
                embeds: [failEmbed]
            };
        }
    }

    try {
        if (logger) logger.process(`Obteniendo mejores puntuaciones en ${targetMode} y renderizando tarjeta`);
        const topScoresPromise = getUserTopScores({ username: [String(osuUser.id)], gamemode: targetMode, server: "bancho" }).catch(() => []);

        const [topScores] = await Promise.all([
            topScoresPromise,
            progressPromise
        ]);

        const canvasBuffer = await renderOsuCard(osuUser, topScores, { forceRefresh: isForce, locale, mode: targetMode, preset: explicitPreset });
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
