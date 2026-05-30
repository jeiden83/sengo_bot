const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { getEmbedColor } = require("./osuViewHelpers.js");
const { t } = require("../utils/i18n.js");

function formatDurationText(ms, locale) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return t(locale, 'giveaway.duration_days', { days, hours: hours % 24 });
    if (hours > 0) return t(locale, 'giveaway.duration_hours', { hours, minutes: minutes % 60 });
    if (minutes > 0) return t(locale, 'giveaway.duration_minutes', { minutes, seconds: seconds % 60 });
    return t(locale, 'giveaway.duration_seconds', { seconds });
}

/**
 * Genera el embed de previsualización para el creador.
 */
function getGiveawayPreviewEmbed({ prize, winnersCount, durationMs, targetChannelId, requiredRoleId, allowHigherRoles, blockOsuSupporters, blockNitro }, message, locale) {
    const embedColor = getEmbedColor(message);
    const durationText = formatDurationText(durationMs, locale);

    let reqsText = "";
    if (requiredRoleId) {
        const higherStr = allowHigherRoles ? t(locale, 'giveaway.allow_higher_yes') : t(locale, 'giveaway.allow_higher_no');
        reqsText += `\n▸ **${t(locale, 'giveaway.role_required_label')}:** <@&${requiredRoleId}> ${higherStr}`;
    }
    if (blockOsuSupporters) {
        reqsText += `\n▸ **${t(locale, 'giveaway.exclude_supp_label')}:** ${t(locale, 'giveaway.exclude_supp_yes')}`;
    }
    if (blockNitro) {
        reqsText += `\n▸ **${t(locale, 'giveaway.exclude_nitro_label')}:** ${t(locale, 'giveaway.exclude_nitro_yes')}`;
    }
    if (!reqsText) {
        reqsText = `\n▸ **${t(locale, 'giveaway.reqs_header_label')}:** ${t(locale, 'giveaway.req_none')}`;
    }

    return new EmbedBuilder()
        .setTitle(t(locale, 'giveaway.preview_title'))
        .setDescription(
            t(locale, 'giveaway.preview_desc_intro') +
            `▸ **${t(locale, 'giveaway.prize_label')}:** \`${prize}\`\n` +
            `▸ **${t(locale, 'giveaway.winners_label')}:** \`${winnersCount}\`\n` +
            `▸ **${t(locale, 'giveaway.duration_label')}:** \`${durationText}\`\n` +
            `▸ **${t(locale, 'giveaway.channel_label')}:** <#${targetChannelId}>\n` +
            reqsText +
            t(locale, 'giveaway.preview_footer_desc')
        )
        .setColor(embedColor)
        .setFooter({ text: t(locale, 'giveaway.preview_footer') })
        .setTimestamp();
}

/**
 * Crea la botonera para la vista previa del sorteo.
 */
function getGiveawayPreviewButtons(locale) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("gw_preview_confirm")
            .setLabel(t(locale, 'giveaway.btn_confirm'))
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("gw_preview_edit_title")
            .setLabel(t(locale, 'giveaway.btn_prize'))
            .setEmoji("📝")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("gw_preview_edit_time")
            .setLabel(t(locale, 'giveaway.btn_duration'))
            .setEmoji("⏳")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("gw_preview_edit_winners")
            .setLabel(t(locale, 'giveaway.btn_winners'))
            .setEmoji("👥")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("gw_preview_cancel")
            .setLabel(t(locale, 'giveaway.btn_cancel'))
            .setEmoji("❌")
            .setStyle(ButtonStyle.Danger)
    );
}

/**
 * Crea ActionRows en doble fila para una vista de previsualización más completa (incluyendo requisitos).
 */
function getGiveawayPreviewComponents(locale) {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("gw_preview_confirm")
            .setLabel(t(locale, 'giveaway.btn_confirm'))
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("gw_preview_cancel")
            .setLabel(t(locale, 'giveaway.btn_cancel'))
            .setEmoji("❌")
            .setStyle(ButtonStyle.Danger)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("gw_preview_edit_title")
            .setLabel(t(locale, 'giveaway.btn_prize'))
            .setEmoji("📝")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("gw_preview_edit_time")
            .setLabel(t(locale, 'giveaway.btn_duration'))
            .setEmoji("⏳")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("gw_preview_edit_winners")
            .setLabel(t(locale, 'giveaway.btn_winners'))
            .setEmoji("👥")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("gw_preview_edit_reqs")
            .setLabel(t(locale, 'giveaway.btn_reqs'))
            .setEmoji("⚙️")
            .setStyle(ButtonStyle.Primary)
    );

    return [row1, row2];
}

/**
 * Genera el Modal para configurar requisitos del sorteo.
 */
