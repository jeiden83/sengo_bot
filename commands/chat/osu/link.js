const { linkUser, unlinkUser, getOsuUser } = require("../../../models/OsuUserModel.js");
const { argsParserNoCommand } = require("../../utils/osu.js"); 
const { getRedirectUri, getAuthUrl } = require("../../../utils/osuAuth.js");
const { doOsuOAuthEmbed } = require("../../../views/osuUserViews.js");

async function run(messages, args) {
    const { message, res, logger } = messages;

    try {
        const discord_id = message.author.id;

        // Verificar si se solicitó OAuth explícitamente vía flag o argumento
        const isOAuth = args && args.some(arg => typeof arg === 'string' && (arg.toLowerCase() === '-oauth' || arg.toLowerCase() === 'oauth'));

        if (isOAuth) {
            if (logger) logger.process("Generando URL de autorización OAuth...");
            // Flujo OAuth
            // Obtener URLs para OAuth
            const redirectUri = getRedirectUri();
            const authUrl = getAuthUrl(discord_id, redirectUri);

            // Crear Embed bonito utilizando la capa de visualización (View)
            const embed = doOsuOAuthEmbed(authUrl);

            if (logger) logger.process("Enviando mensaje privado con instrucciones...");
            // Enviar por DM para máxima privacidad
            try {
                await message.author.send({ embeds: [embed] });
                const replyText = `Revisa tu dm, que te mandé la verificación por ahí. 🔒`;
                if (typeof message.reply === 'function') {
                    await message.reply(replyText);
                    return null;
                }
                return replyText;
            } catch (dmError) {
                console.error(`Error al enviar DM de vinculación a ${message.author.username}:`, dmError);
                return `⚠️ **Error:** No pude enviarte un mensaje privado. Por favor, asegúrate de tener activada la opción de recibir mensajes directos de miembros del servidor y vuelve a intentarlo.`;
            }
        }

        // Si se provee la palabra "unlink" o "desvincular"
        const isUnlink = args && args.some(arg => typeof arg === 'string' && (arg.toLowerCase() === 'unlink' || arg.toLowerCase() === 'desvincular'));
        if (isUnlink) {
            if (logger) logger.process("Eliminando vinculación de la base de datos...");
            await unlinkUser(res.User, discord_id);
            return `Se ha **desvinculado** tu cuenta de osu! correctamente del bot.`;
        }

        // Flujo tradicional pasado
        const parsed_args = argsParserNoCommand(args);

        // Si no hay un nombre
        if (parsed_args.username[0].length == 0) {
            if (logger) logger.process("Eliminando vinculación de la base de datos (sin argumentos)...");
            await unlinkUser(res.User, discord_id);
            return `Se ha **desvinculado** el usuario \`${message.author.username}\` del **bot** correctamente.`;
        }

        // Hay un nombre en el argumento
        if (logger) logger.process(`Buscando usuario '${parsed_args.username[0]}' en la API de osu!...`);
        const osu_user = await getOsuUser(parsed_args);

        if (typeof osu_user === "string") return `El usuario de osu! ${parsed_args.username[0]} no existe.`;
        
        if (logger) logger.process(`Guardando vinculación para '${osu_user.username}' en la base de datos...`);
        return linkUser(res.User, discord_id, osu_user.id, parsed_args.gamemode)
            .then(res => (res.status === 1)?
                `Se ha **vinculado** al usuario de osu! \`${osu_user.username}\` correctamente.` : `Error al vincular el usuario.`
        );

    } catch (error) {
        console.error('Error en el comando link:', error);
        return `Ocurrió un error al intentar vincular tu cuenta.`;
    }
}

run.description = {
    'header': 'Vincula tu cuenta de osu! con el bot',
    'body': 'Vincula tu usuario de Discord con tu cuenta de osu!.\nPor defecto usa la vinculación tradicional (pública).\nUsa el flag `-oauth` para vincularte de forma segura y privada por DMs.',
    'usage': `s.link [usuario_osu] : Vincula tu cuenta de forma tradicional.\ns.link -oauth : Envía el enlace de vinculación seguro por privado.\ns.link unlink : Desvincula completamente tu cuenta.`
}

module.exports = { run }