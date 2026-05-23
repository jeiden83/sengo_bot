const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { getEmbedColor } = require("./osuViewHelpers.js");

function formatDurationText(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} día(s) ${hours % 24} hora(s)`;
    if (hours > 0) return `${hours} hora(s) ${minutes % 60} minuto(s)`;
    if (minutes > 0) return `${minutes} minuto(s) ${seconds % 60} segundo(s)`;
    return `${seconds} segundo(s)`;
}

/**
 * Genera el embed de previsualización para el creador.
 */
function getGiveawayPreviewEmbed({ prize, winnersCount, durationMs, targetChannelId }, message) {
    const embedColor = getEmbedColor(message);
    const durationText = formatDurationText(durationMs);

    return new EmbedBuilder()
        .setTitle("🛠️ Vista Previa del Sorteo")
        .setDescription(
            `Estás a punto de iniciar el siguiente sorteo:\n\n` +
            `▸ **Premio:** \`${prize}\`\n` +
            `▸ **Ganadores:** \`${winnersCount}\`\n` +
            `▸ **Duración:** \`${durationText}\`\n` +
            `▸ **Canal Destino:** <#${targetChannelId}>\n\n` +
            `*Usa los botones de abajo para editar los valores antes de confirmar o cancelar.*`
        )
        .setColor(embedColor)
        .setFooter({ text: "SengoBot Sorteos • Vista Previa" })
        .setTimestamp();
}

/**
 * Crea la botonera para la vista previa del sorteo.
 */
function getGiveawayPreviewButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("gw_preview_confirm")
            .setLabel("Confirmar")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("gw_preview_edit_title")
            .setLabel("Premio")
            .setEmoji("📝")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("gw_preview_edit_time")
            .setLabel("Tiempo")
            .setEmoji("⏳")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("gw_preview_edit_winners")
            .setLabel("Ganadores")
            .setEmoji("👥")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("gw_preview_cancel")
            .setLabel("Cancelar")
            .setEmoji("❌")
            .setStyle(ButtonStyle.Danger)
    );
}

/**
 * Genera el embed del sorteo activo enviado al canal de destino.
 */
function getGiveawayActiveEmbed(gw, creatorId, message) {
    const embedColor = getEmbedColor(message);
    const endTimestamp = Math.floor(gw.endAt / 1000);

    let desc = `Reacciona con 🎉 para participar en el sorteo.\n\n` +
        `▸ **Creado por:** <@${creatorId}>\n` +
        `▸ **Ganadores:** \`${gw.winnersCount}\`\n` +
        `▸ **Finaliza:** <t:${endTimestamp}:F> (<t:${endTimestamp}:R>)`;

    if (gw.serverSeedHash) {
        desc += `\n\n🛡️ **Hash de Validación (Fairness):**\n\`${gw.serverSeedHash}\`\n*Garantiza que el sorteo es inalterable y demostrablemente justo.*`;
    }

    return new EmbedBuilder()
        .setTitle(`🎉 ¡SORTEO: ${gw.prize}! 🎉`)
        .setDescription(desc)
        .setColor(embedColor)
        .setFooter({ text: `SengoBot Sorteos • ID: ${gw.messageId || 'Nuevo'}` })
        .setTimestamp();
}

/**
 * Genera el embed de sorteo finalizado.
 */
function getGiveawayEndedEmbed(gw, winners, message, wasOffline = false) {
    const embedColor = message ? getEmbedColor(message) : 0xfe66aa;
    let winnersText = winners.length > 0 ? winners.map(w => `<@${w}>`).join(", ") : "Ninguno (no hubo participantes)";
    if (wasOffline) {
        winnersText = "Ninguno (el sorteo finalizó con el bot desconectado)";
    }

    const footerText = wasOffline 
        ? `SengoBot Sorteos • ID: ${gw.messageId} • Finalizado offline`
        : `SengoBot Sorteos • ID: ${gw.messageId}`;

    let desc = `**Premio:** \`${gw.prize}\`\n` +
        `**Ganadores:** ${winnersText}\n\n`;

    if (gw.serverSeed) {
        desc += `🔑 **Semilla Revelada (Server Seed):**\n\`${gw.serverSeed}\`\n` +
            `🛡️ **Hash de Validación original:**\n\`${gw.serverSeedHash || ''}\`\n\n`;
    }

    desc += wasOffline 
        ? `*El sorteo ha finalizado mientras el bot estaba desconectado. El creador puede hacer re-roll para elegir ganadores.*`
        : `*El sorteo ha finalizado.*`;

    return new EmbedBuilder()
        .setTitle(`🎁 SORTEO FINALIZADO 🎁`)
        .setDescription(desc)
        .setColor(embedColor)
        .setFooter({ text: footerText })
        .setTimestamp();
}

/**
 * Genera el texto para anunciar los ganadores del sorteo.
 */
function getGiveawayEndedText(gw, winners) {
    if (winners.length > 0) {
        return `🎉 ¡Felicidades a los ganadores de **${gw.prize}**: ${winners.map(w => `<@${w}>`).join(", ")}!`;
    } else {
        return `😢 El sorteo por **${gw.prize}** finalizó pero nadie participó.`;
    }
}

/**
 * Genera el texto para el reroll de ganadores.
 */
function getGiveawayRerollText(gw, winners) {
    if (winners.length > 0) {
        return `🎲 **Reroll:** ¡Felicidades a los nuevos ganadores de **${gw.prize}**: ${winners.map(w => `<@${w}>`).join(", ")}! (Re-roleado desde el sorteo ID: \`${gw.messageId}\`)`;
    } else {
        return `🎲 **Reroll:** No se pudieron seleccionar ganadores para **${gw.prize}** porque nadie reaccionó.`;
    }
}

/**
 * Genera el Modal para editar el premio.
 */
function getTitleModal(currentPrize) {
    return new ModalBuilder()
        .setCustomId("gw_modal_title")
        .setTitle("Editar Premio del Sorteo")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("title_input")
                    .setLabel("Nuevo Título / Premio")
                    .setStyle(TextInputStyle.Short)
                    .setValue(currentPrize)
                    .setRequired(true)
            )
        );
}

/**
 * Genera el Modal para editar el tiempo.
 */
function getTimeModal(currentTimeStr) {
    return new ModalBuilder()
        .setCustomId("gw_modal_time")
        .setTitle("Editar Tiempo del Sorteo")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("time_input")
                    .setLabel("Duración (ej: 10s, 5m, 2h, 1d)")
                    .setStyle(TextInputStyle.Short)
                    .setValue(currentTimeStr)
                    .setRequired(true)
            )
        );
}

/**
 * Genera el Modal para editar ganadores.
 */
function getWinnersModal(currentWinners) {
    return new ModalBuilder()
        .setCustomId("gw_modal_winners")
        .setTitle("Editar Cantidad de Ganadores")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("winners_input")
                    .setLabel("Número de Ganadores")
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
    getGiveawayActiveEmbed,
    getGiveawayEndedEmbed,
    getGiveawayEndedText,
    getGiveawayRerollText,
    getTitleModal,
    getTimeModal,
    getWinnersModal
};
