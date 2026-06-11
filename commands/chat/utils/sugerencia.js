const { WebhookClient } = require("discord.js");
const { getSetting, setSetting } = require("../../../models/BotSettingsModel.js");
const { doSuggestionReportEmbed } = require("../../../views/suggestionViews.js");
const { t } = require("../../../utils/i18n.js");

async function getForumTagId(client, webhookUrl, tagNames) {
    try {
        const match = webhookUrl.match(/\/webhooks\/(\d+)\//);
        if (!match) return null;
        
        const webhookId = match[1];
        const webhookData = await client.fetchWebhook(webhookId);
        if (!webhookData || !webhookData.channelId) return null;
        
        const channel = await client.channels.fetch(webhookData.channelId);
        if (channel && channel.availableTags && Array.isArray(channel.availableTags)) {
            const targetTag = channel.availableTags.find(t => 
                tagNames.includes(t.name.toLowerCase())
            );
            return targetTag ? targetTag.id : null;
        }
    } catch (err) {
        console.error(`[Webhook Tags] Error al buscar tags [${tagNames.join(', ')}]:`, err);
    }
    return null;
}

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

    let parsedTitle = null;
    let parsedBody = bodyText || null;

    if (bodyText) {
        if (bodyText.includes('\n')) {
            const lines = bodyText.split('\n');
            parsedTitle = lines[0].trim().substring(0, 100);
            parsedBody = lines.slice(1).join('\n').trim() || null;
        } else if (bodyText.length <= 100) {
            parsedTitle = bodyText;
            parsedBody = null;
        } else {
            const sentenceBoundary = bodyText.slice(0, 100).match(/[\.\?\!]\s/);
            if (sentenceBoundary && sentenceBoundary.index !== undefined) {
                const titleEnd = sentenceBoundary.index + 1;
                parsedTitle = bodyText.slice(0, titleEnd).trim();
                parsedBody = bodyText.slice(titleEnd).trim() || null;
            } else {
                let title = bodyText.slice(0, 80);
                const lastSpace = title.lastIndexOf(' ');
                if (lastSpace > 30) {
                    title = title.slice(0, lastSpace);
                }
                parsedTitle = title.trim() + '...';
                parsedBody = bodyText.slice(title.length).trim() || null;
            }
        }
    }

    try {
        const webhookClient = new WebhookClient({ url: webhookUrl });
        const embed = doSuggestionReportEmbed(
            message.author,
            message.guild,
            message.channel,
            new Date(),
            parsedTitle,
            parsedBody,
            repliedMessage,
            attachmentUrl
        );

        const client = message.client;
        const tagId = await getForumTagId(client, webhookUrl, ['feature', 'sugerencia', 'sugerencias']);

        const sendPayload = {
            username: "Sengo Suggestions",
            avatarURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
            embeds: [embed]
        };

        try {
            await webhookClient.send(sendPayload);
        } catch (webhookError) {
            if (webhookError.code === 220001) {
                const threadName = parsedTitle || `Sugerencia de ${message.author.username}`;
                sendPayload.threadName = threadName.substring(0, 100);
                if (tagId) {
                    sendPayload.appliedTags = [tagId];
                }
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
