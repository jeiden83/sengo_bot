const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const OsuTournamentModel = require("../../../models/OsuTournamentModel.js");
const { doTournamentListEmbed, doTournamentDetailEmbed } = require("../../../views/osuTournamentViews.js");
const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message, reply, logger } = messages;
    const locale = message.locale || 'es';

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
                } else if (arg === '-tag' || arg === '-t') {
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
                    .setLabel((index + 1).toString())
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
            locale
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
