const { PermissionsBitField, EmbedBuilder } = require('discord.js');
const { addWebhookChannel, deleteWebhookChannel, getWebhookChannels } = require('../../../db/database.js');
const { t } = require('../../../utils/i18n.js');

async function run(messages, args) {
    const { message, res, logger } = messages;
    const { Webhook } = res;
    const locale = message.locale || 'es';

    // 1. Caso especial: Flag secreto -l para el Owner
    if (args.includes('-l')) {
        if (message.author.id !== process.env.OWNER_ID) {
            return t(locale, 'github.err_owner_only');
        }

        try {
            if (logger) logger.process(t(locale, 'github.logging_list'));
            const channels = await getWebhookChannels(Webhook);

            if (channels.length === 0) {
                return t(locale, 'github.err_no_webhooks');
            }

            const embed = new EmbedBuilder()
                .setTitle(t(locale, 'github.embed_title'))
                .setColor("#24292e")
                .setTimestamp()
                .setFooter({ text: t(locale, 'github.embed_footer'), iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" });

            let description = "";
            channels.forEach((ch, index) => {
                description += `**${index + 1}.** Servidor: \`${ch.guild_name || t(locale, 'github.unknown_guild')}\` | Canal: <#${ch.channel_id}> (\`${ch.channel_id}\`)\n`;
            });
            embed.setDescription(description);

            return { embeds: [embed] };
        } catch (err) {
            console.error("Error al listar webhooks:", err);
            return t(locale, 'github.err_fetch_list', { error: `\`${err.message}\`` });
        }
    }

    // El comando normal requiere estar en un servidor
    if (!message.guild) {
        return t(locale, 'github.only_guild');
    }

    // 2. Comprobar permisos de administrador
    if (!message.member || !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return t(locale, 'github.no_admin');
    }

    const action = args[0] ? args[0].toLowerCase() : null;

    if (!action || (action !== 'colocar' && action !== 'borrar')) {
        return t(locale, 'github.invalid_action');
    }

    // 3. Obtener el canal (por mención, ID, o por defecto el canal actual)
    let targetChannel = message.channel;
    if (args[1]) {
        const channelId = args[1].replace(/[<#>]/g, '');
        const guildChannel = message.guild.channels.cache.get(channelId);
        if (guildChannel) {
            targetChannel = guildChannel;
        } else {
            return t(locale, 'github.channel_not_found');
        }
    }

    if (!targetChannel.isTextBased()) {
        return t(locale, 'github.not_text_channel');
    }

    if (action === 'colocar') {
        try {
            if (logger) logger.process(t(locale, 'github.logging_register', { channelId: targetChannel.id }));
            const dbResult = await addWebhookChannel(Webhook, targetChannel.id, message.guild.id, message.guild.name, targetChannel.name);
            
            if (dbResult.status === 1) {
                return t(locale, 'github.register_success', { channelId: targetChannel.id });
            } else {
                return t(locale, 'github.err_db_register');
            }
        } catch (err) {
            console.error("Error registrando canal de webhook:", err);
            return t(locale, 'github.err_register', { error: `\`${err.message}\`` });
        }
    }

    if (action === 'borrar') {
        try {
            if (logger) logger.process(t(locale, 'github.logging_delete', { channelId: targetChannel.id }));
            const dbResult = await deleteWebhookChannel(Webhook, targetChannel.id);
            
            if (dbResult.status === 1) {
                return t(locale, 'github.delete_success', { channelId: targetChannel.id });
            } else if (dbResult.status === 0) {
                return t(locale, 'github.delete_not_registered', { channelId: targetChannel.id });
            } else {
                return t(locale, 'github.err_db_delete');
            }
        } catch (err) {
            console.error("Error eliminando canal de webhook:", err);
            return t(locale, 'github.err_delete', { error: `\`${err.message}\`` });
        }
    }
}

run.description = {
    'header': t('es', 'commands.github.header'),
    'body': t('es', 'commands.github.body'),
    'usage': t('es', 'commands.github.usage')
};

module.exports = { run, description: run.description };
