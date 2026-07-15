const OsuTournamentModel = require("../../../models/OsuTournamentModel.js");
const {
    doTournamentListEmbed,
    doTournamentDetailEmbed,
    doTournamentFeedHelpEmbed,
    doTournamentBreakdownEmbed,
    getTournamentPaginationRow,
    getTournamentSelectionRow,
    getTournamentBackRow
} = require("../../../views/osuTournamentViews.js");
const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message, reply, logger } = messages;
    const locale = message.locale || 'es';

    const cleanArgs = (args || []).map(arg => typeof arg === 'string' ? arg.toLowerCase().trim() : '');

    const forceIdx = cleanArgs.findIndex(a => a === '-force' || a === '-f' || a === '-actualizar' || a === '-sync');
    if (forceIdx !== -1) {
        const config = require("../../../config.js");
        const isOwner = message.author.id === config.OWNER_ID;
        const guild = message.guild;
        const member = guild ? (message.member || await guild.members.fetch(message.author.id).catch(() => null)) : null;
        const { PermissionFlagsBits } = require("discord.js");
        const isAdmin = member && member.permissions.has(PermissionFlagsBits.Administrator);

        if (!isOwner && !isAdmin) {
            return "❌ Solo los administradores o el propietario del bot pueden forzar una actualización manual de torneos.";
        }

        const replyMsg = reply && typeof reply.reply === 'function' 
            ? await reply.reply("⏳ Iniciando sincronización forzada de torneos de osu! con el foro...")
            : await message.channel.send("⏳ Sincronizando torneos con el foro...");

        try {
            const { checkNewTournaments } = require("../../../services/tournamentCrawler.js");
            await checkNewTournaments();
            if (replyMsg && typeof replyMsg.edit === 'function') {
                await replyMsg.edit("✅ Sincronización manual completada exitosamente.");
            }
            return;
        } catch (err) {
            console.error("Error al forzar actualización de torneos:", err);
            if (replyMsg && typeof replyMsg.edit === 'function') {
                await replyMsg.edit("❌ Ocurrió un error al intentar forzar la sincronización de torneos.");
            }
            return;
        }
    }

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
            const helpEmbed = doTournamentFeedHelpEmbed(prefix, locale);
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

            let latestTourney;
            try {
                latestTourney = await OsuTournamentModel.getLatestTournament();
            } catch (err) {
                return "❌ Error al obtener el último torneo de la base de datos.";
            }

            if (!latestTourney) {
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

            let type = 'tags';
            if (isModoBreakdown) type = 'modo';
            else if (isEstadoBreakdown) type = 'estado';
            else if (isPasadosBreakdown) type = 'pasados';

            const embed = doTournamentBreakdownEmbed(allTournaments, type, message, locale);

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
        initialComponents.push(getTournamentPaginationRow(page, total, pageSize));
    }
    initialComponents.push(getTournamentSelectionRow(page, pageSize, allTournaments));

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
                    components.push(getTournamentPaginationRow(page, total, pageSize));
                }
                components.push(getTournamentSelectionRow(page, pageSize, allTournaments));
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
                        components: [getTournamentBackRow(locale)]
                    });
                }
                return;
            }

            // Actualizar vista de lista
            const components = [];
            if (total > pageSize) {
                components.push(getTournamentPaginationRow(page, total, pageSize));
            }
            components.push(getTournamentSelectionRow(page, pageSize, allTournaments));

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
