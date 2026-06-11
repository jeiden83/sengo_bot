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

        // 1. Si se provee la palabra "unlink" o "desvincular"
        const isUnlink = args && args.some(arg => typeof arg === 'string' && (arg.toLowerCase() === 'unlink' || arg.toLowerCase() === 'desvincular'));
        
        // 2. Verificar si se solicitó explícitamente el flujo tradicional (chat)
        const isChat = args && args.some(arg => typeof arg === 'string' && arg.toLowerCase() === '-chat');

        // Manejo especial para Comandos Slash
        if (messages.isSlash && messages.interaction) {
            const interaction = messages.interaction;

            if (isUnlink) {
                if (logger) logger.process(t(locale, 'link.unlinking'));
                await OsuUserModel.unlinkUser(res.User, discord_id);
                await interaction.reply({ content: t(locale, 'link.unlink_success') });
                return true;
            }

            if (isChat) {
                const cleanArgs = args.filter(arg => typeof arg === 'string' && arg.toLowerCase() !== '-chat');
                const parsed_args = argsParserNoCommand(cleanArgs);

                if (parsed_args.username[0].length === 0) {
                    if (logger) logger.process(t(locale, 'link.unlinking_legacy'));
                    await OsuUserModel.unlinkUser(res.User, discord_id);
                    await interaction.reply({ content: t(locale, 'link.unlink_success_legacy', { username: message.author.username }) });
                    return true;
                }

                if (logger) logger.process(t(locale, 'link.fetching_user', { username: parsed_args.username[0] }));
                const osu_user = await OsuUserModel.getOsuUser(parsed_args);

                if (typeof osu_user === "string") {
                    await interaction.reply({ content: t(locale, 'link.user_not_exist', { username: parsed_args.username[0] }) });
                    return true;
                }

                if (logger) logger.process(t(locale, 'link.saving_link', { username: osu_user.username }));
                const resRecord = await OsuUserModel.linkUser(res.User, discord_id, osu_user.id, parsed_args.gamemode);
                const replyText = (resRecord.status === 1) ?
                    t(locale, 'link.link_success', { username: osu_user.username }) : t(locale, 'link.link_error');

                await interaction.reply({ content: replyText });
                return true;
            }

            // Flujo OAuth por defecto para Slash: efímero en el chat
            if (logger) logger.process(t(locale, 'link.generating_url'));
            const redirectUri = getRedirectUri();
            const authUrl = getAuthUrl(discord_id, redirectUri);
            const embed = doOsuOAuthEmbed(authUrl, message);

            await interaction.reply({ embeds: [embed], ephemeral: true });
            return true;
        }

        // Flujo para comandos de Chat (no slash)
        if (isUnlink) {
            if (logger) logger.process(t(locale, 'link.unlinking'));
            await OsuUserModel.unlinkUser(res.User, discord_id);
            return t(locale, 'link.unlink_success');
        }

        if (isChat) {
            // Filtrar el flag -chat de los argumentos
            const cleanArgs = args.filter(arg => typeof arg === 'string' && arg.toLowerCase() !== '-chat');
            const parsed_args = argsParserNoCommand(cleanArgs);

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
        }

        // Flujo OAuth por defecto para Chat: envía DM
        if (logger) logger.process(t(locale, 'link.generating_url'));
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