function getRequirementsModal(roleInput, higherInput, suppInput, nitroInput, locale) {
    const modal = new ModalBuilder()
        .setCustomId('gw_modal_reqs')
        .setTitle(t(locale, 'giveaway.modal_reqs_title'));

    const roleField = new TextInputBuilder()
        .setCustomId('req_role_input')
        .setLabel(t(locale, 'giveaway.role_field_label'))
        .setStyle(TextInputStyle.Short)
        .setValue(roleInput || '')
        .setRequired(false)
        .setPlaceholder(t(locale, 'giveaway.role_field_placeholder'));

    const higherField = new TextInputBuilder()
        .setCustomId('req_higher_input')
        .setLabel(t(locale, 'giveaway.higher_field_label'))
        .setStyle(TextInputStyle.Short)
        .setValue(higherInput || 'NO')
        .setRequired(false)
        .setMaxLength(3);

    const suppField = new TextInputBuilder()
        .setCustomId('req_supp_input')
        .setLabel(t(locale, 'giveaway.supp_field_label'))
        .setStyle(TextInputStyle.Short)
        .setValue(suppInput || 'NO')
        .setRequired(false)
        .setMaxLength(3);

    const nitroField = new TextInputBuilder()
        .setCustomId('req_nitro_input')
        .setLabel(t(locale, 'giveaway.nitro_field_label'))
        .setStyle(TextInputStyle.Short)
        .setValue(nitroInput || 'NO')
        .setRequired(false)
        .setMaxLength(3);

    const r1 = new ActionRowBuilder().addComponents(roleField);
    const r2 = new ActionRowBuilder().addComponents(higherField);
    const r3 = new ActionRowBuilder().addComponents(suppField);
    const r4 = new ActionRowBuilder().addComponents(nitroField);

    modal.addComponents(r1, r2, r3, r4);
    return modal;
}

/**
 * Genera el embed del sorteo activo enviado al canal de destino.
 */
function getGiveawayActiveEmbed(gw, creatorId, message, locale) {
    const embedColor = getEmbedColor(message);
    const endTimestamp = Math.floor(gw.endAt / 1000);

    let desc = t(locale, 'giveaway.active_desc_react') +
        `▸ **${t(locale, 'giveaway.created_by_label')}:** <@${creatorId}>\n` +
        `▸ **${t(locale, 'giveaway.winners_label')}:** \`${gw.winnersCount}\`\n` +
        `▸ **${t(locale, 'giveaway.ends_label')}:** <t:${endTimestamp}:F> (<t:${endTimestamp}:R>)`;

    let reqsText = "";
    if (gw.requiredRoleId) {
        const higherStr = gw.allowHigherRoles ? t(locale, 'giveaway.allow_higher_yes') : t(locale, 'giveaway.allow_higher_no');
        reqsText += `\n▸ **${t(locale, 'giveaway.role_required_label')}:** <@&${gw.requiredRoleId}> ${higherStr}`;
    }
    if (gw.blockOsuSupporters) {
        reqsText += `\n▸ **${t(locale, 'giveaway.exclude_supp_label')}:** ${t(locale, 'giveaway.exclude_supp_yes')}`;
    }
    if (gw.blockNitro) {
        reqsText += `\n▸ **${t(locale, 'giveaway.exclude_nitro_label')}:** ${t(locale, 'giveaway.exclude_nitro_yes')}`;
    }
    if (reqsText) {
        desc += `${t(locale, 'giveaway.reqs_participation_title')}${reqsText}`;
    }

    if (gw.serverSeedHash) {
        desc += t(locale, 'giveaway.fairness_validation_title', { hash: gw.serverSeedHash });
    }

    const titleText = t(locale, 'giveaway.active_title', { prize: gw.prize });
    const footerText = t(locale, 'giveaway.active_footer', { messageId: gw.messageId || 'Nuevo' });

    return new EmbedBuilder()
        .setTitle(titleText)
        .setDescription(desc)
        .setColor(embedColor)
        .setFooter({ text: footerText })
        .setTimestamp();
}

/**
 * Genera el embed de sorteo finalizado.
 */
