const OsuUserModel = require("../../../models/OsuUserModel.js");
const { argsParserNoCommand } = require("../../utils/osu.js"); 
const { getRedirectUri, getAuthUrl } = require("../../../utils/osuAuth.js");
const { doOsuOAuthEmbed } = require("../../../views/osuUserViews.js");
const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message, res, logger } = messages;
    const locale = message.locale || 'es';

    try {
        const discord_id = message.author.id;

        // Verificar si se solicitó OAuth explícitamente vía flag o argumento
        const isOAuth = args && args.some(arg => typeof arg === 'string' && (arg.toLowerCase() === '-oauth' || arg.toLowerCase() === 'oauth'));

        if (isOAuth) {
            if (logger) logger.process(t(locale, 'link.generating_url'));
            // Flujo OAuth
            // Obtener URLs para OAuth
            const redirectUri = getRedirectUri();
            const authUrl = getAuthUrl(discord_id, redirectUri);

            // Crear Embed bonito utilizando la capa de visualización (View)
            const embed = doOsuOAuthEmbed(authUrl, message);

            if (logger) logger.process(t(locale, 'link.sending_dm'));
            // Enviar por DM para máxima privacidad
            try {
                await message.author.send({ embeds: [embed] });
                const replyText = t(locale, 'link.check_dm');
                if (typeof message.reply === 'function') {
                    await message.reply(replyText);
                    return null;
                }
                return replyText;
            } catch (dmError) {
                console.error(`Error al enviar DM de vinculación a ${message.author.username}:`, dmError);
                return t(locale, 'link.err_dm');
            }
        }

        // Si se provee la palabra "unlink" o "desvincular"
        const isUnlink = args && args.some(arg => typeof arg === 'string' && (arg.toLowerCase() === 'unlink' || arg.toLowerCase() === 'desvincular'));
        if (isUnlink) {
            if (logger) logger.process(t(locale, 'link.unlinking'));
            await OsuUserModel.unlinkUser(res.User, discord_id);
            return t(locale, 'link.unlink_success');
        }

        // Flujo tradicional pasado
        const parsed_args = argsParserNoCommand(args);

        // Si no hay un nombre
        if (parsed_args.username[0].length === 0) {
            if (logger) logger.process(t(locale, 'link.unlinking_legacy'));
            await OsuUserModel.unlinkUser(res.User, discord_id);
            return t(locale, 'link.unlink_success_legacy', { username: message.author.username });
        }

        // Hay un nombre en el argumento
        if (logger) logger.process(t(locale, 'link.fetching_user', { username: parsed_args.username[0] }));
        const osu_user = await OsuUserModel.getOsuUser(parsed_args);

        if (typeof osu_user === "string") return t(locale, 'link.user_not_exist', { username: parsed_args.username[0] });
        
        if (logger) logger.process(t(locale, 'link.saving_link', { username: osu_user.username }));
        return OsuUserModel.linkUser(res.User, discord_id, osu_user.id, parsed_args.gamemode)
            .then(resRecord => (resRecord.status === 1) ?
                t(locale, 'link.link_success', { username: osu_user.username }) : t(locale, 'link.link_error')
        );

    } catch (error) {
        console.error('Error en el comando link:', error);
        return t(locale, 'link.err_unexpected');
    }
}

run.description = {
    'header': t('es', 'commands.link.header'),
    'body': t('es', 'commands.link.body'),
    'usage': t('es', 'commands.link.usage')
};

module.exports = { run, description: run.description };