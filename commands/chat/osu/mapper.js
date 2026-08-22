const { getOsuUser, argsParser } = require("../../utils/osu.js");
const { doOsuMapperEmbed, buildMapperButtonsRow, doOsuMapperListEmbed, doOsuMapperTopEmbed, doOsuBnProfileEmbed, doOsuBnListEmbed } = require("../../../views/osuUserViews.js");
const { getEmbedColor, buildPaginationRow } = require("../../../views/osuViewHelpers.js");
const { Client } = require("osu-web.js");
const MappersGuildModel = require("../../../models/MappersGuildModel.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const { EmbedBuilder } = require("discord.js");
const CONFIG = require("../../../config.js");
const { getSupabaseClient } = require("../../../db/database.js");
const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message, res, logger } = messages;
    const locale = message.locale || 'es';

    // Detectar si estamos en modo Track (Mapping Tracker)
    const isTrackMode = args.some(arg => arg.toLowerCase() === '-track');
    if (isTrackMode) {
        return await handleMappingTrackerCommand(messages, args);
    }

    // Detectar si estamos en modo BN (Beatmap Nominators)
    const isBnMode = args.some(arg => arg.toLowerCase() === '-bn');

    if (isBnMode) {
        if (logger) logger.process("Procesando comando de Beatmap Nominators...");

        let username = null;
        let playmodeFilter = null;
        let onlyActive = false;
        let page = 1;
        let forceUpdate = false;

        for (let idx = 0; idx < args.length; idx++) {
            const arg = args[idx].toLowerCase();
            if (arg === '-bn') {
                // modo bn detectado
            } else if (arg === '-force' || arg === '-f' || arg === '-recargar') {
                forceUpdate = true;
            } else if (arg === '-m' || arg === '-mode' || arg === '-modo') {
                if (idx + 1 < args.length) {
                    const modeInput = args[idx + 1].toLowerCase();
                    if (modeInput === 'std' || modeInput === 'standard' || modeInput === 'osu') {
                        playmodeFilter = 'osu';
                    } else if (modeInput === 'taiko' || modeInput === 'tko') {
                        playmodeFilter = 'taiko';
                    } else if (modeInput === 'fruits' || modeInput === 'ctb' || modeInput === 'catch') {
                        playmodeFilter = 'fruits';
                    } else if (modeInput === 'mania' || modeInput === 'mna') {
                        playmodeFilter = 'mania';
                    }
                    idx++;
                }
            } else if (arg === '-std' || arg === '-standard' || arg === '-osu') {
                playmodeFilter = 'osu';
            } else if (arg === '-taiko') {
                playmodeFilter = 'taiko';
            } else if (arg === '-ctb' || arg === '-fruits' || arg === '-catch') {
                playmodeFilter = 'fruits';
            } else if (arg === '-mania') {
                playmodeFilter = 'mania';
            } else if (arg === '-activo' || arg === '-activos' || arg === '-active' || arg === '-open') {
                onlyActive = true;
            } else if (arg === '-p' || arg === '-page' || arg === '-pagina') {
                if (idx + 1 < args.length) {
                    const pageVal = parseInt(args[idx + 1]);
                    if (!isNaN(pageVal) && pageVal > 0) {
                        page = pageVal;
                    }
                    idx++;
                }
            } else if (!arg.startsWith('-')) {
                username = args[idx];
            }
        }

        let bnUsers;
        try {
            bnUsers = await MappersGuildModel.getBnUsers(forceUpdate);
        } catch (error) {
            console.error("Error al obtener datos de Mappers Guild:", error);
            await message.reply(t(locale, 'mapper.err_bn_fetch'));
            return;
        }

        if (username) {
            const target = bnUsers.find(u => u.username.toLowerCase() === username.toLowerCase() || String(u.osuId) === username);
            if (!target) {
                const partialTarget = bnUsers.find(u => u.username.toLowerCase().includes(username.toLowerCase()));
                if (partialTarget) {
                    const embed = doOsuBnProfileEmbed(message, partialTarget, locale);
                    if (logger) logger.success("Comando BN (perfil coincidencia parcial) cargado con éxito.");
                    await message.channel.send({ embeds: [embed] });
                    return;
                }
                await message.reply(t(locale, 'mapper.err_bn_not_found', { username }));
                return;
            }
            const embed = doOsuBnProfileEmbed(message, target, locale);
            if (logger) logger.success("Comando BN (perfil) cargado con éxito.");
            await message.channel.send({ embeds: [embed] });
            return;
        }

        // Listar mappers
        let filtered = [...bnUsers];
        if (playmodeFilter) {
            filtered = filtered.filter(u => u.modes && u.modes.includes(playmodeFilter));
        }
        if (onlyActive) {
            filtered = filtered.filter(u => u.requestStatus && !u.requestStatus.includes('closed') && u.requestStatus.length > 0);
        }

        const itemsPerPage = 10;
        const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
        let currentPage = Math.min(Math.max(1, page), totalPages);

        const listEmbed = doOsuBnListEmbed(message, filtered, currentPage, totalPages, playmodeFilter, onlyActive, locale);
        const customSuffixes = { first: 'first', prev: 'prev', next: 'next', last: 'last' };
        const components = totalPages > 1 ? [buildPaginationRow({ prefix: 'bnlist', current: currentPage, total: totalPages, oneIndexed: true, customSuffixes })] : [];

        const mainMessage = await message.channel.send({
            embeds: [listEmbed],
            components: components
        });

        if (totalPages > 1) {
            const collector = mainMessage.createMessageComponentCollector({
                filter: btnInt => btnInt.user.id === message.author.id,
                idle: 120000
            });

            collector.on('collect', async i => {
                try {
                    await i.deferUpdate();
                    const buttonId = i.customId;

                    if (buttonId === 'bnlist_first') {
                        currentPage = 1;
                    } else if (buttonId === 'bnlist_last') {
                        currentPage = totalPages;
                    } else if (buttonId === 'bnlist_prev') {
                        currentPage = Math.max(1, currentPage - 1);
                    } else if (buttonId === 'bnlist_next') {
                        currentPage = Math.min(totalPages, currentPage + 1);
                    }

                    const nextEmbed = doOsuBnListEmbed(message, filtered, currentPage, totalPages, playmodeFilter, onlyActive, locale);
                    const nextComponents = [buildPaginationRow({ prefix: 'bnlist', current: currentPage, total: totalPages, oneIndexed: true, customSuffixes })];

                    await i.editReply({
                        embeds: [nextEmbed],
                        components: nextComponents
                    });
                } catch (err) {
                    console.error("Error al procesar interacción de bnlist:", err);
                }
            });

            collector.on('end', async () => {
                try {
                    await mainMessage.edit({ components: [] });
                } catch {}
            });
        }

        if (logger) logger.success("Clasificación de BNs cargada con éxito.");
        return;
    }

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
            // ponytail: desempate multicriterio: rankeds -> gds -> loveds
            filteredMappers.sort((a, b) => 
                (b.ranked_count || 0) - (a.ranked_count || 0) ||
                (b.guest_count || 0) - (a.guest_count || 0) ||
                (b.loved_count || 0) - (a.loved_count || 0)
            );
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
        const itemsPerPage = 5;
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
    let isRecentMode = false;
    const cleanArgs = [];
    for (const arg of args) {
        const lowerArg = arg.toLowerCase();
        if (lowerArg === '-rs' || lowerArg === '-r' || lowerArg === '-reciente' || lowerArg === '-recent') {
            isRecentMode = true;
        } else if (lowerArg === '-rankeados' || lowerArg === '-rankeds') {
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

    // Si se solicitó el mapset más reciente (-rs / -r), buscar y lanzar la dificultad principal
    if (isRecentMode) {
        if (logger) logger.process(`Buscando el mapset más reciente de ${osuUser.username}...`);
        const osuClient = await getOsuClient();
        const [pending, ranked, graveyard, loved] = await Promise.all([
            osuClient.users.getUserBeatmaps(osuUser.id, 'pending', { query: { limit: 5 } }).catch(() => []),
            osuClient.users.getUserBeatmaps(osuUser.id, 'ranked', { query: { limit: 5 } }).catch(() => []),
            osuClient.users.getUserBeatmaps(osuUser.id, 'graveyard', { query: { limit: 5 } }).catch(() => []),
            osuClient.users.getUserBeatmaps(osuUser.id, 'loved', { query: { limit: 5 } }).catch(() => [])
        ]);

        const allSets = [...(pending || []), ...(ranked || []), ...(graveyard || []), ...(loved || [])];
        if (allSets.length === 0) {
            await message.reply(t(locale, 'mapper.err_no_beatmaps', { username: osuUser.username }));
            return;
        }

        allSets.sort((a, b) => {
            const dateA = new Date(a.submitted_date || a.last_updated || 0).getTime();
            const dateB = new Date(b.submitted_date || b.last_updated || 0).getTime();
            if (dateB !== dateA) return dateB - dateA;
            return (b.id || 0) - (a.id || 0);
        });

        const recentSet = allSets[0];
        const sortedMaps = Array.isArray(recentSet.beatmaps) && recentSet.beatmaps.length > 0
            ? [...recentSet.beatmaps].sort((a, b) => (b.difficulty_rating || 0) - (a.difficulty_rating || 0))
            : [];
        const targetBeatmap = sortedMaps[0];
        const targetId = targetBeatmap ? String(targetBeatmap.id) : String(recentSet.id);

        const mCommand = require("./m.js");
        const additionalArgs = args.filter(a => {
            const l = a.toLowerCase();
            return l.startsWith('+') || l === '-mapset' || (l.startsWith('-m') && l !== '-m' && l !== '-modo') || l.startsWith('-pp');
        });

        if (logger) logger.success(`Mapset reciente de ${osuUser.username} cargado con éxito.`);
        await mCommand.run(messages, [targetId, ...additionalArgs]);
        return;
    }

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

/**
 * Maneja las opciones y subcomandos de Mapping Tracker (s.mapper -track)
 */
async function handleMappingTrackerCommand(messages, args) {
    const { message, res, logger, reply } = messages;
    const locale = message.locale || 'es';
    const MappingTrackerModel = require("../../../models/MappingTrackerModel.js");
    const { 
        doMappingTrackerGuideEmbed, 
        buildTrackerGuideRow, 
        doMappingTrackerListEmbed, 
        buildTrackerListRow, 
        doMappingTrackerNotificationEmbed,
        doMappingTrackerTestEmbed 
    } = require("../../../views/mappingTrackerViews.js");
    const { PermissionFlagsBits } = require("discord.js");

    const guildId = message.guild?.id;
    if (!guildId) {
        return { content: t(locale, 'mapping_tracker.err_guild_only') };
    }

    // Helper de verificación de permisos de admin del canal/servidor
    const isAdmin = () => {
        if (message.guild.ownerId === message.author?.id) return true;
        const member = message.member;
        if (!member) return false;
        return member.permissions.has(PermissionFlagsBits.Administrator) ||
               member.permissions.has(PermissionFlagsBits.ManageChannels) ||
               member.permissions.has(PermissionFlagsBits.ManageGuild);
    };

    const isCanal = args.some(a => a.toLowerCase() === '-canal');
    const isUsuario = args.some(a => a.toLowerCase() === '-usuario');
    const isServer = args.some(a => a.toLowerCase() === '-server');
    const isTest = args.some(a => a.toLowerCase() === '-test');

    // Extraer event flags concatenables
    const eventFlags = [];
    if (args.some(a => ['-ranked', '-rk'].includes(a.toLowerCase()))) eventFlags.push('ranked');
    if (args.some(a => ['-qualified', '-qf'].includes(a.toLowerCase()))) eventFlags.push('qualified');
    if (args.some(a => ['-loved', '-lv'].includes(a.toLowerCase()))) eventFlags.push('loved');
    if (args.some(a => ['-pending', '-wip'].includes(a.toLowerCase()))) eventFlags.push('pending');
    if (args.some(a => ['-upload', '-up', '-subida', '-nuevo', '-new'].includes(a.toLowerCase()))) eventFlags.push('upload');
    if (args.some(a => ['-disqualified', '-dq', '-descalificado', '-descalificar'].includes(a.toLowerCase()))) eventFlags.push('disqualified');
    if (args.some(a => ['-graveyard', '-gy'].includes(a.toLowerCase()))) eventFlags.push('graveyard');
    if (args.some(a => ['-revive', '-rv'].includes(a.toLowerCase()))) eventFlags.push('revive');
    if (args.some(a => ['-nomination', '-nom'].includes(a.toLowerCase()))) eventFlags.push('nomination');
    if (args.some(a => ['-all', '-todos', '-todo'].includes(a.toLowerCase()))) eventFlags.push('all');

    // ponytail: eventos por defecto recomendados si el usuario no especifica flags
    const DEFAULT_TRACK_EVENTS = ['ranked', 'qualified', 'loved', 'upload', 'disqualified', 'nomination'];
    const finalEvents = eventFlags.length > 0 ? eventFlags : DEFAULT_TRACK_EVENTS;

    // 1. s.mapper -track -test (Prueba de notificación enviada al canal de tracking)
    if (isTest) {
        const config = await MappingTrackerModel.getTrackerChannel(guildId);
        if (!config || !config.channel_id) {
            return { content: t(locale, 'mapping_tracker.err_no_channel') };
        }

        // Verificar si se especificó una flag de estado específica para probar el embed correspondiente
        let targetTestStatus = null;
        if (args.some(a => ['-ranked', '-rk'].includes(a.toLowerCase()))) targetTestStatus = 'ranked';
        else if (args.some(a => ['-qualified', '-qf'].includes(a.toLowerCase()))) targetTestStatus = 'qualified';
        else if (args.some(a => ['-loved', '-lv'].includes(a.toLowerCase()))) targetTestStatus = 'loved';
        else if (args.some(a => ['-upload', '-up', '-subida', '-nuevo', '-new'].includes(a.toLowerCase()))) targetTestStatus = 'upload';
        else if (args.some(a => ['-disqualified', '-dq', '-descalificado', '-descalificar'].includes(a.toLowerCase()))) targetTestStatus = 'disqualified';
        else if (args.some(a => ['-pending', '-wip'].includes(a.toLowerCase()))) targetTestStatus = 'pending';
        else if (args.some(a => ['-graveyard', '-gy'].includes(a.toLowerCase()))) targetTestStatus = 'graveyard';
        else if (args.some(a => ['-revive', '-rv'].includes(a.toLowerCase()))) targetTestStatus = 'revive';
        else if (args.some(a => ['-nomination', '-nom'].includes(a.toLowerCase()))) targetTestStatus = 'nomination';

        const linkedMap = await OsuUserModel.getLinkedUsersMap();

        // Si se ejecuta en el servidor owner (o por el owner), revisa todos los mappers vinculados a Sengo
        const isOwnerGuild = (message.guild && (message.guild.id === process.env.SENGOBOT_GUILD_ID || message.guild.id === process.env.OWNER_GUILD_ID))
            || message.author?.id === process.env.OWNER_ID;

        let mappersToCheck = [];
        if (isOwnerGuild) {
            for (const [osuIdStr, uData] of linkedMap.entries()) {
                mappersToCheck.push({
                    osu_id: Number(osuIdStr),
                    username: uData.username || `Mapper #${osuIdStr}`
                });
            }
        } else {
            mappersToCheck = await MappingTrackerModel.getTrackedUsersForGuild(guildId);
        }

        if (mappersToCheck.length === 0) {
            return { content: t(locale, 'mapping_tracker.err_no_tracked_users') };
        }

        const { fetchUserBeatmapsets, fetchBeatmapsetEvents, detectBeatmapsetGamemode } = require("../../../services/mappingTrackerService.js");

        let realMapset = null;
        let realUser = null;
        let matchedEventType = targetTestStatus || null;

        const allMapsets = [];
        const batchSize = 5;
        const maxMappers = mappersToCheck.length;

        for (let i = 0; i < maxMappers; i += batchSize) {
            const batch = mappersToCheck.slice(i, i + batchSize);
            const batchResults = await Promise.all(
                batch.map(async (tRow) => {
                    const osuId = tRow.osu_id;
                    try {
                        const mapsets = await fetchUserBeatmapsets(osuId, targetTestStatus);
                        if (!mapsets || mapsets.length === 0) return [];
                        const linked = linkedMap.get(osuId.toString()) || linkedMap.get(Number(osuId));
                        const matches = [];
                        for (const ms of mapsets) {
                            const msStatus = (ms.status || '').toLowerCase();
                            let isMatch = true;

                            if (targetTestStatus) {
                                if (targetTestStatus === 'ranked') isMatch = (msStatus === 'ranked' || msStatus === 'approved');
                                else if (targetTestStatus === 'qualified') isMatch = (msStatus === 'qualified');
                                else if (targetTestStatus === 'loved') isMatch = (msStatus === 'loved');
                                else if (targetTestStatus === 'upload') isMatch = (msStatus === 'pending' || msStatus === 'wip' || msStatus === 'graveyard' || msStatus === 'qualified' || msStatus === 'ranked');
                                else if (targetTestStatus === 'disqualified') isMatch = (msStatus === 'pending' || msStatus === 'wip' || msStatus === 'qualified');
                                else if (targetTestStatus === 'pending') isMatch = (msStatus === 'pending' || msStatus === 'wip');
                                else if (targetTestStatus === 'graveyard') isMatch = (msStatus === 'graveyard');
                                else if (targetTestStatus === 'nomination') isMatch = (msStatus === 'qualified' || msStatus === 'pending' || msStatus === 'wip');
                            }

                            if (isMatch) {
                                const updateDate = ms.ranked_date || ms.last_updated || ms.submitted_date || ms.submitted_at || 0;
                                matches.push({
                                    mapset: ms,
                                    osuId,
                                    user: {
                                        id: osuId,
                                        username: linked?.username || tRow.username || ms.creator || `Mapper #${osuId}`,
                                        avatar_url: `https://a.ppy.sh/${osuId}`
                                    },
                                    updatedAt: new Date(updateDate).getTime()
                                });
                            }
                        }
                        return matches;
                    } catch (e) {
                        return [];
                    }
                })
            );

            for (const resList of batchResults) {
                if (resList && resList.length > 0) {
                    allMapsets.push(...resList);
                }
            }

            if (i + batchSize < maxMappers) {
                await new Promise(resolve => setTimeout(resolve, 80));
            }
        }

        if (allMapsets.length > 0) {
            allMapsets.sort((a, b) => b.updatedAt - a.updatedAt);
            realMapset = allMapsets[0].mapset;
            realUser = allMapsets[0].user;
            if (!matchedEventType) {
                matchedEventType = (realMapset.status || 'pending').toLowerCase();
            }
        }

        // Si no se encuentra ningún mapa real que coincida con la solicitud, notificar error sin inventar objetos mock
        if (!realMapset) {
            const statusLabel = targetTestStatus ? targetTestStatus.toUpperCase() : 'TODOS';
            return { content: t(locale, 'mapping_tracker.err_no_map_status', { status: statusLabel }) };
        }

        // Extraer comentario personalizado opcional de las flags (-comment <texto> o -comentario <texto>)
        let customComment = null;
        const commentFlagIdx = args.findIndex(a => ['-comment', '-comentario', '-c'].includes(a.toLowerCase()));
        if (commentFlagIdx !== -1 && commentFlagIdx + 1 < args.length) {
            customComment = args.slice(commentFlagIdx + 1).join(" ");
        }

        // Obtener eventos reales del mapa desde la API de osu! para extraer el BN nominador y comentario real
        let extraInfo = null;
        if (matchedEventType === 'nomination' || matchedEventType === 'qualified') {
            let nomUser = null;
            let nomComment = customComment || null;

            // 1. Probar desde las nominaciones del objeto beatmapset
            const currNoms = realMapset.current_nominations || realMapset.recent_nominations || [];
            if (currNoms.length > 0 && (currNoms[0].user || currNoms[0].user_id)) {
                const u = currNoms[0].user || {};
                const uId = u.id || currNoms[0].user_id;
                nomUser = {
                    id: uId,
                    username: u.username || `BN #${uId}`,
                    avatar_url: u.avatar_url || `https://a.ppy.sh/${uId}`,
                    url: `https://osu.ppy.sh/users/${uId}`
                };
            }

            // 2. Probar desde el feed de eventos de la API de osu!
            try {
                const events = await fetchBeatmapsetEvents(realMapset.id);
                const nomEvent = events.find(e => ['nominate', 'qualify', 'approve'].includes((e.type || '').toLowerCase()));
                if (nomEvent) {
                    if (!nomUser && (nomEvent.user || nomEvent.user_id)) {
                        const u = nomEvent.user || {};
                        const uId = u.id || nomEvent.user_id;
                        nomUser = {
                            id: uId,
                            username: u.username || `BN #${uId}`,
                            avatar_url: u.avatar_url || `https://a.ppy.sh/${uId}`,
                            url: `https://osu.ppy.sh/users/${uId}`
                        };
                    }
                    if (!nomComment && nomEvent.comment) {
                        nomComment = nomEvent.comment?.text || (typeof nomEvent.comment === 'string' ? nomEvent.comment : null);
                    }
                }
            } catch (e) {}

            // 3. Fallback de usuario para asegurar que el header del embed de autor siempre se renderice en las pruebas de nominación/calificado
            if (!nomUser) {
                nomUser = {
                    id: realUser.id,
                    username: realUser.username,
                    avatar_url: realUser.avatar_url,
                    url: `https://osu.ppy.sh/users/${realUser.id}`
                };
            }

            extraInfo = {
                nominator: nomUser,
                comment: nomComment
            };
        }

        const detectedGamemode = typeof detectBeatmapsetGamemode === 'function' ? detectBeatmapsetGamemode(realMapset, realUser, realUser?.playmode) : null;
        const ranksInfo = await MappingTrackerModel.getMapperRankings(realUser.id, realUser.country_code || realUser.country?.code, guildId, false, detectedGamemode);
        if (ranksInfo && typeof MappingTrackerModel.getLinkedGdMappersInfo === 'function') {
            ranksInfo.linkedGds = await MappingTrackerModel.getLinkedGdMappersInfo(realMapset, guildId, detectedGamemode);
        }
        const testEmbedResult = doMappingTrackerNotificationEmbed(realMapset, realUser, matchedEventType, locale, ranksInfo, extraInfo);
        const testEmbed = testEmbedResult.embeds[0];
        testEmbed.setFooter({
            text: t(locale, 'mapping_tracker.test_footer'),
            iconURL: testEmbed.data.footer?.icon_url
        });
        const testEmbedPayload = { embeds: [testEmbed] };

        const targetChannel = message.client?.channels?.cache?.get(config.channel_id)
            || (message.client?.channels?.fetch ? await message.client.channels.fetch(config.channel_id).catch(() => null) : null);

        if (!targetChannel) {
            return { content: t(locale, 'mapping_tracker.err_test_send_channel', { channelId: config.channel_id }) };
        }

        try {
            await targetChannel.send(testEmbedPayload);
        } catch (e) {
            return { content: t(locale, 'mapping_tracker.err_test_send_channel', { channelId: config.channel_id }) };
        }

        if (message.channel.id !== config.channel_id) {
            return { content: t(locale, 'mapping_tracker.test_sent_channel', { channelId: config.channel_id }) };
        }

        return null;
    }

    // 2. s.mapper -track -canal (Solo Admins)
    if (isCanal) {
        if (!isAdmin()) {
            return { content: t(locale, 'mapping_tracker.err_no_perms') };
        }
        let targetChannelId = null;
        for (let i = 0; i < args.length; i++) {
            if (args[i].toLowerCase() === '-canal' && i + 1 < args.length) {
                const nextArg = args[i + 1];
                const match = nextArg.match(/^<#(\d+)>$/) || nextArg.match(/^(\d{17,20})$/);
                if (match) {
                    targetChannelId = match[1];
                }
            }
        }

        if (targetChannelId) {
            const resSet = await MappingTrackerModel.setTrackerChannel(guildId, targetChannelId, message.author.id);
            if (!resSet.success) {
                return { content: t(locale, 'mapping_tracker.err_save_channel', { error: resSet.error }) };
            }
            return { content: t(locale, 'mapping_tracker.success_set_channel', { channelId: targetChannelId }) };
        } else {
            // Deshabilitar y borrar suscripciones asociadas
            await MappingTrackerModel.deleteTrackerChannel(guildId);
            return { content: t(locale, 'mapping_tracker.success_delete_channel') };
        }
    }

    const activeConfig = await MappingTrackerModel.getTrackerChannel(guildId);

    // 3. s.mapper -track -usuario -server (Solo Admins)
    if (isUsuario && isServer) {
        if (!isAdmin()) {
            return { content: t(locale, 'mapping_tracker.err_no_perms') };
        }
        if (!activeConfig || !activeConfig.channel_id) {
            return { content: t(locale, 'mapping_tracker.err_no_channel_set') };
        }

        const linkedMap = await OsuUserModel.getLinkedUsersMap();
        if (linkedMap.size === 0) {
            return { content: t(locale, 'mapping_tracker.err_no_linked_db') };
        }

        let members;
        try {
            members = await message.guild.members.fetch();
        } catch (e) {
            members = message.guild.members.cache;
        }

        const serverLinkedOsuIds = [];
        members.forEach(member => {
            const discordId = member.id;
            for (const [osuId, linkedInfo] of linkedMap.entries()) {
                if (linkedInfo.discord_id === discordId) {
                    serverLinkedOsuIds.push(osuId);
                }
            }
        });

        if (serverLinkedOsuIds.length === 0) {
            return { content: t(locale, 'mapping_tracker.err_no_linked_members') };
        }

        const resBulk = await MappingTrackerModel.addServerUsersToTracker(guildId, activeConfig.channel_id, serverLinkedOsuIds, finalEvents, message.author.id);
        const eventsStr = finalEvents.join(', ');
        return { content: t(locale, 'mapping_tracker.success_add_server', { count: resBulk.count, channelId: activeConfig.channel_id, events: eventsStr }) };
    }

    // 4. s.mapper -track -usuario <ID/mención/username> (Admins para cualquiera, Usuarios normales para sí mismos)
    if (isUsuario) {
        if (!activeConfig || !activeConfig.channel_id) {
            return { content: t(locale, 'mapping_tracker.err_no_channel_set') };
        }
        let userInput = null;
        for (let i = 0; i < args.length; i++) {
            if (args[i].toLowerCase() === '-usuario' && i + 1 < args.length) {
                const userTokens = [];
                for (let j = i + 1; j < args.length; j++) {
                    if (args[j].startsWith('-')) break;
                    userTokens.push(args[j]);
                }
                if (userTokens.length > 0) {
                    userInput = userTokens.join(' ');
                }
                break;
            }
        }

        // Si no especifica usuario, asume el propio autor del mensaje
        if (!userInput) {
            userInput = message.author.id;
        }

        const linkedMap = await OsuUserModel.getLinkedUsersMap();
        let targetOsuId = null;
        let targetDiscordId = null;
        // ponytail: remueve comillas envolventes del input si las tiene y permite buscar por ID de Discord plano o mención
        const cleanInput = userInput.replace(/^["']+|["']+$|"/g, '').trim();
        let targetUsername = cleanInput;

        const mentionMatch = cleanInput.match(/^<@!?(\d+)>$/);
        const discordIdMatch = mentionMatch ? mentionMatch[1] : (cleanInput.match(/^\d{17,20}$/) ? cleanInput : null);

        for (const [osuId, linkedInfo] of linkedMap.entries()) {
            if (
                (discordIdMatch && linkedInfo.discord_id === discordIdMatch) ||
                osuId === cleanInput ||
                (linkedInfo.username && linkedInfo.username.toLowerCase() === cleanInput.toLowerCase())
            ) {
                targetOsuId = osuId;
                targetDiscordId = linkedInfo.discord_id;
                targetUsername = linkedInfo.username || targetUsername;
                break;
            }
        }

        if (!targetOsuId) {
            return { content: t(locale, 'mapping_tracker.err_user_not_linked', { user: userInput }) };
        }

        // Verificación de permisos: Usuarios no administradores solo pueden modificar sus propias alertas
        if (!isAdmin() && targetDiscordId !== message.author.id) {
            return { content: t(locale, 'mapping_tracker.err_no_perms_other_user') };
        }

        if (!targetOsuId) {
            return { content: t(locale, 'mapping_tracker.err_user_not_linked', { user: userInput }) };
        }

        const resSub = await MappingTrackerModel.addTrackedUser(guildId, activeConfig.channel_id, targetOsuId, finalEvents, message.author.id);
        if (!resSub.success) {
            return { content: t(locale, 'mapping_tracker.err_add_user', { error: resSub.error }) };
        }

        const eventsStr = finalEvents.join(', ');
        return { content: t(locale, 'mapping_tracker.success_add_user', { username: targetUsername, osuId: targetOsuId, channelId: activeConfig.channel_id, events: eventsStr }) };
    }

    // 5. Estado actual de tracking en el servidor y guía explicativa interactiva (MVC)
    const trackedList = await MappingTrackerModel.getTrackedUsersForGuild(guildId);

    const guideEmbed = doMappingTrackerGuideEmbed(message, activeConfig, trackedList.length, locale);
    const guideRow = buildTrackerGuideRow(trackedList.length, locale);

    const sentMessage = await message.channel.send({
        embeds: [guideEmbed],
        components: [guideRow]
    });

    let currentView = 'guide';
    let currentListPage = 1;

    const collector = sentMessage.createMessageComponentCollector({
        filter: btnInt => btnInt.user.id === message.author.id,
        idle: 120000
    });

    collector.on('collect', async i => {
        try {
            await i.deferUpdate();
            const btnId = i.customId;

            if (btnId === 'mptrack_view_list') {
                currentView = 'list';
                currentListPage = 1;
            } else if (btnId === 'mptrack_view_guide') {
                currentView = 'guide';
            } else if (btnId === 'mptrack_prev') {
                currentListPage = Math.max(1, currentListPage - 1);
            } else if (btnId === 'mptrack_next') {
                currentListPage++;
            }

            if (currentView === 'guide') {
                await i.editReply({
                    embeds: [doMappingTrackerGuideEmbed(message, activeConfig, trackedList.length, locale)],
                    components: [buildTrackerGuideRow(trackedList.length, locale)]
                });
            } else {
                const { embed: listEmbed, totalPages, currentPage } = doMappingTrackerListEmbed(message, trackedList, currentListPage, locale);
                currentListPage = currentPage;
                const listRow = buildTrackerListRow(currentListPage, totalPages, locale);
                await i.editReply({
                    embeds: [listEmbed],
                    components: [listRow]
                });
            }
        } catch (err) {
            console.error("Error al procesar interacción de mapping tracker:", err);
        }
    });

    collector.on('end', async () => {
        try {
            await sentMessage.edit({ components: [] });
        } catch {}
    });

    return null;
}

run.alias = {
    "mapper": {
        "args": ""
    },
    "mappers": {
        "args": ""
    },
    "mapcreator": {
        "args": ""
    },
    "creator": {
        "args": ""
    },
    "bn": {
        "args": "-bn"
    }
};

run.description = {
    'header': t('es', 'commands.mapper.header'),
    'body': t('es', 'commands.mapper.body'),
    'usage': t('es', 'commands.mapper.usage')
};

module.exports = { run };
