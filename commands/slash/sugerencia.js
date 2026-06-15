const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, WebhookClient } = require("discord.js");
const { getSetting } = require("../../models/BotSettingsModel.js");
const { doSuggestionReportEmbed } = require("../../views/suggestionViews.js");
const { t } = require("../../utils/i18n.js");

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

const data = new SlashCommandBuilder()
    .setName("sugerencia")
    .setDescription("Enviar una sugerencia para el bot / Submit a suggestion for the bot")
    .addAttachmentOption(option =>
        option
            .setName("foto")
            .setDescription("Adjuntar una imagen o captura de pantalla / Attach an image or screenshot (Optional)")
            .setRequired(false)
    );

async function run(interaction, res) {
    const locale = interaction.resolvedLocale || 'es';

    // 1. Obtener webhook URL de la base de datos
    const webhookUrl = await getSetting('suggestion_webhook_url');
    if (!webhookUrl) {
        await interaction.reply({
            content: t(locale, 'sugerencia.err_no_webhook_set'),
            ephemeral: true
        });
        return true;
    }

    // 2. Construir el modal (formulario)
    const modal = new ModalBuilder()
        .setCustomId("suggestion_modal")
        .setTitle(t(locale, 'sugerencia.modal_title'));

    const titleInput = new TextInputBuilder()
        .setCustomId("suggestion_title")
        .setLabel(t(locale, 'sugerencia.modal_title_label'))
        .setPlaceholder(t(locale, 'sugerencia.modal_title_placeholder'))
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(100);

    const bodyInput = new TextInputBuilder()
        .setCustomId("suggestion_body")
        .setLabel(t(locale, 'sugerencia.modal_body_label'))
        .setPlaceholder(t(locale, 'sugerencia.modal_body_placeholder'))
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1000);

    const firstActionRow = new ActionRowBuilder().addComponents(titleInput);
    const secondActionRow = new ActionRowBuilder().addComponents(bodyInput);

    modal.addComponents(firstActionRow, secondActionRow);

    // 3. Mostrar el formulario al usuario
    await interaction.showModal(modal);

    // 4. Esperar la sumisión del modal
    let modalSubmit = null;
    try {
        modalSubmit = await interaction.awaitModalSubmit({
            filter: i => i.customId === 'suggestion_modal' && i.user.id === interaction.user.id,
            time: 300000 // 5 minutos
        });

        // Deferir respuesta del modalSubmit para evitar expiración
        await modalSubmit.deferReply({ ephemeral: true });

        const title = modalSubmit.fields.getTextInputValue("suggestion_title")?.trim() || null;
        const body = modalSubmit.fields.getTextInputValue("suggestion_body")?.trim() || null;
        
        // Obtener la foto de la interacción original
        const fotoOption = interaction.options.getAttachment("foto");
        const attachmentUrl = fotoOption ? fotoOption.url : null;

        // Comprobar que no esté todo vacío
        if (!title && !body && !attachmentUrl) {
            await modalSubmit.editReply({
                content: t(locale, 'sugerencia.err_empty_report')
            });
            return true;
        }

        // 5. Enviar el reporte al webhook
        const webhookClient = new WebhookClient({ url: webhookUrl });
        const embed = doSuggestionReportEmbed(
            interaction.user,
            interaction.guild,
            interaction.channel,
            new Date(),
            title,
            body,
            null, // No hay mensaje respondido en slash commands
            attachmentUrl
        );

        const client = interaction.client;
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
                const threadName = title ? title : `Sugerencia de ${interaction.user.username}`;
                sendPayload.threadName = threadName.substring(0, 100);
                if (tagId) {
                    sendPayload.appliedTags = [tagId];
                }
                await webhookClient.send(sendPayload);
            } else {
                throw webhookError;
            }
        }

        await modalSubmit.editReply({
            content: t(locale, 'sugerencia.report_sent')
        });

    } catch (err) {
        if (err.code === 'InteractionCollectorError') {
            console.warn("El modal de sugerencia expiró sin respuesta del usuario.");
        } else {
            console.error("Error al procesar el modal de sugerencia:", err);
            
            const isWebhookError = err.code === 10015 || (err.message && err.message.toLowerCase().includes("unknown webhook")) || err.status === 404;
            const errorMsg = isWebhookError ? t(locale, 'sugerencia.err_webhook_invalid') : t(locale, 'sugerencia.err_send_failed');

            // Intentar responder amigablemente si ocurre otro error
            try {
                if (modalSubmit && (modalSubmit.deferred || modalSubmit.replied)) {
                    await modalSubmit.editReply({ content: errorMsg });
                } else {
                    await interaction.followUp({
                        content: errorMsg,
                        ephemeral: true
                    });
                }
            } catch (e) {
                console.error("Error al enviar fallback de error en /sugerencia:", e);
            }

            if (!isWebhookError) {
                // Reportar al webhook de errores
                try {
                    const { reportErrorToWebhook } = require("../../services/errorNotifier.js");
                    reportErrorToWebhook(err, {
                        commandName: 'slash_sugerencia',
                        args: [],
                        user: interaction.user,
                        guild: interaction.guild,
                        channel: interaction.channel,
                        interaction: interaction
                    });
                } catch (notifierErr) {
                    console.error("Error al intentar reportar el fallo al webhook de errores:", notifierErr);
                }
            }
        }
    }

    return true; // Auto-gestionado
}

module.exports = { data, run, noDefer: true, description: "Enviar una sugerencia / Submit a suggestion" };