function getGiveawayEndedEmbed(gw, winners, message, wasOffline = false, locale) {
    const embedColor = message ? getEmbedColor(message) : 0xfe66aa;
    let winnersText = winners.length > 0 ? winners.map(w => `<@${w}>`).join(", ") : t(locale, 'giveaway.winners_none');
    if (wasOffline) {
        winnersText = t(locale, 'giveaway.winners_none_offline');
    }

    const footerText = wasOffline 
        ? t(locale, 'giveaway.ended_footer_offline', { messageId: gw.messageId })
        : t(locale, 'giveaway.ended_footer', { messageId: gw.messageId });

    let desc = `**${t(locale, 'giveaway.prize_label')}:** \`${gw.prize}\`\n` +
        `**${t(locale, 'giveaway.winners_label')}:** ${winnersText}\n\n`;

    let reqsText = "";
    if (gw.requiredRoleId) {
        const higherStr = gw.allowHigherRoles ? t(locale, 'giveaway.allow_higher_yes') : t(locale, 'giveaway.allow_higher_no');
        reqsText += `\n▸ **${t(locale, 'giveaway.role_required_label')}:** <@&${gw.requiredRoleId}> ${higherStr}`;
    }
    if (gw.blockOsuSupporters) {
        reqsText += `\n▸ **${t(locale, 'giveaway.exclude_supp_label')}:** ${t(locale, 'giveaway.exclude_supp_yes')}`;
    }
    if (gw.blockNitro) {
        reqsText += `\n▸ **${t(locale, 'giveaway.exclude_nitro_label')}:** ${t(locale, 'giveaway.exclude_nitro_yes')}`;
    }
    if (reqsText) {
        desc += `🛡️ **${t(locale, 'giveaway.reqs_header_label')}:**${reqsText}\n\n`;
    }

    if (gw.exclusions && gw.exclusions.length > 0) {
        if (gw.exclusions.length <= 5) {
            let exclusionsLines = gw.exclusions.map(ex => `• <@${ex.userId}>: *${ex.reason}*`).join("\n");
            desc += t(locale, 'giveaway.exclusions_title', { count: gw.exclusions.length }) + `${exclusionsLines}\n\n`;
        } else {
            desc += t(locale, 'giveaway.exclusions_many', { count: gw.exclusions.length });
        }
    }

    if (gw.serverSeed) {
        const checkUrl = `https://codebeautify.org/sha256-hash-generator?input=${encodeURIComponent(gw.serverSeed)}`;
        desc += t(locale, 'giveaway.server_seed_revelation', { seed: gw.serverSeed, hash: gw.serverSeedHash || '', url: checkUrl });
    }

    desc += wasOffline 
        ? t(locale, 'giveaway.ended_offline_desc')
        : t(locale, 'giveaway.ended_desc');

    return new EmbedBuilder()
        .setTitle(t(locale, 'giveaway.ended_title'))
        .setDescription(desc)
        .setColor(embedColor)
        .setFooter({ text: footerText })
        .setTimestamp();
}

/**
 * Genera el texto para anunciar los ganadores del sorteo.
 */
function getGiveawayEndedText(gw, winners, locale) {
    if (winners.length > 0) {
        const winList = winners.map(w => `<@${w}>`).join(", ");
        return t(locale, 'giveaway.ended_text_winners', { prize: gw.prize, winners: winList });
    } else {
        return t(locale, 'giveaway.ended_text_none', { prize: gw.prize });
    }
}

/**
 * Genera el texto para el reroll de ganadores.
 */
function getGiveawayRerollText(gw, winners, locale) {
    if (winners.length > 0) {
        const winList = winners.map(w => `<@${w}>`).join(", ");
        return t(locale, 'giveaway.reroll_text_winners', { prize: gw.prize, winners: winList, messageId: gw.messageId });
    } else {
        return t(locale, 'giveaway.reroll_text_none', { prize: gw.prize });
    }
}

/**
 * Genera el Modal para editar el premio.
 */
function getTitleModal(currentPrize, locale) {
    return new ModalBuilder()
        .setCustomId("gw_modal_title")
        .setTitle(t(locale, 'giveaway.modal_prize_title'))
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("title_input")
                    .setLabel(t(locale, 'giveaway.prize_field_label'))
                    .setStyle(TextInputStyle.Short)
                    .setValue(currentPrize)
                    .setRequired(true)
            )
        );
}

/**
 * Genera el Modal para editar el tiempo.
 */
function getTimeModal(currentTimeStr, locale) {
    return new ModalBuilder()
        .setCustomId("gw_modal_time")
        .setTitle(t(locale, 'giveaway.modal_time_title'))
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("time_input")
                    .setLabel(t(locale, 'giveaway.time_field_label'))
                    .setStyle(TextInputStyle.Short)
                    .setValue(currentTimeStr)
                    .setRequired(true)
            )
        );
}

/**
 * Genera el Modal para editar ganadores.
 */
function getWinnersModal(currentWinners, locale) {
    return new ModalBuilder()
        .setCustomId("gw_modal_winners")
        .setTitle(t(locale, 'giveaway.modal_winners_title'))
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("winners_input")
                    .setLabel(t(locale, 'giveaway.winners_field_label'))
                    .setStyle(TextInputStyle.Short)
                    .setValue(currentWinners.toString())
                    .setRequired(true)
            )
        );
}

module.exports = {
    formatDurationText,
    getGiveawayPreviewEmbed,
    getGiveawayPreviewButtons,
    getGiveawayPreviewComponents,
    getRequirementsModal,
    getGiveawayActiveEmbed,
    getGiveawayEndedEmbed,
    getGiveawayEndedText,
    getGiveawayRerollText,
    getTitleModal,
    getTimeModal,
    getWinnersModal
};
