const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const OsuTournamentModel = require("../../../models/OsuTournamentModel.js");
const { doTournamentListEmbed, doTournamentDetailEmbed } = require("../../../views/osuTournamentViews.js");
const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message, reply, logger } = messages;
    const locale = message.locale || 'es';

    const cleanArgs = (args || []).map(arg => typeof arg === 'string' ? arg.toLowerCase().trim() : '');

    const canalIdx = cleanArgs.findIndex(a => a === '-canal');
    if (canalIdx !== -1) {
        const guild = message.guild;
        if (!guild) {
            return "❌ Este comando solo puede ser utilizado en un servidor de Discord.";
        }

        const config = require("../../../config.js");
        const isOwner = message.author.id === config.OWNER_ID;
        const member = message.member || await guild.members.fetch(message.author.id).catch(() => null);
        const { PermissionFlagsBits, ChannelType } = require("discord.js");
        const isAdmin = member && member.permissions.has(PermissionFlagsBits.Administrator);

        const subParam = args[canalIdx + 1]?.trim();

        if (!subParam) {
            const prefix = message.prefix || 's.';
            const { EmbedBuilder } = require("discord.js");
            const helpEmbed = new EmbedBuilder()
                .setTitle("📢 Configuración del Feed de Torneos")
                .setDescription(
                    `Permite configurar un canal donde se anunciarán automáticamente los nuevos torneos de osu! obtenidos del foro.\n\n` +
                    `**Comandos disponibles:**\n` +
                    `• \`${prefix}torneos -canal <#canal o ID>\` - Configura el canal de anuncios.\n` +
                    `• \`${prefix}torneos -canal -borrar\` - Desactiva el feed de torneos en el servidor.\n\n` +
                    `*Nota: Requiere permisos de Administrador.*`
                )
                .setColor(0x3498db)
                .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
                .setTimestamp();
            return { embeds: [helpEmbed] };
        }

        if (subParam.toLowerCase() === '-borrar') {
            if (!isOwner && !isAdmin) {
                return "❌ Necesitas permisos de Administrador para desactivar el canal de torneos.";
            }

            const GuildConfigModel = require("../../../models/GuildConfigModel.js");
            await GuildConfigModel.updateGuildConfig(guild.id, { tournament_feed_channel_id: null });

            return "✅ El feed de torneos ha sido desactivado en este servidor.";
        }

        if (subParam.toLowerCase() === '-test') {
            if (!isOwner) {
                return;
            }

            const GuildConfigModel = require("../../../models/GuildConfigModel.js");
            const guildConfig = await GuildConfigModel.getGuildConfig(guild.id);
            const targetChannelId = guildConfig.tournament_feed_channel_id;

            if (!targetChannelId) {
                return "❌ No hay un canal configurado para el feed de torneos en este servidor. Usa `s.torneos -canal #canal` primero.";
            }

            const channel = guild.channels.cache.get(targetChannelId) || await guild.channels.fetch(targetChannelId).catch(() => null);
            if (!channel || !channel.isTextBased()) {
                return `❌ El canal configurado (<#${targetChannelId}>) no es válido o no tengo acceso.`;
            }

            const { getSupabaseClient } = require("../../../db/database.js");
            const supabase = getSupabaseClient();
            if (!supabase) return "❌ Error de conexión a la base de datos.";

            const { data: latestTourney, error } = await supabase
                .from('tournaments')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error || !latestTourney) {
                return "❌ No se encontraron torneos en la base de datos para enviar.";
            }

            const { doTournamentDetailEmbed } = require("../../../views/osuTournamentViews.js");
            const embed = doTournamentDetailEmbed(latestTourney, { member: null }, guildConfig.language || 'es');

            await channel.send({
                content: `📢 **[Prueba de Feed] ¡Nuevo torneo publicado en el foro!**`,
                embeds: [embed]
            });

            return `✅ Mensaje de prueba enviado con éxito a <#${targetChannelId}>.`;
        }

        // Configuración de canal
        if (!isOwner && !isAdmin) {
            return "❌ Necesitas permisos de Administrador para configurar el canal de torneos.";
        }

        let channelId = null;
        const match = subParam.match(/^<#(\d+)>$/) || subParam.match(/^(\d+)$/);
        if (match) {
            channelId = match[1];
        }

        if (!channelId) {
            return "❌ Canal inválido. Debes mencionar un canal (ej: `#canal`) o proveer una ID válida.";
        }

        const targetChannel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
        if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
            return "❌ El canal seleccionado debe ser un canal de texto de este servidor.";
        }

        const botMember = guild.members.me || await guild.members.fetch(message.client.user.id).catch(() => null);
        if (botMember) {
            const permissions = targetChannel.permissionsFor(botMember);
            const missing = [];
            if (!permissions.has(PermissionFlagsBits.ViewChannel)) missing.push("Leer Canal");
            if (!permissions.has(PermissionFlagsBits.SendMessages)) missing.push("Enviar Mensajes");
            if (!permissions.has(PermissionFlagsBits.EmbedLinks)) missing.push("Insertar Enlaces (Embed Links)");

            if (missing.length > 0) {
                return `❌ Sengo no tiene suficientes permisos en el canal <#${channelId}>:\n` + missing.map(p => `- ${p}`).join("\n");
            }
        }

        const GuildConfigModel = require("../../../models/GuildConfigModel.js");
        await GuildConfigModel.updateGuildConfig(guild.id, { tournament_feed_channel_id: channelId });

        return `✅ El feed de torneos se ha configurado correctamente en <#${channelId}>.`;
    }

    const recIdx = cleanArgs.findIndex(a => a === '-rec' || a === '-recomendar');
    const isRecommendation = recIdx !== -1;

    if (isRecommendation) {
        if (logger) logger.process(`Procesando recomendación de torneo para ${message.author.id}`);
        try {
            const OsuUserModel = require("../../../models/OsuUserModel.js");
            const linkedUser = await OsuUserModel.getLinkedUser(messages.res?.User, message.author.id);
            if (!linkedUser) {
                return t(locale, 'torneos.err_not_linked');
            }

            // Obtener perfil de osu!
            const userMode = linkedUser.main_gamemode === 'std' ? 'osu' : linkedUser.main_gamemode;
            const osuUser = await OsuUserModel.getOsuUser({
                username: [linkedUser.osu_id],
                gamemode: userMode
            });

            if (!osuUser || typeof osuUser === 'string') {
                return "❌ No se pudieron obtener los datos de tu perfil de osu!. Por favor, intenta de nuevo más tarde.";
            }

            const currentRank = osuUser.statistics.global_rank;
            const dbMode = linkedUser.main_gamemode; // 'osu', 'mania', 'taiko', 'fruits'
            
            // Buscar torneos activos para su modo y rango
            const matchingTournaments = await OsuTournamentModel.searchTournaments({
                status: ['open', 'in_progress'],
                gameMode: dbMode,
                rank: currentRank
            });

            if (matchingTournaments.length === 0) {
                return `🔍 No encontré torneos activos recomendados para tu modo de juego (**${dbMode === 'osu' ? 'std' : dbMode}**) y tu rango global (**#${currentRank.toLocaleString(locale === 'es' ? 'es-ES' : 'en-US')}**) en este momento.`;
            }

            // Seleccionar uno al azar
            const recommended = matchingTournaments[Math.floor(Math.random() * matchingTournaments.length)];

            // Generar embed de detalle
            const embed = doTournamentDetailEmbed(recommended, message, locale);

            // Mensaje de recomendación
            const recommendationIntro = `🎲 | **¡Torneo recomendado para ti, ${message.author.username}!** (Modo: \`${dbMode === 'osu' ? 'std' : dbMode}\` • Rango: \`#${currentRank.toLocaleString(locale === 'es' ? 'es-ES' : 'en-US')}\`)`;

            if (reply && typeof reply.reply === 'function') {
                await reply.reply({ content: recommendationIntro, embeds: [embed] });
            } else {
                await message.channel.send({ content: recommendationIntro, embeds: [embed] });
            }
            return;
        } catch (err) {
            console.error("Error al procesar recomendación de torneo:", err);
            return t(locale, 'torneos.err_db');
        }
    }

    const tagIdx = cleanArgs.findIndex(a => a === '-tag' || a === '-t' || a === '-tags');
    const isTagsBreakdown = tagIdx !== -1 && (tagIdx === cleanArgs.length - 1 || cleanArgs[tagIdx + 1].startsWith('-'));

    const modoIdx = cleanArgs.findIndex(a => a === '-modo' || a === '-m');
    const isModoBreakdown = modoIdx !== -1 && (modoIdx === cleanArgs.length - 1 || cleanArgs[modoIdx + 1].startsWith('-'));

    const estadoIdx = cleanArgs.findIndex(a => a === '-estado' || a === '-e');
    const isEstadoBreakdown = estadoIdx !== -1 && (estadoIdx === cleanArgs.length - 1 || cleanArgs[estadoIdx + 1].startsWith('-'));

    const pasadosIdx = cleanArgs.findIndex(a => a === '-pasados' || a === '-p');
    const isPasadosBreakdown = pasadosIdx !== -1 && cleanArgs.length === 1;

    if (isTagsBreakdown || isModoBreakdown || isEstadoBreakdown || isPasadosBreakdown) {
        if (logger) logger.process(`Procesando breakdown de torneos: tags=${isTagsBreakdown}, modo=${isModoBreakdown}, estado=${isEstadoBreakdown}, pasados=${isPasadosBreakdown}`);
        try {
            const allTournaments = await OsuTournamentModel.searchTournaments({
                status: ['open', 'in_progress', 'completed', 'unknown']
            });
            const total = allTournaments.length;

            const { EmbedBuilder } = require("discord.js");
            const embed = new EmbedBuilder()
                .setColor(0xffffff)
                .setTimestamp()
                .setFooter({ text: "Sengo", iconURL: message.author.displayAvatarURL() });

            if (isTagsBreakdown) {
                const tagCounts = {};
                for (const t of allTournaments) {
                    if (t.tags && Array.isArray(t.tags)) {
                        for (const tag of t.tags) {
                            const cleanTag = tag.trim().toLowerCase();
                            if (cleanTag) {
                                tagCounts[cleanTag] = (tagCounts[cleanTag] || 0) + 1;
                            }
                        }
                    }
                }
                const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
                const uniqueCount = sortedTags.length;

                embed.setTitle(t(locale, 'torneos.tags_breakdown_title'));
                
                const lines = [];
                for (let i = 0; i < sortedTags.length && i < 30; i++) {
                    const [tag, count] = sortedTags[i];
                    lines.push(`\`${tag}\` (${count})`);
                }
                
                let desc = t(locale, 'torneos.total_tournaments', { total }) + "\n" +
                           t(locale, 'torneos.unique_tags', { count: uniqueCount }) + "\n\n";
                
                if (lines.length > 0) {
                    desc += lines.join("  •  ");
                } else {
                    desc += "*No hay etiquetas registradas.*";
                }
                embed.setDescription(desc);
            }
            else if (isModoBreakdown) {
                const modeCounts = { osu: 0, mania: 0, taiko: 0, fruits: 0 };
                for (const t of allTournaments) {
                    if (modeCounts[t.game_mode] !== undefined) {
                        modeCounts[t.game_mode]++;
                    }
                }
                embed.setTitle(t(locale, 'torneos.modes_breakdown_title'));
                const desc = t(locale, 'torneos.total_tournaments', { total }) + "\n\n" +
                             `• **STD**: ${modeCounts.osu} torneos\n` +
                             `• **Mania**: ${modeCounts.mania} torneos\n` +
                             `• **Taiko**: ${modeCounts.taiko} torneos\n` +
                             `• **Fruits/Catch**: ${modeCounts.fruits} torneos`;
                embed.setDescription(desc);
            }
            else if (isEstadoBreakdown) {
                const statusCounts = { open: 0, in_progress: 0, completed: 0, unknown: 0 };
                for (const t of allTournaments) {
                    const s = t.reg_status || 'unknown';
                    if (statusCounts[s] !== undefined) {
                        statusCounts[s]++;
                    } else {
                        statusCounts.unknown++;
                    }
                }
                embed.setTitle(t(locale, 'torneos.status_breakdown_title'));
                const desc = t(locale, 'torneos.total_tournaments', { total }) + "\n\n" +
                             `• 🟢 **${t(locale, 'torneos.status_open')}**: ${statusCounts.open} torneos\n` +
                             `• 🟡 **${t(locale, 'torneos.status_in_progress')}**: ${statusCounts.in_progress} torneos\n` +
                             `• 🔴 **${t(locale, 'torneos.status_closed')}**: ${statusCounts.completed} torneos\n` +
                             `• ⚪ **${t(locale, 'torneos.status_unknown')}**: ${statusCounts.unknown} torneos`;
                embed.setDescription(desc);
            }
            else if (isPasadosBreakdown) {
                let activeCount = 0;
                let completedCount = 0;
                for (const t of allTournaments) {
                    if (t.reg_status === 'completed') {
                        completedCount++;
                    } else {
                        activeCount++;
                    }
                }
                embed.setTitle(t(locale, 'torneos.past_breakdown_title'));
                const desc = t(locale, 'torneos.total_tournaments', { total }) + "\n\n" +
                             `• 🟢 **${t(locale, 'torneos.active_tournaments')}**: ${activeCount} torneos\n` +
                             `• 🔴 **${t(locale, 'torneos.past_tournaments')}**: ${completedCount} torneos`;
                embed.setDescription(desc);
            }

            if (reply && typeof reply.reply === 'function') {
                await reply.reply({ embeds: [embed] });
            } else {
                await message.channel.send({ embeds: [embed] });
            }
            return;
        } catch (err) {
            console.error("Error al calcular breakdown:", err);
            return t(locale, 'torneos.err_db');
        }
    }

    let gameMode = null;
    let rank = null;
    let tag = null;
    let status = ['open', 'in_progress']; // default active
    let page = 1;
    const pageSize = 5;

    // 1. Parsear flags si se especifican
    if (args && args.length > 0) {
        const hasFlags = args.some(arg => typeof arg === 'string' && arg.startsWith('-'));
        
        if (hasFlags) {
            for (let i = 0; i < args.length; i++) {
                const arg = args[i].toLowerCase().trim();
                if (arg === '-modo' || arg === '-m') {
                    const val = args[i+1]?.toLowerCase().trim();
                    if (['osu', 'std', 'standard'].includes(val)) gameMode = 'osu';
                    else if (['mania', 'm'].includes(val)) gameMode = 'mania';
                    else if (['taiko', 't'].includes(val)) gameMode = 'taiko';
                    else if (['fruits', 'catch', 'ctb', 'c'].includes(val)) gameMode = 'fruits';
                    i++;
                } else if (arg === '-rango' || arg === '-r') {
                    const val = parseInt(args[i+1], 10);
                    if (!isNaN(val)) rank = val;
                    i++;
                } else if (arg === '-tag' || arg === '-t' || arg === '-tags') {
                    tag = args[i+1];
                    i++;
                } else if (arg === '-pasados' || arg === '-p') {
                    status = 'completed';
                } else if (arg === '-estado' || arg === '-e') {
                    const val = args[i+1]?.toLowerCase().trim();
                    if (['open', 'abierto', 'abiertos'].includes(val)) status = 'open';
                    else if (['in_progress', 'curso', 'proceso'].includes(val)) status = 'in_progress';
                    else if (['completed', 'finalizado', 'pasado', 'pasados'].includes(val)) status = 'completed';
                    else if (['all', 'todo', 'todos'].includes(val)) status = ['open', 'in_progress', 'completed', 'unknown'];
                    i++;
                } else if (arg === '-page' || arg === '-pag') {
                    const val = parseInt(args[i+1], 10);
                    if (!isNaN(val)) page = val;
                    i++;
                }
            }
        } else {
            // Auto-detección inteligente para argumentos posicionales simples
            for (const arg of args) {
                const lower = arg.toLowerCase().trim();
                if (['osu', 'std', 'standard', 'mania', 'taiko', 'fruits', 'catch', 'ctb'].includes(lower)) {
                    if (['osu', 'std', 'standard'].includes(lower)) gameMode = 'osu';
                    else if (['mania'].includes(lower)) gameMode = 'mania';
                    else if (['taiko'].includes(lower)) gameMode = 'taiko';
                    else if (['fruits', 'catch', 'ctb'].includes(lower)) gameMode = 'fruits';
                } else if (/^\d+$/.test(lower)) {
                    const val = parseInt(lower, 10);
                    if (!isNaN(val) && val < 2000000) rank = val;
                } else if (['pasados', 'pasado', 'completed', 'past'].includes(lower)) {
                    status = 'completed';
                } else {
                    tag = arg;
                }
            }
        }
    }

    if (logger) logger.process("Buscando torneos en la base de datos...");

    // Cargar la lista completa de torneos filtrados
    let allTournaments = [];
    try {
        allTournaments = await OsuTournamentModel.searchTournaments({
            gameMode,
            rank,
            tag,
            status
        });
    } catch (err) {
        console.error("Error al buscar torneos en el comando:", err);
        return t(locale, 'torneos.err_db');
    }

    const total = allTournaments.length;
    if (total === 0) {
        return t(locale, 'torneos.no_results_active');
    }

    // Funciones auxiliares para construir filas de componentes
    const getPaginationRow = (currentPage) => {
        const maxPages = Math.ceil(total / pageSize) || 1;
        const row = new ActionRowBuilder();
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('torneos_first')
                .setEmoji('⏮️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId('torneos_prev')
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId('torneos_next')
                .setEmoji('▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === maxPages),
            new ButtonBuilder()
                .setCustomId('torneos_last')
                .setEmoji('⏭️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === maxPages)
        );
        return row;
    };

    const getSelectionRow = (currentPage) => {
        const start = (currentPage - 1) * pageSize;
        const pageItems = allTournaments.slice(start, start + pageSize);
        const row = new ActionRowBuilder();
        pageItems.forEach((t, index) => {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`torneos_select_${t.id}`)
                    .setLabel((start + index + 1).toString())
                    .setStyle(ButtonStyle.Primary)
            );
        });
        return row;
    };

    const getBackRow = () => {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('torneos_back')
                .setLabel(t(locale, 'torneos.back_to_list'))
                .setEmoji('🔙')
                .setStyle(ButtonStyle.Secondary)
        );
    };

    // Renderizar página actual
    const getPageEmbed = (currentPage) => {
        const start = (currentPage - 1) * pageSize;
        const pageItems = allTournaments.slice(start, start + pageSize);
        return doTournamentListEmbed({
            tournaments: pageItems,
            total,
            page: currentPage,
            pageSize,
            message,
            locale,
            filters: { gameMode, rank, tag, status }
        });
    };

    const initialEmbed = getPageEmbed(page);
    const initialComponents = [];
    if (total > pageSize) {
        initialComponents.push(getPaginationRow(page));
    }
    initialComponents.push(getSelectionRow(page));

    let sent_message;
    if (reply) {
        sent_message = await reply.reply({ embeds: [initialEmbed], components: initialComponents });
    } else {
        sent_message = await message.channel.send({ embeds: [initialEmbed], components: initialComponents });
    }

    if (!sent_message) return;

    // Configurar colector de interacciones
    const filter = btnInt => btnInt.user.id === message.author.id;
    const collector = sent_message.createMessageComponentCollector({
        filter,
        idle: 120000 // 2 minutos de inactividad
    });

    collector.on('collect', async i => {
        try {
            await i.deferUpdate();

            if (i.customId === 'torneos_first') {
                page = 1;
            } else if (i.customId === 'torneos_prev') {
                page = Math.max(1, page - 1);
            } else if (i.customId === 'torneos_next') {
                const maxPages = Math.ceil(total / pageSize);
                page = Math.min(maxPages, page + 1);
            } else if (i.customId === 'torneos_last') {
                page = Math.ceil(total / pageSize);
            } else if (i.customId === 'torneos_back') {
                // Volver a la lista
                const components = [];
                if (total > pageSize) {
                    components.push(getPaginationRow(page));
                }
                components.push(getSelectionRow(page));
                await i.editReply({
                    embeds: [getPageEmbed(page)],
                    components
                });
                return;
            } else if (i.customId.startsWith('torneos_select_')) {
                // Seleccionar detalles de un torneo
                const tournamentId = parseInt(i.customId.replace('torneos_select_', ''), 10);
                const selected = allTournaments.find(t => t.id === tournamentId);
                if (selected) {
                    const detailEmbed = doTournamentDetailEmbed(selected, message, locale);
                    await i.editReply({
                        embeds: [detailEmbed],
                        components: [getBackRow()]
                    });
                }
                return;
            }

            // Actualizar vista de lista
            const components = [];
            if (total > pageSize) {
                components.push(getPaginationRow(page));
            }
            components.push(getSelectionRow(page));

            await i.editReply({
                embeds: [getPageEmbed(page)],
                components
            });

        } catch (err) {
            console.error("Error en interacción del buscador de torneos:", err);
        }
    });

    collector.on('end', async () => {
        try {
            await sent_message.edit({ components: [] });
        } catch {}
    });

    return;
}

run.description = {
    'header': t('es', 'commands.torneos.header'),
    'body': t('es', 'commands.torneos.body'),
    'usage': t('es', 'commands.torneos.usage')
};

module.exports = { run, description: run.description };
