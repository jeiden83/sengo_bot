const { WebhookClient } = require("discord.js");
const { getSetting, setSetting } = require("../../../models/BotSettingsModel.js");
const { doBugReportEmbed } = require("../../../views/bugViews.js");
const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message } = messages;
    const locale = message.locale || 'es';

    // 1. Configurar Webhook (solo Owner)
    if (args[0] === '-webhook') {
        if (message.author.id !== process.env.OWNER_ID) {
            return t(locale, 'bug.err_owner_only');
        }

        const url = args[1];
        if (!url || !/^https:\/\/(?:ptb\.|canary\.)?discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9-_]+$/.test(url.trim())) {
            return t(locale, 'bug.err_invalid_webhook');
        }

        try {
            await setSetting('bug_webhook_url', url.trim());
            return t(locale, 'bug.webhook_configured');
        } catch (err) {
            console.error("Error al guardar el webhook de bug:", err);
            return t(locale, 'general.error_unexpected');
        }
    }

    // 2. Reportar bug normal
    const webhookUrl = await getSetting('bug_webhook_url');
    if (!webhookUrl) {
        return t(locale, 'bug.err_no_webhook_set');
    }

    const bodyText = args.join(' ').trim();
    const attachment = message.attachments.first();
    const attachmentUrl = attachment ? attachment.url : null;
    const repliedMessage = messages.reply;

    // Validar que no esté vacío
    if (!bodyText && !attachmentUrl && !repliedMessage) {
        return t(locale, 'bug.err_empty_report');
    }

    try {
        const webhookClient = new WebhookClient({ url: webhookUrl });
        const embed = doBugReportEmbed(
            message.author,
            message.guild,
            message.channel,
            new Date(),
            null, // Título opcional en chat command no hay
            bodyText || null,
            repliedMessage,
            attachmentUrl
        );

        await webhookClient.send({
            username: "Sengo Bug Reporter",
            avatarURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
            embeds: [embed]
        });

        return t(locale, 'bug.report_sent');
    } catch (err) {
        console.error("Error al enviar el reporte de bug al webhook:", err);
        return t(locale, 'bug.err_send_failed');
    }
}

run.description = {
    'header': t('es', 'commands.bug.header'),
    'body': t('es', 'commands.bug.body'),
    'usage': t('es', 'commands.bug.usage')
};

module.exports = { run, description: run.description };
