const { PermissionsBitField, Collection } = require("discord.js");
const { parseDuration } = require("../../../models/GiveawayModel.js");
const {
    getGiveawayPreviewEmbed,
    getGiveawayPreviewButtons,
    getGiveawayActiveEmbed,
    getTitleModal,
    getTimeModal,
    getWinnersModal
} = require("../../../views/giveawayViews.js");

function parseDurationLocal(str) {
    const match = str.match(/^(\d+)([smhd])$/i);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    switch (unit) {
        case 's': return value * 1000;
        case 'm': return value * 60000;
        case 'h': return value * 3600000;
        case 'd': return value * 86400000;
        default: return null;
    }
}

async function run(messages, args) {
    const { message } = messages;

    if (!message.guild) {
        return "❌ Este comando solo se puede usar en un servidor.";
    }

    // Verificar permisos de moderación
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages) && 
        !message.member.permissions.has(PermissionsBitField.Flags.ManageGuild) && 
        !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return "❌ No tienes permisos para gestionar sorteos. Se requiere `Gestionar Mensajes`, `Gestionar Servidor` o `Administrador`.";
    }

    const sub = args[0]?.toLowerCase();
    if (!sub || !['crear', 'create', 'terminar', 'end', 'reroll'].includes(sub)) {
        const prefix = message.content.startsWith("sd.") ? "sd." : "s.";
        const trigger = message.content.slice(prefix.length).split(/\s+/)[0].toLowerCase() || "giveaway";
        
        const { doHelpCommandEmbed } = require("../../../views/generalViews.js");
        
        const helpData = {
            headerText: "Gestión de sorteos interactiva",
            fields: [
                {
                    name: "📝 Descripción",
                    value: "Permite crear, terminar y re-rolear sorteos en el servidor.",
                    inline: false
                },
                {
                    name: "❓ Cómo usarlo",
                    value: `\`\`\`\n${prefix}${trigger} crear <#canal> <ganadores> <tiempo> <premio>\n${prefix}${trigger} terminar <mensaje_id|enlace>\n${prefix}${trigger} reroll <mensaje_id|enlace>\n\`\`\``,
                    inline: false
                },
                {
                    name: "🔗 Alias",
                    value: "`sorteo`",
                    inline: true
                }
            ]
        };

        const embed = doHelpCommandEmbed(message, "giveaway", trigger, helpData);
        return { embeds: [embed] };
    }

    // 1. SUBCOMANDO CREAR
    if (sub === 'crear' || sub === 'create') {
        const channelArg = args[1];
        const winnersArg = args[2];
        let timeArg = args[3];
        let prize = args.slice(4).join(" ");

        if (!channelArg || !winnersArg || !timeArg || !prize) {
            return "❌ Parámetros insuficientes.\n> Uso: `s.giveaway crear <#canal> <ganadores> <tiempo> <premio>`\n> Ejemplo: `s.giveaway crear #sorteos 1 10m Nitro`";
        }

        const channelIdMatch = channelArg.match(/<#?(\d+)>/) || channelArg.match(/^(\d+)$/);
        const targetChannelId = channelIdMatch ? channelIdMatch[1] : null;
        const targetChannel = targetChannelId ? message.guild.channels.cache.get(targetChannelId) : null;
        if (!targetChannel) {
            return "❌ Canal inválido. Asegúrate de mencionar el canal o usar una ID válida.";
        }

        let winnersCount = parseInt(winnersArg, 10);
        if (isNaN(winnersCount) || winnersCount <= 0) {
            return "❌ La cantidad de ganadores debe ser un número entero positivo.";
        }

        let durationMs = parseDurationLocal(timeArg);
        if (!durationMs) {
            return "❌ Formato de tiempo inválido. Usa formatos como `30s`, `10m`, `2h`, `1d`.";
        }

        // Enviar embed de prueba/vista previa con botones interactivos
        const previewEmbed = getGiveawayPreviewEmbed({ prize, winnersCount, durationMs, targetChannelId }, message);
        const buttons = getGiveawayPreviewButtons();

        const previewMsg = await message.channel.send({
            embeds: [previewEmbed],
            components: [buttons]
        });

        const filter = i => i.user.id === message.author.id;
        const collector = previewMsg.createMessageComponentCollector({
            filter,
            time: 120000 // 2 minutos
        });

        collector.on('collect', async i => {
            try {
                if (i.customId === 'gw_preview_confirm') {
                    collector.stop('confirmed');
                    await i.deferUpdate();

                    const activeEmbed = getGiveawayActiveEmbed({ prize, winnersCount, endAt: Date.now() + durationMs }, message.author.id, message);
                    const activeMsg = await targetChannel.send({ embeds: [activeEmbed] });
                    await activeMsg.react("🎉");

                    const { createGiveaway } = require("../../../models/GiveawayModel.js");
                    createGiveaway(message.client, {
                        guildId: message.guild.id,
                        channelId: targetChannel.id,
                        messageId: activeMsg.id,
                        prize,
                        winnersCount,
                        durationMs
                    });

                    // Editar el sorteo activo para mostrar la ID real en el footer
                    const activeEmbedWithId = getGiveawayActiveEmbed({ prize, winnersCount, endAt: Date.now() + durationMs, messageId: activeMsg.id }, message.author.id, message);
                    await activeMsg.edit({ embeds: [activeEmbedWithId] }).catch(() => {});

                    await previewMsg.edit({
                        content: `✅ ¡Sorteo iniciado en <#${targetChannelId}>!`,
                        embeds: [],
                        components: []
                    });
                } else if (i.customId === 'gw_preview_cancel') {
                    collector.stop('cancelled');
                    await i.deferUpdate();
                    await previewMsg.edit({
                        content: "❌ Sorteo cancelado.",
                        embeds: [],
                        components: []
                    });
                } else if (i.customId === 'gw_preview_edit_title') {
                    const modal = getTitleModal(prize);
                    await i.showModal(modal);

                    try {
                        const modalSubmit = await i.awaitModalSubmit({
                            filter: ms => ms.customId === 'gw_modal_title' && ms.user.id === message.author.id,
                            time: 60000
                        });
                        await modalSubmit.deferUpdate();
                        prize = modalSubmit.fields.getTextInputValue('title_input');
                        
                        const updatedEmbed = getGiveawayPreviewEmbed({ prize, winnersCount, durationMs, targetChannelId }, message);
                        await previewMsg.edit({ embeds: [updatedEmbed] });
                    } catch (err) {
                        console.error("Error modal título:", err);
                    }
                } else if (i.customId === 'gw_preview_edit_time') {
                    const modal = getTimeModal(timeArg);
                    await i.showModal(modal);

                    try {
                        const modalSubmit = await i.awaitModalSubmit({
                            filter: ms => ms.customId === 'gw_modal_time' && ms.user.id === message.author.id,
                            time: 60000
                        });
                        const newTimeArg = modalSubmit.fields.getTextInputValue('time_input');
                        const newDurationMs = parseDurationLocal(newTimeArg);
                        if (newDurationMs) {
                            await modalSubmit.deferUpdate();
                            durationMs = newDurationMs;
                            timeArg = newTimeArg;
                            const updatedEmbed = getGiveawayPreviewEmbed({ prize, winnersCount, durationMs, targetChannelId }, message);
                            await previewMsg.edit({ embeds: [updatedEmbed] });
                        } else {
                            await modalSubmit.reply({ content: "❌ Formato de tiempo inválido. Usa `10s`, `5m`, `2h`, `1d`.", ephemeral: true });
                        }
                    } catch (err) {
                        console.error("Error modal tiempo:", err);
                    }
                } else if (i.customId === 'gw_preview_edit_winners') {
                    const modal = getWinnersModal(winnersCount);
                    await i.showModal(modal);

                    try {
                        const modalSubmit = await i.awaitModalSubmit({
                            filter: ms => ms.customId === 'gw_modal_winners' && ms.user.id === message.author.id,
                            time: 60000
                        });
                        const newWinnersStr = modalSubmit.fields.getTextInputValue('winners_input');
                        const newWinnersCount = parseInt(newWinnersStr, 10);
                        if (!isNaN(newWinnersCount) && newWinnersCount > 0) {
                            await modalSubmit.deferUpdate();
                            winnersCount = newWinnersCount;
                            const updatedEmbed = getGiveawayPreviewEmbed({ prize, winnersCount, durationMs, targetChannelId }, message);
                            await previewMsg.edit({ embeds: [updatedEmbed] });
                        } else {
                            await modalSubmit.reply({ content: "❌ La cantidad de ganadores debe ser un número entero positivo.", ephemeral: true });
                        }
                    } catch (err) {
                        console.error("Error modal ganadores:", err);
                    }
                }
            } catch (err) {
                console.error("Error en colector de botones de sorteo:", err);
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason !== 'confirmed' && reason !== 'cancelled') {
                try {
                    await previewMsg.edit({
                        content: "⏳ Tiempo de configuración agotado.",
                        embeds: [],
                        components: []
                    });
                } catch {}
            }
        });

        return;
    }

    const { argsParserNoCommand } = require("../../utils/argsParser.js");
    const parsedArgs = argsParserNoCommand(args);

    // 2. SUBCOMANDO TERMINAR / END
    if (sub === 'terminar' || sub === 'end') {
        const messageId = parsedArgs.discordMessageId;
        if (!messageId) {
            return "❌ Debes proporcionar una ID de mensaje o un enlace de mensaje de sorteo válido.";
        }

        const { endGiveaway } = require("../../../models/GiveawayModel.js");
        const gw = await endGiveaway(message.client, messageId);
        if (!gw) {
            return "❌ No se encontró ningún sorteo activo registrado con esa ID de mensaje.";
        }
        return `🎁 ¡Sorteo terminado inmediatamente!`;
    }

    // 3. SUBCOMANDO REROLL
    if (sub === 'reroll') {
        const messageId = parsedArgs.discordMessageId;
        if (!messageId) {
            return "❌ Debes proporcionar una ID de mensaje o un enlace de mensaje de sorteo válido.";
        }

        const { rerollGiveaway } = require("../../../models/GiveawayModel.js");
        const result = await rerollGiveaway(message.client, messageId);
        if (result.error) {
            return `❌ ${result.error}`;
        }
        return `🎲 ¡Se ha realizado el re-roll del sorteo con éxito!`;
    }
}

run.alias = {
    "sorteo": {
        "args": "crear/terminar/reroll"
    }
};

run.description = {
    'header': "Gestión de sorteos interactiva",
    'body': 'Permite crear, terminar y re-rolear sorteos en el servidor.',
    'usage': 's.giveaway crear <#canal> <ganadores> <tiempo> <premio>\ns.giveaway terminar <mensaje_id|enlace>\ns.giveaway reroll <mensaje_id|enlace>'
};

module.exports = { run, description: run.description };
