const { getOsuUser, argsParser } = require("../../utils/osu.js");
const { doOsuMapperEmbed, buildMapperButtonsRow, doOsuMapperListEmbed, doOsuMapperTopEmbed } = require("../../../views/osuUserViews.js");
const { getEmbedColor, buildPaginationRow } = require("../../../views/osuViewHelpers.js");
const { Client } = require("osu-web.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const { EmbedBuilder } = require("discord.js");
const fs = require("fs/promises");
const path = require("path");
const CONFIG = require("../../../config.js");
const { getSupabaseClient } = require("../../../db/database.js");
const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message, res, logger } = messages;
    const locale = message.locale || 'es';

    // Detectar si estamos en modo top
    const isTopMode = args.some(arg => arg.toLowerCase() === '-top');

    if (isTopMode) {
        if (logger) logger.process("Procesando clasificación de mappers...");

        let countryFilter = null;
        let sortBy = 'ranked';
        let forceUpdate = false;
        let isServerMode = false;
        let isSengoMode = false;
        let isGlobalMode = false;
        let playmodeFilter = null;
        let playmodeSpecified = false;

        for (let idx = 0; idx < args.length; idx++) {
            const arg = args[idx].toLowerCase();
            if (arg === '-pais' || arg === '-country') {
                if (idx + 1 < args.length) {
                    countryFilter = args[idx + 1].toUpperCase();
                    idx++;
                }
            } else if (arg === '-kudosus' || arg === '-kudos') {
                sortBy = 'kudosus';
            } else if (arg === '-gd' || arg === '-gds') {
                sortBy = 'gd';
            } else if (arg === '-ranked' || arg === '-rankeds' || arg === '-rankeados') {
                sortBy = 'ranked';
            } else if (arg === '-wip' || arg === '-pending') {
                sortBy = 'wip';
            } else if (arg === '-loved' || arg === '-amados') {
                sortBy = 'loved';
            } else if (arg === '-followers' || arg === '-seguidores') {
                sortBy = 'followers';
            } else if (arg === '-graveyard' || arg === '-abandonados') {
                sortBy = 'graveyard';
            } else if (arg === '-recent' || arg === '-reciente') {
                sortBy = 'recent';
            } else if (arg === '-refresh' || arg === '-force') {
                forceUpdate = true;
            } else if (arg === '-server' || arg === '-sv' || arg === '-servidor') {
                isServerMode = true;
            } else if (arg === '-sengo') {
                isSengoMode = true;
            } else if (arg === '-global' || arg === '-g') {
                isGlobalMode = true;
            } else if (arg === '-all' || arg === '-todos') {
                playmodeFilter = 'all';
                playmodeSpecified = true;
            } else if (arg === '-m' || arg === '-mode' || arg === '-modo') {
                if (idx + 1 < args.length) {
                    const modeInput = args[idx + 1].toLowerCase();
                    if (modeInput === 'std' || modeInput === 'standard' || modeInput === 'osu') {
                        playmodeFilter = 'osu';
                        playmodeSpecified = true;
                    } else if (modeInput === 'taiko' || modeInput === 'tko') {
                        playmodeFilter = 'taiko';
                        playmodeSpecified = true;
                    } else if (modeInput === 'fruits' || modeInput === 'ctb' || modeInput === 'catch') {
                        playmodeFilter = 'fruits';
                        playmodeSpecified = true;
                    } else if (modeInput === 'mania' || modeInput === 'mna') {
                        playmodeFilter = 'mania';
                        playmodeSpecified = true;
                    } else if (modeInput === 'all' || modeInput === 'todos') {
                        playmodeFilter = 'all';
                        playmodeSpecified = true;
                    }
                    idx++;
                }
            } else if (arg === '-std' || arg === '-standard' || arg === '-osu') {
                playmodeFilter = 'osu';
                playmodeSpecified = true;
            } else if (arg === '-taiko') {
                playmodeFilter = 'taiko';
                playmodeSpecified = true;
            } else if (arg === '-ctb' || arg === '-fruits' || arg === '-catch') {
                playmodeFilter = 'fruits';
                playmodeSpecified = true;
            } else if (arg === '-mania') {
                playmodeFilter = 'mania';
                playmodeSpecified = true;
            }
        }

        // Si no se especificó un modo de juego, usar por defecto el modo principal del usuario (o estándar)
        if (!playmodeSpecified) {
            try {
                const userRecord = await OsuUserModel.getLinkedUser(message.author.id);
                playmodeFilter = (userRecord && userRecord.main_gamemode) ? userRecord.main_gamemode : 'osu';
            } catch (e) {
                console.error("Error al obtener main_gamemode del usuario para mapper -top:", e);
                playmodeFilter = 'osu';
            }
        }

        if (isSengoMode && message.author.id !== CONFIG.OWNER_ID) {
            return message.reply(t(locale, 'mapper.err_sengo_only'));
        }

        if (forceUpdate && message.author.id !== CONFIG.OWNER_ID) {
            return message.reply(t(locale, 'mapper.err_refresh_only'));
        }

        if (isServerMode && !message.guild) {
            return message.reply(t(locale, 'mapper.err_server_only'));
        }

        // Determinar el modo: 'national' (si hay filtro de país o no es global/server/sengo), 'global', 'server' o 'sengo'
        let mode = 'national';
        if (isGlobalMode) {
            mode = 'global';
        } else if (isServerMode) {
            mode = 'server';
        } else if (isSengoMode) {
            mode = 'sengo';
        } else if (!countryFilter) {
            // Por defecto, si no hay filtro de país pero tampoco global/server/sengo, asumimos país del autor o VE
            const userRecord = await OsuUserModel.getLinkedUser(message.author.id);
            countryFilter = (userRecord && userRecord.country_code) ? userRecord.country_code.toUpperCase() : 'VE';
        }

        // Verificación de habilitación dinámica para usuarios comunes
        if (message.author.id !== CONFIG.OWNER_ID) {
            if (mode === 'national') {
                const scraped = await OsuUserModel.isCountryScraped(countryFilter);
                if (!scraped) {
                    return message.reply(t(locale, 'mapper.err_country_disabled', { country: countryFilter }));
                }
            } else if (mode === 'global') {
                const scraped = await OsuUserModel.isCountryScraped('GLOBAL');
                if (!scraped) {
                    return message.reply(t(locale, 'mapper.err_global_disabled'));
                }
            } else if (mode === 'sengo' || mode === 'server') {
                const scraped = await OsuUserModel.isCountryScraped('SENGO');
                if (!scraped) {
                    return message.reply(t(locale, 'mapper.err_sengo_disabled'));
                }
            }
        }

        let statusMessage = null;
        let mappers = [];

        let needsInitialMessage = false;
        if (forceUpdate) {
            needsInitialMessage = true;
        } else {
            let cacheExists = false;
            const supabase = getSupabaseClient();
            if (supabase) {
                if (mode === 'national') {
                    const { count } = await supabase
                        .from('mapper_statistics')
                        .select('*', { count: 'exact', head: true })
                        .eq('country_code', countryFilter.toUpperCase());
                    cacheExists = count && count > 0;
                } else if (mode === 'global') {
                    const { count } = await supabase
                        .from('mapper_statistics')
                        .select('*', { count: 'exact', head: true });
                    cacheExists = count && count > 200;
                } else {
                    const linkedUsers = await OsuUserModel.getLinkedUsers(message.guild);
                    const linkedOsuIds = linkedUsers.filter(u => u.osu_id).map(u => String(u.osu_id));
                    if (linkedOsuIds.length > 0) {
                        const { count } = await supabase
                            .from('mapper_statistics')
                            .select('*', { count: 'exact', head: true })
                            .in('osu_id', linkedOsuIds);
                        cacheExists = count && count > 0;
                    } else {
                        cacheExists = true;
                    }
                }
            }
            if (!cacheExists) {
                needsInitialMessage = true;
            }
        }

        if (needsInitialMessage) {
            statusMessage = await message.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(getEmbedColor(message))
                        .setDescription(t(locale, 'mapper.loading_cache'))
                ]
            });
        }

        let lastEdit = 0;
        const progressCallback = async (current, total, name) => {
            const nowTime = Date.now();
            if (nowTime - lastEdit > 3000 || current === total) {
                lastEdit = nowTime;
                try {
                    let desc = t(locale, 'mapper.updating_cache_progress', { name, current, total });
                    if (statusMessage) {
                        await statusMessage.edit({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(getEmbedColor(message))
                                    .setDescription(desc)
                            ]
                        });
                    }
                } catch {}
            }
        };

        if (mode === 'national') {
            mappers = await OsuUserModel.getNationalMapperTop(countryFilter, forceUpdate, progressCallback);
        } else if (mode === 'global') {
            mappers = await OsuUserModel.getGlobalKudosuMapperTop(forceUpdate, progressCallback);
        } else {
            mappers = await OsuUserModel.getMapperTop(forceUpdate, progressCallback);
            if (mode === 'server') {
                const serverUsers = await OsuUserModel.getLinkedUsers(message.guild);
                const serverOsuIds = new Set(serverUsers.map(u => String(u.osu_id)));
                mappers = mappers.filter(m => serverOsuIds.has(String(m.osu_id)));
            }
        }

        // Aplicar filtros y ordenamientos
        let filteredMappers = [...mappers];
        if (countryFilter && mode !== 'national') {
            filteredMappers = filteredMappers.filter(m => m.country_code && m.country_code.toUpperCase() === countryFilter);
        }
        if (playmodeFilter && playmodeFilter !== 'all') {
            filteredMappers = filteredMappers.filter(m => m.playmode === playmodeFilter);
        }

        // Ordenamiento
        if (sortBy === 'kudosus') {
            filteredMappers.sort((a, b) => (b.kudosu_total || 0) - (a.kudosu_total || 0));
        } else if (sortBy === 'gd') {
            filteredMappers.sort((a, b) => (b.guest_count || 0) - (a.guest_count || 0));
        } else if (sortBy === 'ranked') {
            filteredMappers.sort((a, b) => (b.ranked_count || 0) - (a.ranked_count || 0));
        } else if (sortBy === 'wip') {
            filteredMappers.sort((a, b) => (b.pending_count || 0) - (a.pending_count || 0));
        } else if (sortBy === 'loved') {
            filteredMappers.sort((a, b) => (b.loved_count || 0) - (a.loved_count || 0));
        } else if (sortBy === 'followers') {
            filteredMappers.sort((a, b) => (b.followers || 0) - (a.followers || 0));
        } else if (sortBy === 'graveyard') {
            filteredMappers.sort((a, b) => (b.graveyard_count || 0) - (a.graveyard_count || 0));
        } else if (sortBy === 'recent') {
            filteredMappers.sort((a, b) => {
                const dateA = a.last_updated ? new Date(a.last_updated).getTime() : 0;
                const dateB = b.last_updated ? new Date(b.last_updated).getTime() : 0;
                return dateB - dateA;
            });
        }

        let currentPage = 1;
        const itemsPerPage = 10;
        const totalPages = Math.max(1, Math.ceil(filteredMappers.length / itemsPerPage));

        const embed = doOsuMapperTopEmbed(message, filteredMappers, currentPage, totalPages, sortBy, countryFilter, mode, playmodeFilter, locale);
        const customSuffixes = { first: 'first', prev: 'prev', next: 'next', last: 'last' };
        const components = totalPages > 1 ? [buildPaginationRow({ prefix: 'mtop', current: currentPage, total: totalPages, oneIndexed: true, customSuffixes })] : [];

        let mainMessage;
        if (statusMessage) {
            mainMessage = await statusMessage.edit({
                embeds: [embed],
                components: components
            });
        } else {
            mainMessage = await message.channel.send({
                embeds: [embed],
                components: components
            });
        }

        // Ejecutar actualización de estadísticas en segundo plano para los 20 más activos del ranking mostrado
        if (filteredMappers.length > 0) {
            OsuUserModel.backgroundUpdateMappers(filteredMappers.slice(0, 20));
        }

        if (totalPages > 1) {
            const collector = mainMessage.createMessageComponentCollector({
                filter: btnInt => btnInt.user.id === message.author.id,
                idle: 120000
            });

            collector.on('collect', async i => {
                try {
                    await i.deferUpdate();
                    const buttonId = i.customId;

                    if (buttonId === 'mtop_first') {
                        currentPage = 1;
                    } else if (buttonId === 'mtop_last') {
                        currentPage = totalPages;
                    } else if (buttonId === 'mtop_prev') {
                        currentPage = Math.max(1, currentPage - 1);
                    } else if (buttonId === 'mtop_next') {
                        currentPage = Math.min(totalPages, currentPage + 1);
                    }

                    const nextEmbed = doOsuMapperTopEmbed(message, filteredMappers, currentPage, totalPages, sortBy, countryFilter, mode, playmodeFilter, locale);
                    const nextComponents = [buildPaginationRow({ prefix: 'mtop', current: currentPage, total: totalPages, oneIndexed: true, customSuffixes })];

                    await i.editReply({
                        embeds: [nextEmbed],
                        components: nextComponents
                    });
                } catch (err) {
                    console.error("Error al procesar interacción de mtop:", err);
                }
            });

            collector.on('end', async () => {
                try {
                    await mainMessage.edit({ components: [] });
                } catch {}
            });
        }

        if (logger) logger.success("Clasificación de mappers cargada con éxito.");
        return;
    }

    if (logger) logger.process("Consultando perfil de osu! y estadísticas de creador...");

    // Pre-procesar argumentos para detectar flags de tipo de mapa
    let type = 'profile';
    const cleanArgs = [];
    for (const arg of args) {
        const lowerArg = arg.toLowerCase();
        if (lowerArg === '-rankeados' || lowerArg === '-rankeds') {
            type = 'ranked';
        } else if (lowerArg === '-pending' || lowerArg === '-wip') {
            type = 'pending';
        } else if (lowerArg === '-loved' || lowerArg === '-amados') {
            type = 'loved';
        } else if (lowerArg === '-graveyard' || lowerArg === '-abandonados') {
            type = 'graveyard';
        } else if (lowerArg === '-mapas' || lowerArg === '-todos') {
            type = 'all';
        } else if (lowerArg === '-gd' || lowerArg === '-gds') {
            type = 'guest';
        } else {
            cleanArgs.push(arg);
        }
    }

    const osu_userdata = await argsParser(cleanArgs, {
        "message": message,
        "res": res,
        "command_function": getOsuUser,
        "resolveUserByIndex": true,
        "ignoreBeatmap": true
    });

    if (!osu_userdata.fn_response || typeof osu_userdata.fn_response === 'string') {
        return osu_userdata.fn_response;
    }

    const osuUser = osu_userdata.fn_response;

    // Inicializar cliente osu! de forma diferida
    let client;
    async function getOsuClient() {
        if (!client) {
            const token = await OsuUserModel.loadToken();
            client = new Client(token.access_token);
        }
        return client;
    }

    // Guardar/Actualizar en base de datos para autodescubrimiento (background)
    getOsuClient().then(cli => {
        OsuUserModel.upsertMapperFromProfile(osuUser, cli).catch(err => {
            console.error("Error al actualizar mapper en segundo plano:", err);
        });
    }).catch(err => {});

    let currentType = type;
    let currentPage = 1;
    const cachedMaps = {};

    async function fetchBeatmapsets(osuUserId, mapType) {
        if (cachedMaps[mapType]) {
            return cachedMaps[mapType];
        }

        const osuClient = await getOsuClient();
        let data;
        if (mapType === 'all') {
            const [ranked, loved, pending, graveyard, guest] = await Promise.all([
                osuClient.users.getUserBeatmaps(osuUserId, 'ranked', { query: { limit: 5 } }),
                osuClient.users.getUserBeatmaps(osuUserId, 'loved', { query: { limit: 5 } }),
                osuClient.users.getUserBeatmaps(osuUserId, 'pending', { query: { limit: 5 } }),
                osuClient.users.getUserBeatmaps(osuUserId, 'graveyard', { query: { limit: 5 } }),
                osuClient.users.getUserBeatmaps(osuUserId, 'guest', { query: { limit: 5 } })
            ]);
            data = { ranked, loved, pending, graveyard, guest };
        } else {
            data = await osuClient.users.getUserBeatmaps(osuUserId, mapType, { query: { limit: 100 } });
        }

        cachedMaps[mapType] = data;
        return data;
    }

    function getItemsCountForType(mapType) {
        if (mapType === 'profile' || mapType === 'all') return 0;
        const data = cachedMaps[mapType];
        return data ? data.length : 0;
    }

    function getTotalPagesForType(mapType) {
        const count = getItemsCountForType(mapType);
        return Math.max(1, Math.ceil(count / 5));
    }

    function setupCollector(sentMessage) {
        const collector = sentMessage.createMessageComponentCollector({
            filter: btnInt => btnInt.user.id === message.author.id,
            idle: 120000
        });

        collector.on('collect', async i => {
            try {
                await i.deferUpdate();
                
                const buttonId = i.customId;
                let newType = currentType;
                let newPage = currentPage;

                if (buttonId === 'mapper_first') {
                    newPage = 1;
                } else if (buttonId === 'mapper_last') {
                    newPage = getTotalPagesForType(currentType);
                } else if (buttonId === 'mapper_prev') {
                    newPage = Math.max(1, currentPage - 1);
                } else if (buttonId === 'mapper_next') {
                    const totalPages = getTotalPagesForType(currentType);
                    newPage = Math.min(totalPages, currentPage + 1);
                } else if (buttonId.startsWith('mapper_')) {
                    newType = buttonId.replace("mapper_", "");
                    newPage = 1; // Reiniciar página al cambiar de categoría
                }

                // Mostrar embed de carga únicamente si cambiamos de pestaña y no tenemos caché
                if (newType !== currentType && newType !== 'profile' && !cachedMaps[newType]) {
                    const loadingEmbed = new EmbedBuilder()
                        .setColor(getEmbedColor(message))
                        .setDescription(t(locale, 'mapper.loading_api'));
                    await i.editReply({ 
                        embeds: [loadingEmbed], 
                        components: buildMapperButtonsRow(osuUser, newType, newPage, 1, locale) 
                    });
                }
                
                let nextEmbed;
                if (newType === 'profile') {
                    nextEmbed = doOsuMapperEmbed(message, osuUser, locale);
                } else {
                    const mapData = await fetchBeatmapsets(osuUser.id, newType);
                    nextEmbed = doOsuMapperListEmbed(message, osuUser, newType, mapData, newPage, locale);
                }

                currentType = newType;
                currentPage = newPage;

                const totalPages = getTotalPagesForType(currentType);
                await i.editReply({
                    embeds: [nextEmbed],
                    components: buildMapperButtonsRow(osuUser, currentType, currentPage, totalPages, locale)
                });
            } catch (err) {
                console.error("Error al procesar interacción en mapper:", err);
            }
        });

        collector.on('end', async () => {
            try {
                await sentMessage.edit({ components: [] });
            } catch {}
        });
    }

    let initialEmbed;
    
    if (type === 'profile') {
        initialEmbed = doOsuMapperEmbed(message, osuUser, locale);
        const initialComponents = buildMapperButtonsRow(osuUser, 'profile', 1, 1, locale);
        const sentMessage = await message.channel.send({
            embeds: [initialEmbed],
            components: initialComponents
        });
        setupCollector(sentMessage);
    } else {
        const initialComponents = buildMapperButtonsRow(osuUser, type, 1, 1, locale);
        const statusMessage = await message.channel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(getEmbedColor(message))
                    .setDescription(t(locale, 'mapper.searching_maps', { username: osuUser.username }))
            ],
            components: initialComponents
        });

        try {
            const mapData = await fetchBeatmapsets(osuUser.id, type);
            const totalPages = getTotalPagesForType(type);
            initialEmbed = doOsuMapperListEmbed(message, osuUser, type, mapData, currentPage, locale);
            
            await statusMessage.edit({
                embeds: [initialEmbed],
                components: buildMapperButtonsRow(osuUser, type, currentPage, totalPages, locale)
            });
            
            setupCollector(statusMessage);
        } catch (err) {
            console.error("Error al cargar mapas en comando mapper inicial:", err);
            await statusMessage.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("#ff3333")
                        .setDescription(t(locale, 'mapper.err_api_fetch'))
                ],
                components: buildMapperButtonsRow(osuUser, 'profile', 1, 1, locale)
            });
            setupCollector(statusMessage);
        }
    }
}

run.alias = {
    "mapper": {
        "args": ""
    },
    "mapcreator": {
        "args": ""
    },
    "creator": {
        "args": ""
    }
};

run.description = {
    'header': t('es', 'commands.mapper.header'),
    'body': t('es', 'commands.mapper.body'),
    'usage': t('es', 'commands.mapper.usage')
};

module.exports = { run };
