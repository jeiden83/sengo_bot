const { PermissionsBitField } = require("discord.js");
const {
    getGiveawayPreviewEmbed,
    getGiveawayPreviewComponents,
    getRequirementsModal,
    getGiveawayActiveEmbed,
    getTitleModal,
    getTimeModal,
    getWinnersModal
} = require("../../../views/giveawayViews.js");
const { t } = require("../../../utils/i18n.js");
const config = require("../../../config.js");

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
    const locale = message.locale || 'es';

    // Limpiar el argumento de alias inyectado por el handler
    if (args.length > 0) {
        const lastArg = args[args.length - 1];
        if (lastArg === null || lastArg === "crear/terminar/reroll") {
            args.pop();
        }
    }

    if (!message.guild) {
        return t(locale, 'giveaway.only_guild');
    }

    // Verificar permisos de moderación
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages) && 
        !message.member.permissions.has(PermissionsBitField.Flags.ManageGuild) && 
        !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return t(locale, 'giveaway.no_permissions');
    }

    const sub = args[0]?.toLowerCase();
    if (!sub || !['crear', 'create', 'terminar', 'end', 'reroll'].includes(sub)) {
        const prefix = message.content ? message.content.slice(0, config.BOT_PREFIX.length) : config.BOT_PREFIX;
        const trigger = message.content ? (message.content.slice(prefix.length).split(/\s+/)[0].toLowerCase() || "giveaway") : "giveaway";
        
        const { doHelpCommandEmbed } = require("../../../views/generalViews.js");
        
        const helpData = {
            headerText: t(locale, 'giveaway.help_header'),
            fields: [
                {
                    name: t(locale, 'giveaway.help_desc_title'),
                    value: t(locale, 'giveaway.help_desc_value'),
                    inline: false
                },
                {
                    name: t(locale, 'giveaway.help_usage_title'),
                    value: `\`\`\`\n${prefix}${trigger} crear <#canal> <ganadores> <tiempo> <premio>\n${prefix}${trigger} terminar <mensaje_id|enlace>\n${prefix}${trigger} reroll <mensaje_id|enlace>\n\`\`\``,
                    inline: false
                },
                {
                    name: t(locale, 'giveaway.help_alias_title'),
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
        let winnersArg = args[2];
        let timeArg = args[3];
        let prize = "";

        // Si winnersArg coincide con un formato de tiempo (ej: 1m, 10s, 2h, 1d)
        if (winnersArg && parseDurationLocal(winnersArg)) {
            // El usuario puso el tiempo primero o no especificó los ganadores
            if (timeArg && /^\d+$/.test(timeArg)) {
                const temp = winnersArg;
                winnersArg = timeArg;
                timeArg = temp;
                prize = args.slice(4).join(" ");
            } else {
                timeArg = winnersArg;
                winnersArg = "1";
                prize = args.slice(3).join(" ");
            }
        } else {
            prize = args.slice(4).join(" ");
        }

        if (!channelArg || !winnersArg || !timeArg || !prize) {
            return t(locale, 'giveaway.err_params');
        }

        const channelIdMatch = channelArg.match(/<#?(\d+)>/) || channelArg.match(/^(\d+)$/);
        const targetChannelId = channelIdMatch ? channelIdMatch[1] : null;
        const targetChannel = targetChannelId ? message.guild.channels.cache.get(targetChannelId) : null;
        if (!targetChannel) {
            return t(locale, 'giveaway.err_invalid_channel');
        }

        function resolveRole(guild, input) {
            if (!input) return null;
            const cleanId = input.replace(/[<@&>]/g, "").trim();
            if (/^\d+$/.test(cleanId)) {
                const role = guild.roles.cache.get(cleanId);
                if (role) return role;
            }
            return guild.roles.cache.find(r => r.name.toLowerCase() === input.trim().toLowerCase()) || null;
        }

        let winnersCount = parseInt(winnersArg, 10);
        if (isNaN(winnersCount) || winnersCount <= 0) {
            return t(locale, 'giveaway.err_invalid_winners');
        }

        let durationMs = parseDurationLocal(timeArg);
        if (!durationMs) {
            return t(locale, 'giveaway.err_invalid_duration');
        }

        let requiredRoleId = null;
        let allowHigherRoles = false;
        let blockOsuSupporters = false;
        let blockNitro = false;

        // Enviar embed de prueba/vista previa con botones interactivos
        const previewEmbed = getGiveawayPreviewEmbed({ prize, winnersCount, durationMs, targetChannelId, requiredRoleId, allowHigherRoles, blockOsuSupporters, blockNitro }, message, locale);
        const components = getGiveawayPreviewComponents(locale);

        const previewMsg = await message.channel.send({
            embeds: [previewEmbed],
            components
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

                    const crypto = require('crypto');
                    const serverSeed = crypto.randomBytes(16).toString('hex');
                    const serverSeedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');

                    const activeEmbed = getGiveawayActiveEmbed({ prize, winnersCount, endAt: Date.now() + durationMs, serverSeedHash, requiredRoleId, allowHigherRoles, blockOsuSupporters, blockNitro }, message.author.id, message, locale);
                    const activeMsg = await targetChannel.send({ embeds: [activeEmbed] });
                    await activeMsg.react("🎉");

                    const { createGiveaway } = require("../../../models/GiveawayModel.js");
                    createGiveaway(message.client, {
                        guildId: message.guild.id,
                        channelId: targetChannel.id,
                        messageId: activeMsg.id,
                        prize,
                        winnersCount,
                        durationMs,
                        creatorId: message.author.id,
                        serverSeed,
                        serverSeedHash,
                        requiredRoleId,
                        allowHigherRoles,
                        blockOsuSupporters,
                        blockNitro
                    });

                    // Editar el sorteo activo para mostrar la ID real en el footer
                    const activeEmbedWithId = getGiveawayActiveEmbed({ prize, winnersCount, endAt: Date.now() + durationMs, messageId: activeMsg.id, serverSeedHash, requiredRoleId, allowHigherRoles, blockOsuSupporters, blockNitro }, message.author.id, message, locale);
                    await activeMsg.edit({ embeds: [activeEmbedWithId] }).catch(() => {});

                    await previewMsg.edit({
                        content: t(locale, 'giveaway.started_in_channel', { channelId: targetChannelId }),
                        embeds: [],
                        components: []
                    });
                } else if (i.customId === 'gw_preview_cancel') {
                    collector.stop('cancelled');
                    await i.deferUpdate();
                    await previewMsg.edit({
                        content: t(locale, 'giveaway.cancelled'),
                        embeds: [],
                        components: []
                    });
                } else if (i.customId === 'gw_preview_edit_title') {
                    const modal = getTitleModal(prize, locale);
                    await i.showModal(modal);

                    try {
                        const modalSubmit = await i.awaitModalSubmit({
                            filter: ms => ms.customId === 'gw_modal_title' && ms.user.id === message.author.id,
                            time: 60000
                        });
                        await modalSubmit.deferUpdate();
                        prize = modalSubmit.fields.getTextInputValue('title_input');
                        
                        const updatedEmbed = getGiveawayPreviewEmbed({ prize, winnersCount, durationMs, targetChannelId, requiredRoleId, allowHigherRoles, blockOsuSupporters, blockNitro }, message, locale);
                        await previewMsg.edit({ embeds: [updatedEmbed] });
                    } catch (err) {
                        if (err.code !== 'InteractionCollectorError') {
                            console.error("Error modal título:", err);
                        }
                    }
                } else if (i.customId === 'gw_preview_edit_time') {
                    const modal = getTimeModal(timeArg, locale);
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
                            const updatedEmbed = getGiveawayPreviewEmbed({ prize, winnersCount, durationMs, targetChannelId, requiredRoleId, allowHigherRoles, blockOsuSupporters, blockNitro }, message, locale);
                            await previewMsg.edit({ embeds: [updatedEmbed] });
                        } else {
                            await modalSubmit.reply({ content: t(locale, 'giveaway.err_modal_duration'), ephemeral: true });
                        }
                    } catch (err) {
                        if (err.code !== 'InteractionCollectorError') {
                            console.error("Error modal tiempo:", err);
                        }
                    }
                } else if (i.customId === 'gw_preview_edit_winners') {
                    const modal = getWinnersModal(winnersCount, locale);
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
                            const updatedEmbed = getGiveawayPreviewEmbed({ prize, winnersCount, durationMs, targetChannelId, requiredRoleId, allowHigherRoles, blockOsuSupporters, blockNitro }, message, locale);
                            await previewMsg.edit({ embeds: [updatedEmbed] });
                        } else {
                            await modalSubmit.reply({ content: t(locale, 'giveaway.err_invalid_winners'), ephemeral: true });
                        }
                    } catch (err) {
                        if (err.code !== 'InteractionCollectorError') {
                            console.error("Error modal ganadores:", err);
                        }
                    }
                } else if (i.customId === 'gw_preview_edit_reqs') {
                    const currentRoleVal = requiredRoleId ? requiredRoleId : '';
                    const currentHigherVal = allowHigherRoles ? 'SI' : 'NO';
                    const currentSuppVal = blockOsuSupporters ? 'SI' : 'NO';
                    const currentNitroVal = blockNitro ? 'SI' : 'NO';

                    const modal = getRequirementsModal(currentRoleVal, currentHigherVal, currentSuppVal, currentNitroVal, locale);
                    await i.showModal(modal);

                    try {
                        const modalSubmit = await i.awaitModalSubmit({
                            filter: ms => ms.customId === 'gw_modal_reqs' && ms.user.id === message.author.id,
                            time: 60000
                        });

                        const roleInput = modalSubmit.fields.getTextInputValue('req_role_input').trim();
                        const higherInput = modalSubmit.fields.getTextInputValue('req_higher_input').trim().toUpperCase();
                        const suppInput = modalSubmit.fields.getTextInputValue('req_supp_input').trim().toUpperCase();
                        const nitroInput = modalSubmit.fields.getTextInputValue('req_nitro_input').trim().toUpperCase();

                        let newRoleId = null;
                        if (roleInput) {
                            const role = resolveRole(message.guild, roleInput);
                            if (!role) {
                                await modalSubmit.reply({ content: t(locale, 'giveaway.err_role_not_found', { roleInput }), ephemeral: true });
                                return;
                            }
                            newRoleId = role.id;
                        }

                        await modalSubmit.deferUpdate();
                        requiredRoleId = newRoleId;
                        allowHigherRoles = (higherInput === 'SI' || higherInput === 'S' || higherInput === 'YES' || higherInput === 'Y');
                        blockOsuSupporters = (suppInput === 'SI' || suppInput === 'S' || suppInput === 'YES' || suppInput === 'Y');
                        blockNitro = (nitroInput === 'SI' || nitroInput === 'S' || nitroInput === 'YES' || nitroInput === 'Y');

                        const updatedEmbed = getGiveawayPreviewEmbed({
                            prize,
                            winnersCount,
                            durationMs,
                            targetChannelId,
                            requiredRoleId,
                            allowHigherRoles,
                            blockOsuSupporters,
                            blockNitro
                        }, message, locale);
                        await previewMsg.edit({ embeds: [updatedEmbed] });
                    } catch (err) {
                        if (err.code !== 'InteractionCollectorError') {
                            console.error("Error modal requisitos:", err);
                        }
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
                        content: t(locale, 'giveaway.timeout'),
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
            return t(locale, 'giveaway.err_provide_msg_id');
        }

        const { endGiveaway } = require("../../../models/GiveawayModel.js");
        const gw = await endGiveaway(message.client, messageId);
        if (!gw) {
            return t(locale, 'giveaway.err_no_active_found');
        }
        return t(locale, 'giveaway.ended_immediately');
    }

    // 3. SUBCOMANDO REROLL
    if (sub === 'reroll') {
        const messageId = parsedArgs.discordMessageId;
        if (!messageId) {
            return t(locale, 'giveaway.err_provide_msg_id');
        }

        const { rerollGiveaway } = require("../../../models/GiveawayModel.js");
        const result = await rerollGiveaway(message.client, messageId);
        if (result.error) {
            return result.error;
        }
        return t(locale, 'giveaway.reroll_success');
    }
}

run.alias = {
    "sorteo": {
        "args": ""
    }
};

run.description = {
    'header': t('es', 'commands.giveaway.header'),
    'body': t('es', 'commands.giveaway.body'),
    'usage': t('es', 'commands.giveaway.usage')
};

module.exports = { run, description: run.description };
