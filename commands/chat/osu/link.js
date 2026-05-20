const { addUser, deleteUser } = require("../../../db/database.js"); 
const { getOsuUser, argsParserNoCommand} = require("../../utils/osu.js"); 
const { getRedirectUri, getAuthUrl } = require("../../../utils/osuAuth.js");
const { EmbedBuilder } = require("discord.js");

async function run(messages, args) {
    const { message, res } = messages;

    try {
        const discord_id = message.author.id;

        // Verificar si se solicitó OAuth explícitamente vía flag o argumento
        const isOAuth = args && args.some(arg => typeof arg === 'string' && (arg.toLowerCase() === '-oauth' || arg.toLowerCase() === 'oauth'));

        if (isOAuth) {
            // Flujo OAuth
            // Obtener URLs para OAuth
            const redirectUri = getRedirectUri();
            const authUrl = getAuthUrl(discord_id, redirectUri);

            // Crear Embed bonito
            const embed = new EmbedBuilder()
                .setTitle("Vinculación de Cuenta Segura - SengoBot")
                .setDescription(
                    "Para vincular tu cuenta de osu! de forma completamente segura y privada mediante la API oficial (OAuth), haz clic en el siguiente botón:\n\n" +
                    `👉 **[Autorizar Cuenta de osu!](${authUrl})**\n\n` +
                    "**¿Por qué usar OAuth?**\n" +
                    "• **Seguridad**: No necesitamos tu contraseña.\n" +
                    "• **Pool de Soporte**: Tu cuenta ayudará a consultar rankings nacionales si tienes supporter.\n" +
                    "• **Privado**: Este proceso es completamente confidencial."
                )
                .setColor("#ff66aa")
                .setFooter({ text: "SengoBot OAuth System v2" })
                .setTimestamp();

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
            await deleteUser(res.User, discord_id);
            // También remover de oauth_tokens si existe
            const supabase = res.supabaseClient;
            if (supabase) {
                await supabase.from('oauth_tokens').delete().eq('discord_id', discord_id);
            }
            return `Se ha **desvinculado** tu cuenta de osu! correctamente del bot.`;
        }

        // Flujo tradicional pasado
        const parsed_args = argsParserNoCommand(args);

        // Si no hay un nombre
        if (parsed_args.username[0].length == 0) {
            await deleteUser(res.User, discord_id);
            // También remover de oauth_tokens por si acaso
            const supabase = res.supabaseClient;
            if (supabase) {
                await supabase.from('oauth_tokens').delete().eq('discord_id', discord_id);
            }
            return `Se ha **desvinculado** el usuario \`${message.author.username}\` del **bot** correctamente.`;
        }

        // Hay un nombre en el argumento
        const osu_user = await getOsuUser(parsed_args);

        if (typeof osu_user === "string") return `El usuario de osu! ${parsed_args.username[0]} no existe.`;
        
        return addUser(res.User, discord_id, osu_user.id, parsed_args.gamemode)
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