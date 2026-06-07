const { WebhookClient } = require("discord.js");
const { getSetting, setSetting } = require("../../../models/BotSettingsModel.js");
const { doSuggestionReportEmbed } = require("../../../views/suggestionViews.js");
const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message } = messages;
    const locale = message.locale || 'es';

    // 1. Configurar Webhook (solo Owner)
    if (args[0] === '-webhook') {
        if (message.author.id !== process.env.OWNER_ID) {
            return t(locale, 'sugerencia.err_owner_only');
        }

        const url = args[1];
        if (!url || !/^https?:\/\/(?:ptb\.|canary\.)?discord\.com\/api\/(?:v\d{1,2}\/)?webhooks\/\d{17,19}\/[\w-]{68}\/?$/i.test(url.trim())) {
            return t(locale, 'sugerencia.err_invalid_webhook');
        }

        try {
            await setSetting('suggestion_webhook_url', url.trim());
            return t(locale, 'sugerencia.webhook_configured');
        } catch (err) {
            console.error("Error al guardar el webhook de sugerencia:", err);
            return t(locale, 'general.error_unexpected');
        }
    }

    // 2. Reportar sugerencia normal
    const webhookUrl = await getSetting('suggestion_webhook_url');
    if (!webhookUrl) {
        return t(locale, 'sugerencia.err_no_webhook_set');
    }

    const bodyText = args.join(' ').trim();
    const attachment = message.attachments.first();
    const attachmentUrl = attachment ? attachment.url : null;
    const repliedMessage = messages.reply;

    // Validar que no esté vacío
    if (!bodyText && !attachmentUrl && !repliedMessage) {
        return t(locale, 'sugerencia.err_empty_report');
    }

    try {
        const webhookClient = new WebhookClient({ url: webhookUrl });
        const embed = doSuggestionReportEmbed(
            message.author,
            message.guild,
            message.channel,
            new Date(),
            null, // Título opcional
            bodyText || null,
            repliedMessage,
            attachmentUrl
        );

        const sendPayload = {
            username: "Sengo Suggestions",
            avatarURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
            embeds: [embed]
        };

        try {
            await webhookClient.send(sendPayload);
        } catch (webhookError) {
            if (webhookError.code === 220001) {
                sendPayload.threadName = `Sugerencia de ${message.author.username}`.substring(0, 100);
                await webhookClient.send(sendPayload);
            } else {
                throw webhookError;
            }
        }

        return t(locale, 'sugerencia.report_sent');
    } catch (err) {
        console.error("Error al enviar la sugerencia al webhook:", err);
        try {
            const { reportErrorToWebhook } = require("../../../services/errorNotifier.js");
            reportErrorToWebhook(err, {
                commandName: 'sugerencia',
                args: args,
                user: message.author,
                guild: message.guild,
                channel: message.channel,
                message: message
            });
        } catch (notifierErr) {
            console.error("Error al intentar reportar el fallo al webhook de errores:", notifierErr);
        }
        return t(locale, 'sugerencia.err_send_failed');
    }
}

run.alias = {
    'feat': {
        'args': ''
    }
};

run.description = {
    'header': t('es', 'commands.sugerencia.header'),
    'body': t('es', 'commands.sugerencia.body'),
    'usage': t('es', 'commands.sugerencia.usage')
};

module.exports = { run, description: run.description };
