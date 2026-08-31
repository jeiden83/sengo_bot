const { AttachmentBuilder } = require("discord.js");
const { t } = require("../../../utils/i18n.js");
const { renderOsuCard, doOsuCardEmbed } = require("../../../views/osuCardViews.js");
const { getOsuUser, getUserTopScores, argsParser } = require("../../utils/osu.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");

async function run(messages, args) {
    const { message, res, logger } = messages;
    const locale = message?.locale || "es";
    const safeArgs = Array.isArray(args) ? args : [];

    const isEmbed = safeArgs.some(arg => 
        typeof arg === "string" && (
            arg.toLowerCase() === "-embed" ||
            arg.toLowerCase() === "--embed" ||
            arg.toLowerCase() === "embed"
        )
    );

    // Filtrar flags para obtener argumentos de usuario
    const cleanArgs = safeArgs.filter(arg => 
        typeof arg === "string" && !["-embed", "--embed", "embed"].includes(arg.toLowerCase())
    );

    let osuUser = null;

    if (logger) logger.process("Consultando datos de usuario para la tarjeta");

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
            return t(locale, "card.err_no_user") || `❌ No tienes una cuenta de osu! vinculada. Usa \`s.link\` para vincular tu cuenta o especifica un usuario con \`s.card [usuario]\`.`;
        }
    }

    if (!osuUser || !osuUser.id || typeof osuUser === "string") {
        return t(locale, "card.err_user_not_found") || `❌ No se pudo encontrar al usuario en osu!.`;
    }

    try {
        if (logger) logger.process("Obteniendo mejores puntuaciones y renderizando tarjeta");
        const topScores = await getUserTopScores({ username: [String(osuUser.id)], gamemode: "osu", server: "bancho" }).catch(() => []);
        
        const canvasBuffer = await renderOsuCard(osuUser, topScores);
        const attachment = new AttachmentBuilder(canvasBuffer, { name: "card.png" });

        if (isEmbed) {
            const embed = doOsuCardEmbed(message, "card.png");
            return {
                embeds: [embed],
                files: [attachment]
            };
        }

        return {
            files: [attachment]
        };
    } catch (error) {
        console.error("[s.card] Error al renderizar tarjeta en Canvas:", error);
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
