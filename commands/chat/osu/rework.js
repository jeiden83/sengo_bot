const { getBeatmap_osu, getBeatmap, findBeatmapInChannel, argsParser, argsParserNoCommand, getOsuUser } = require("../../utils/osu.js");
const ReworkModel = require("../../../models/ReworkModel.js");
const rosu = require("rosu-pp-js");
const { doOsuReworkMapEmbed, doOsuReworkUserEmbed, doOsuReworkListEmbed, doOsuReworkTopEmbed } = require("../../../views/osuEmbeds.js");
const { t } = require("../../../utils/i18n.js");
const { EmbedBuilder } = require("discord.js");
const { getEmbedColor } = require("../../../views/osuViewHelpers.js");

async function run(messages, args) {
    const { message, res, reply, logger } = messages;
    const locale = message.locale || 'es';

    // 1. Parsear argumentos usando argsParserNoCommand
    const isUserCompareQuery = args.some(arg => typeof arg === 'string' && (arg.toLowerCase().trim() === '-o' || arg.toLowerCase().trim() === '-osu' || arg.toLowerCase().trim() === '-top'));
    const initial_parsed = argsParserNoCommand(args, { ignoreBeatmap: isUserCompareQuery });
    const isLista = initial_parsed.listMode;
    const isTop = initial_parsed.reworkTop;
    const reworkQuery = initial_parsed.reworkQuery || "";

    // Determinar si el usuario quiere realizar el cálculo de un mapa
    const hasMapIdOrUrl = !!initial_parsed.beatmap_url;
    const hasMods = !!(initial_parsed.modFilter || initial_parsed.modContainFilter);
    const hasReply = !!(message.reference || reply);

    let potential_pure_map_id = false;
    if (initial_parsed.username && initial_parsed.username[0]) {
        const potential_id = initial_parsed.username[0].trim();
        if (/^\d{5,10}$/.test(potential_id)) {
            potential_pure_map_id = true;
        }
    }

    // Verificar si explícitamente se incluyó una flag de mods, aunque esté vacía o no parseada por argsParserNoCommand
    const argsStr = Array.isArray(args) ? args.join(' ') : String(args);
    const hasModFlag = argsStr.split(/\s+/).some(arg => {
        const clean = arg.trim();
        return clean === '-m' || clean === '-mods' || clean === '-mod' || clean === '-mx' || clean.startsWith('+');
    });

    const wantsMapCalculation = hasMapIdOrUrl || hasMods || hasReply || potential_pure_map_id || hasModFlag;

    // Si no se pide lista, ni top, ni cálculo de mapa, por defecto es comparación de perfil (-o)
    let isUserCompare = initial_parsed.reworkCompare;
    if (!isLista && !isTop && !wantsMapCalculation) {
        isUserCompare = true;
    }

    // ----------------------------------------------------
    // Caso 1: s.rework -lista (Listado de reworks)
    // ----------------------------------------------------
    if (isLista) {
        if (logger) logger.process("Obteniendo lista de reworks");
        let reworksList;
        try {
            reworksList = await ReworkModel.getReworksList();
        } catch (e) {
            console.error("Error al obtener lista de reworks:", e);
            return t(locale, 'rework.err_api');
        }

        const embed = await doOsuReworkListEmbed(message, reworksList, locale);
        if (reply) {
            reply.reply({ embeds: [embed] });
            return;
        }
        return { embeds: [embed] };
    }

    // ----------------------------------------------------
    // Caso 2: s.rework -o/-osu [usuario] (Perfil en Rework)
    // ----------------------------------------------------
    if (isUserCompare && !isTop) {
        if (logger) logger.process("Resolviendo usuario para comparación de rework");
        const osu_userdata = await argsParser(args, {
            "message": message,
            "res": res,
            "command_function": getOsuUser,
            "ignoreBeatmap": true
        });

        if (!osu_userdata.fn_response || typeof osu_userdata.fn_response === 'string') {
            return osu_userdata.fn_response || t(locale, 'rework.err_user_not_found');
        }

        const player = osu_userdata.fn_response;
        const requestedMode = osu_userdata.parsed_args.gamemode || player.playmode || "osu";
        const finalReworkQuery = osu_userdata.parsed_args.reworkQuery || "";

        // Obtener el rework correspondiente
        const rework = await ReworkModel.getReworkByQuery(finalReworkQuery, requestedMode);
        if (!rework) {
            return t(locale, 'rework.err_rework_not_found', { query: finalReworkQuery });
        }

        if (logger) logger.process(`Obteniendo datos de perfil para el rework: ${rework.name}`);
        let reworkUser;
        try {
            reworkUser = await ReworkModel.getUserReworkData(player.id, rework.id);
        } catch (e) {
            console.error("Error al obtener datos del jugador en Rework:", e);
            return t(locale, 'rework.err_rework_api');
        }

        if (!reworkUser) {
            const queueStatus = ReworkModel.getQueueStatus(player.id, rework.id);
            if (queueStatus) {
                const elapsed = Math.round((Date.now() - queueStatus.addedAt) / 1000);
                return t(locale, 'rework.queue_status_wait', { username: player.username, reworkName: rework.name, elapsed });
            } else {
                const channelId = message.channel ? message.channel.id : null;
                const messageId = message.id || null;
                const authorId = message.author ? message.author.id : null;
                await ReworkModel.addToQueue(player.id, rework.id, player.username, channelId, messageId, false, requestedMode, authorId);
                const reqResult = await ReworkModel.requestReworkRecalculation(player.id, rework.id);
                if (reqResult.success) {
                    console.log(`[Rework] Usuario ${player.username} (${player.id}) agregado exitosamente a la cola de pp.huismetbenen.nl`);
                } else if (reqResult.error.includes("no configurado")) {
                    console.log(`[Rework] No se pudo agregar automáticamente a la cola externa: ${reqResult.error}`);
                } else {
                    console.error(`[Rework] No se pudo agregar automáticamente a la cola externa: ${reqResult.error}`);
                }
                return t(locale, 'rework.queue_added_wait', { username: player.username, reworkName: rework.name });
            }
        }

        await ReworkModel.removeFromQueue(player.id, rework.id);

        const initialEmbed = await doOsuReworkUserEmbed(message, player, reworkUser, rework, [], true, locale);
        let sentMessage;
        if (reply) {
            sentMessage = await reply.reply({ embeds: [initialEmbed] });
        } else {
            sentMessage = await message.channel.send({ embeds: [initialEmbed] });
        }

        // Cargar scores en segundo plano
        let scores = [];
        try {
            scores = await ReworkModel.getUserReworkScores(player.id, rework.id, requestedMode);
        } catch (e) {
            console.error("Error al obtener las jugadas del jugador en Rework:", e);
        }

        const finalEmbed = await doOsuReworkUserEmbed(message, player, reworkUser, rework, scores, false, locale);
        if (sentMessage && typeof sentMessage.edit === 'function') {
            await sentMessage.edit({ embeds: [finalEmbed] });
        }
        return;
    }

    // ----------------------------------------------------
    // Caso 2.5: s.rework -top [usuario] (Top recalculado en Rework)
    // ----------------------------------------------------
    if (isTop) {
        if (logger) logger.process("Resolviendo usuario para obtener top de rework");
        const osu_userdata = await argsParser(args, {
            "message": message,
            "res": res,
            "command_function": getOsuUser,
            "ignoreBeatmap": true
        });

        if (!osu_userdata.fn_response || typeof osu_userdata.fn_response === 'string') {
            return osu_userdata.fn_response || t(locale, 'rework.err_user_not_found');
        }

        const player = osu_userdata.fn_response;
        const requestedMode = osu_userdata.parsed_args.gamemode || player.playmode || "osu";
        const finalReworkQuery = osu_userdata.parsed_args.reworkQuery || "";

        // Obtener el rework correspondiente
        const rework = await ReworkModel.getReworkByQuery(finalReworkQuery, requestedMode);
        if (!rework) {
            return t(locale, 'rework.err_rework_not_found', { query: finalReworkQuery });
        }

        if (logger) logger.process(`Obteniendo top scores para el rework: ${rework.name}`);
        let scores;
        try {
            scores = await ReworkModel.getUserReworkScores(player.id, rework.id, requestedMode);
        } catch (e) {
            console.error("Error al obtener top scores del jugador en Rework:", e);
            return t(locale, 'rework.err_rework_api');
        }

        if (!scores || scores.length === 0) {
            const queueStatus = ReworkModel.getQueueStatus(player.id, rework.id);
            if (queueStatus) {
                const elapsed = Math.round((Date.now() - queueStatus.addedAt) / 1000);
                return t(locale, 'rework.queue_status_wait', { username: player.username, reworkName: rework.name, elapsed });
            } else {
                const channelId = message.channel ? message.channel.id : null;
                const messageId = message.id || null;
                const authorId = message.author ? message.author.id : null;
                await ReworkModel.addToQueue(player.id, rework.id, player.username, channelId, messageId, true, requestedMode, authorId);
                const reqResult = await ReworkModel.requestReworkRecalculation(player.id, rework.id);
                if (reqResult.success) {
                    console.log(`[Rework] Usuario ${player.username} (${player.id}) agregado exitosamente a la cola de pp.huismetbenen.nl`);
                } else if (reqResult.error.includes("no configurado")) {
                    console.log(`[Rework] No se pudo agregar automáticamente a la cola externa: ${reqResult.error}`);
                } else {
                    console.error(`[Rework] No se pudo agregar automáticamente a la cola externa: ${reqResult.error}`);
                }
                return t(locale, 'rework.queue_added_wait', { username: player.username, reworkName: rework.name });
            }
        }

        await ReworkModel.removeFromQueue(player.id, rework.id);

        // Ordenar por local_pp descendente
        let sortedScores = scores
            .filter(s => s.values && typeof s.values.local_pp === 'number')
            .sort((a, b) => b.values.local_pp - a.values.local_pp)
            .map((s, idx) => {
                s.new_rank = idx + 1;
                return s;
            });

        if (initial_parsed.nochoke) {
            return t(locale, 'rework.err_nochoke_disabled');
        }

        if (initial_parsed.sortByPPChange) {
            sortedScores.sort((a, b) => {
                const changeA = (a.values.local_pp || 0) - (a.values.live_pp || 0);
                const changeB = (b.values.local_pp || 0) - (b.values.live_pp || 0);
                return changeB - changeA;
            });
        }

        if (initial_parsed.ppThreshold !== null) {
            sortedScores = sortedScores.filter(s => s.values.local_pp >= initial_parsed.ppThreshold);
        }

        // 1. Filtrar por mods exactos (-m o +mods)
        if (initial_parsed.modFilter !== null) {
            const filterStr = initial_parsed.modFilter;
            const hasExplicitCL = filterStr.includes("CL");

            sortedScores = sortedScores.filter(score => {
                const scoreAcronyms = (score.mods || []).map(m => m.acronym);
                const filteredScoreAcronyms = hasExplicitCL ? scoreAcronyms : scoreAcronyms.filter(mod => mod !== 'CL');

                if (filterStr === "NM" || filterStr === "NONE") {
                    return filteredScoreAcronyms.length === 0;
                }

                const getModChunks = (str) => {
                    const chunks = [];
                    for (let j = 0; j < str.length; j += 2) {
                        chunks.push(str.slice(j, j + 2));
                    }
                    return chunks.sort().join("").toUpperCase();
                };
                const filterNormalized = getModChunks(filterStr);
                const scoreNormalized = filteredScoreAcronyms.sort().join("").toUpperCase();
                return scoreNormalized === filterNormalized;
            });
        }

        // 2. Filtrar por mods contenidos (-mx)
        if (initial_parsed.modContainFilter !== null) {
            const filterStr = initial_parsed.modContainFilter;
            const hasExplicitCL = filterStr.includes("CL");

            const filterChunks = [];
            for (let j = 0; j < filterStr.length; j += 2) {
                filterChunks.push(filterStr.slice(j, j + 2));
            }

            sortedScores = sortedScores.filter(score => {
                const scoreAcronyms = (score.mods || []).map(m => m.acronym);
                const filteredScoreAcronyms = hasExplicitCL ? scoreAcronyms : scoreAcronyms.filter(mod => mod !== 'CL');

                if (filterStr === "NM" || filterStr === "NONE") {
                    return filteredScoreAcronyms.length === 0;
                }

                return filterChunks.every(mod => filteredScoreAcronyms.includes(mod));
            });
        }

        // 3. Filtrar por nombre de mapa, artista o dificultad (-?)
        if (initial_parsed.searchFilter !== null) {
            const query = initial_parsed.searchFilter.toLowerCase();
            sortedScores = sortedScores.filter(score => {
                const title = (score.beatmap?.title || "").toLowerCase();
                const artist = (score.beatmap?.artist || "").toLowerCase();
                const version = (score.beatmap?.diff_name || "").toLowerCase();
                return title.includes(query) || artist.includes(query) || version.includes(query);
            });
        }

        const total_plays = sortedScores.length;
        if (total_plays === 0) {
            return t(locale, 'rework.err_no_plays_found');
        }

        const { buildPaginationRow } = require("../../../views/osuViewHelpers.js");
        const { doOsuReworkTopSingleEmbed } = require("../../../views/osuEmbeds.js");

        // ----------------------------------------------------
        // Modo 1: Single Play Display (-i <index>)
        // ----------------------------------------------------
        if (initial_parsed.explicitIndex) {
            let index = initial_parsed.index || 1;
            let content_msg = '';

            if (index > total_plays) {
                content_msg = t(locale, 'rework.msg_single_play_last', { total: total_plays });
                index = total_plays;
            } else if (index < 1) {
                content_msg = t(locale, 'rework.msg_single_play_invalid');
                index = 1;
            } else {
                content_msg = t(locale, 'rework.msg_single_play', { index, total: total_plays });
            }

            const initialEmbed = await doOsuReworkTopSingleEmbed(message, player, sortedScores[index - 1], rework, index, total_plays, locale);

            const getSingleButtonsRow = (curr, max) => {
                return buildPaginationRow({
                    prefix: 'rew_top_single',
                    current: curr,
                    total: max,
                    oneIndexed: true,
                    customSuffixes: { first: 'first', prev: 'prev', next: 'next', last: 'last' }
                });
            };

            let sent_message;
            if (reply) {
                sent_message = await reply.reply({
                    content: content_msg,
                    embeds: [initialEmbed],
                    components: total_plays > 1 ? [getSingleButtonsRow(index, total_plays)] : []
                });
            } else {
                sent_message = await message.channel.send({
                    content: content_msg,
                    embeds: [initialEmbed],
                    components: total_plays > 1 ? [getSingleButtonsRow(index, total_plays)] : []
                });
            }

            if (total_plays <= 1) return;

            const filter = btnInt => btnInt.user.id === message.author.id;
            const collector = sent_message.createMessageComponentCollector({
                filter,
                idle: 30000
            });

            collector.on('collect', async i => {
                try {
                    await i.deferUpdate();

                    if (i.customId === 'rew_top_single_first') {
                        index = 1;
                    } else if (i.customId === 'rew_top_single_prev') {
                        index = Math.max(1, index - 1);
                    } else if (i.customId === 'rew_top_single_next') {
                        index = Math.min(total_plays, index + 1);
                    } else if (i.customId === 'rew_top_single_last') {
                        index = total_plays;
                    }

                    const content_msg = t(locale, 'rework.msg_single_play', { index, total: total_plays });
                    const embed = await doOsuReworkTopSingleEmbed(message, player, sortedScores[index - 1], rework, index, total_plays, locale);

                    await i.editReply({
                        content: content_msg,
                        embeds: [embed],
                        components: [getSingleButtonsRow(index, total_plays)]
                    });
                } catch (err) {
                    console.error("Error al navegar single rework top play:", err);
                }
            });

            collector.on('end', async () => {
                try {
                    await sent_message.edit({ components: [] });
                } catch {}
            });

            return;
        }

        // ----------------------------------------------------
        // Modo 2: List Mode Display (Paginación con botones)
        // ----------------------------------------------------
        let page = initial_parsed.page || 1;
        const max_pages = Math.ceil(total_plays / 5);
        if (page > max_pages) page = max_pages;
        if (page < 1) page = 1;

        let startIndex = (page - 1) * 5;

        const initialEmbed = await doOsuReworkTopEmbed(message, player, sortedScores, rework, startIndex, locale);

        const getListButtonsRow = (start, total) => {
            return buildPaginationRow({ prefix: 'rew_top_list', current: start, total, pageSize: 5 });
        };

        let sent_message;
        if (reply) {
            sent_message = await reply.reply({
                embeds: [initialEmbed],
                components: total_plays > 5 ? [getListButtonsRow(startIndex, total_plays)] : []
            });
        } else {
            sent_message = await message.channel.send({
                embeds: [initialEmbed],
                components: total_plays > 5 ? [getListButtonsRow(startIndex, total_plays)] : []
            });
        }

        if (total_plays <= 5) return;

        const filter = btnInt => btnInt.user.id === message.author.id;
        const collector = sent_message.createMessageComponentCollector({
            filter,
            idle: 30000
        });

        collector.on('collect', async i => {
            try {
                await i.deferUpdate();

                if (i.customId === 'rew_top_list_first') {
                    startIndex = 0;
                } else if (i.customId === 'rew_top_list_prev') {
                    startIndex = Math.max(0, startIndex - 5);
                } else if (i.customId === 'rew_top_list_next') {
                    startIndex = startIndex + 5;
                } else if (i.customId === 'rew_top_list_last') {
                    startIndex = Math.floor((total_plays - 1) / 5) * 5;
                }

                const embed = await doOsuReworkTopEmbed(message, player, sortedScores, rework, startIndex, locale);

                await i.editReply({
                    embeds: [embed],
                    components: [getListButtonsRow(startIndex, total_plays)]
                });
            } catch (err) {
                console.error("Error al navegar lista de rework top plays:", err);
            }
        });

        collector.on('end', async () => {
            try {
                await sent_message.edit({ components: [] });
            } catch {}
        });

        return;
    }

    // ----------------------------------------------------
    // Caso 3: s.rework [mapa] [+mods] (Cálculo de Beatmap en Rework)
    // ----------------------------------------------------
    if (logger) logger.process("Buscando mapa para calcular rework");
    let beatmap_id = initial_parsed.beatmap_url;

    if (!beatmap_id && initial_parsed.username && initial_parsed.username[0]) {
        const potential_id = initial_parsed.username[0].trim();
        if (/^\d{5,10}$/.test(potential_id)) {
            beatmap_id = potential_id;
        }
    }

    if (!beatmap_id) {
        const channel_result = reply ? await findBeatmapInChannel(reply, true, initial_parsed.index) : await findBeatmapInChannel(message, false, initial_parsed.index);
        if (!channel_result.beatmap_url) {
            return channel_result.bad_response || t(locale, 'rework.err_no_map_history');
        }
        beatmap_id = channel_result.beatmap_url;
    }

    let sentMessage = null;
    const processStartTime = Date.now();
    let stepStartTime = Date.now();

    const stepTemplates = locale === 'es' ? [
        "Obteniendo metadatos del mapa...",
        "Descargando archivo .osu...",
        "Calculando valores en local...",
        "Obteniendo configuración del rework...",
        "Consultando rework exacto a pp.huismetbenen.nl..."
    ] : [
        "Fetching beatmap metadata...",
        "Downloading .osu file...",
        "Calculating local values...",
        "Fetching rework configuration...",
        "Querying exact rework to pp.huismetbenen.nl..."
    ];

    const activeSteps = [];

    const updateProgress = async (stepIndex, status, extra = "") => {
        const embedColor = getEmbedColor(message);
        
        if (activeSteps.length <= stepIndex) {
            for (let i = activeSteps.length; i < stepIndex; i++) {
                if (activeSteps[i]) {
                    activeSteps[i].status = 'success';
                    if (activeSteps[i].duration === null) {
                        activeSteps[i].duration = 0;
                    }
                }
            }
            activeSteps.push({
                text: stepTemplates[stepIndex],
                status: 'loading',
                duration: null,
                extra: ""
            });
            stepStartTime = Date.now();
        }

        const step = activeSteps[stepIndex];
        step.status = status;
        step.extra = extra;

        if (status === 'success' || status === 'error' || status === 'warning') {
            if (step.duration === null) {
                step.duration = Date.now() - stepStartTime;
            }
        }

        const descriptionLines = activeSteps.map((s) => {
            let emoji = '⏳';
            if (s.status === 'success') emoji = '✅';
            else if (s.status === 'error') emoji = '❌';
            else if (s.status === 'warning') emoji = '⚠️';
            else if (s.status === 'retry') emoji = '🔄';

            let durationText = s.duration !== null ? ` - **${s.duration}ms**` : "";
            let extraText = s.extra ? ` ${s.extra}` : "";
            return `${emoji} ${s.text}${durationText}${extraText}`;
        });

        const totalElapsed = Date.now() - processStartTime;
        const progressEmbed = new EmbedBuilder()
            .setTitle(locale === 'es' ? "Calculando Rework..." : "Calculating Rework...")
            .setDescription(descriptionLines.join('\n'))
            .setColor(embedColor)
            .setFooter({
                text: locale === 'es'
                    ? `Sengo • Tiempo transcurrido: ${(totalElapsed / 1000).toFixed(2)}s`
                    : `Sengo • Elapsed time: ${(totalElapsed / 1000).toFixed(2)}s`
            });

        try {
            if (!sentMessage) {
                if (reply) {
                    sentMessage = await reply.reply({ embeds: [progressEmbed] });
                } else {
                    sentMessage = await message.channel.send({ embeds: [progressEmbed] });
                }
            } else if (typeof sentMessage.edit === 'function') {
                await sentMessage.edit({ embeds: [progressEmbed] });
            }
        } catch (e) {
            // Ignorar
        }
    };

    await updateProgress(0, 'loading');

    let beatmap;
    try {
        beatmap = await getBeatmap(beatmap_id);
        await updateProgress(0, 'success');
    } catch (e) {
        const errText = t(locale, 'rework.err_map_metadata', { mapId: beatmap_id });
        await updateProgress(0, 'error', `(${errText})`);
        return;
    }

    let map;
    await updateProgress(1, 'loading');
    try {
        map = await getBeatmap_osu(beatmap.beatmapset_id, beatmap.id, beatmap);
        await updateProgress(1, 'success');
    } catch (e) {
        const errText = t(locale, 'rework.err_map_parse', { mapId: beatmap_id });
        await updateProgress(1, 'error', `(${errText})`);
        return;
    }

    await updateProgress(2, 'loading');
    let modsStr = initial_parsed.modFilter || initial_parsed.modContainFilter || "";
    const activeModsStr = modsStr.replace(/CL/g, "");

    let requestedMode = initial_parsed.gamemode;
    let activeMode = beatmap.mode;

    if (activeMode === 'osu' && requestedMode && requestedMode !== 'osu') {
        const modeMap = {
            'osu': rosu.GameMode.Osu,
            'taiko': rosu.GameMode.Taiko,
            'fruits': rosu.GameMode.Catch,
            'mania': rosu.GameMode.Mania
        };
        if (modeMap[requestedMode] !== undefined) {
            map.convert(modeMap[requestedMode]);
            activeMode = requestedMode;
        }
    }

    // Calcular estrellas base
    const baseStarsPerf = new rosu.Performance({ mods: [] });
    const baseStarsAttrs = baseStarsPerf.calculate(map);
    const baseStars = baseStarsAttrs.difficulty.stars;

    const modStarsPerf = new rosu.Performance({ mods: activeModsStr });
    const modStarsAttrs = modStarsPerf.calculate(map);
    const liveModStars = modStarsAttrs.difficulty.stars;

    // Calcular PP para diferentes precisiones en Live
    const ppSS = new rosu.Performance({ mods: activeModsStr }).calculate(map).pp;
    const pp99 = new rosu.Performance({ mods: activeModsStr, accuracy: 99 }).calculate(map).pp;
    const pp98 = new rosu.Performance({ mods: activeModsStr, accuracy: 98 }).calculate(map).pp;
    const pp95 = new rosu.Performance({ mods: activeModsStr, accuracy: 95 }).calculate(map).pp;

    const livePPValues = {
        ppSS,
        pp99,
        pp98,
        pp95,
        baseStars,
        liveModStars,
        maxCombo: baseStarsAttrs.difficulty.maxCombo
    };

    map.free();
    await updateProgress(2, 'success');

    await updateProgress(3, 'loading');
    // Obtener Rework
    const rework = await ReworkModel.getReworkByQuery(reworkQuery, activeMode);
    if (!rework) {
        const errText = t(locale, 'rework.err_rework_not_found_mode', { query: reworkQuery, mode: activeMode });
        await updateProgress(3, 'error', `(${errText})`);
        return;
    }
    await updateProgress(3, 'success');

    let reworkResult = null;
    await updateProgress(4, 'loading', `[100%: ⏳, 99%: ⚪, 98%: ⚪, 95%: ⚪]`);

    const onProgress = async (acc, status, extraVal) => {
        const accs = [100, 99, 98, 95];
        const accIdx = accs.indexOf(acc);
        
        let progressStr = accs.map((a, idx) => {
            let emoji = '⚪';
            if (idx < accIdx) emoji = '✅';
            else if (idx === accIdx) {
                if (status === 'loading') emoji = '⏳';
                else if (status === 'success') emoji = '✅';
                else if (status === 'retry') emoji = '🔄';
                else if (status === 'failed') emoji = '❌';
            }
            let extraInfo = "";
            if (idx === accIdx && status === 'retry') {
                extraInfo = ` (Reintento ${extraVal || 2}/3)`;
            }
            return `${a}%: ${emoji}${extraInfo}`;
        }).join(', ');
        
        await updateProgress(4, 'loading', `[${progressStr}]`);
    };

    if (logger) logger.process(`Intentando calcular Rework exacto para beatmap ID: ${beatmap.id}`);
    try {
        reworkResult = await ReworkModel.calculateReworkPPForMapExact(beatmap.id, modsStr, livePPValues, activeMode, rework.code, onProgress);
        
        const accs = [100, 99, 98, 95];
        const finalProgressStr = accs.map(a => `${a}%: ✅`).join(', ');
        await updateProgress(4, 'success', `[${finalProgressStr}]`);
    } catch (err) {
        console.warn(`[Rework] No se pudo realizar el cálculo exacto (fallando a promedio): ${err.message}`);
    }

    if (!reworkResult) {
        await updateProgress(4, 'warning', `(No disponible, estimando por promedio...)`);
        
        stepTemplates.push(locale === 'es' ? "Calculando estimación por promedio..." : "Calculating average estimation...");
        await updateProgress(5, 'loading');
        
        if (logger) logger.process(`Consultando puntuaciones recalculadas en Rework para beatmap ID: ${beatmap.id} (Promedio)`);
        let beatmapScores = [];
        try {
            beatmapScores = await ReworkModel.getBeatmapReworkScores(beatmap.id, rework.id);
        } catch (e) {
            console.error("Error al obtener scores de beatmap en Rework:", e);
            const errText = t(locale, 'rework.err_rework_map_api');
            await updateProgress(5, 'error', `(${errText})`);
            return;
        }
        reworkResult = ReworkModel.calculateReworkPPForMap(beatmapScores, modsStr, livePPValues);
        await updateProgress(5, 'success');
    }

    const embed = await doOsuReworkMapEmbed(message, beatmap, livePPValues, reworkResult, rework, modsStr, locale);
    
    if (sentMessage && typeof sentMessage.edit === 'function') {
        await sentMessage.edit({ content: null, embeds: [embed] });
        return;
    }

    if (reply) {
        reply.reply({ embeds: [embed] });
        return;
    }
    return { embeds: [embed] };
}

run.description = {
    'header': t('es', 'commands.rework.header'),
    'body': t('es', 'commands.rework.body'),
    'usage': t('es', 'commands.rework.usage')
};

module.exports = { run, "description": run.description };
