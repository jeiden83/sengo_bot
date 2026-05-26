const { getBeatmap_osu, getBeatmap, findBeatmapInChannel, argsParser, argsParserNoCommand, getOsuUser } = require("../../utils/osu.js");
const ReworkModel = require("../../../models/ReworkModel.js");
const rosu = require("rosu-pp-js");
const { doOsuReworkMapEmbed, doOsuReworkUserEmbed, doOsuReworkListEmbed, doOsuReworkTopEmbed } = require("../../../views/osuEmbeds.js");

async function run(messages, args) {
    const { message, res, reply, logger } = messages;

    // 1. Parsear argumentos usando argsParserNoCommand
    const initial_parsed = argsParserNoCommand(args);
    const isLista = initial_parsed.listMode;
    const isUserCompare = initial_parsed.reworkCompare;
    const isTop = initial_parsed.reworkTop;
    const reworkQuery = initial_parsed.reworkQuery || "";

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
            return "❌ Hubo un error al intentar obtener la lista de reworks desde la API.";
        }

        const embed = await doOsuReworkListEmbed(message, reworksList);
        if (reply) {
            reply.reply({ embeds: [embed] });
            return;
        }
        return { embeds: [embed] };
    }

    // ----------------------------------------------------
    // Caso 2: s.rework -o/-osu [usuario] (Perfil en Rework)
    // ----------------------------------------------------
    if (isUserCompare) {
        if (logger) logger.process("Resolviendo usuario para comparación de rework");
        const osu_userdata = await argsParser(args, {
            "message": message,
            "res": res,
            "command_function": getOsuUser
        });

        if (!osu_userdata.fn_response || typeof osu_userdata.fn_response === 'string') {
            return osu_userdata.fn_response || "❌ No se pudo resolver el usuario de osu!.";
        }

        const player = osu_userdata.fn_response;
        const requestedMode = osu_userdata.parsed_args.gamemode || player.playmode || "osu";
        const finalReworkQuery = osu_userdata.parsed_args.reworkQuery || "";

        // Obtener el rework correspondiente
        const rework = await ReworkModel.getReworkByQuery(finalReworkQuery, requestedMode);
        if (!rework) {
            return `❌ No se encontró ningún rework que coincida con "${finalReworkQuery}" para el modo de juego especificado.`;
        }

        if (logger) logger.process(`Obteniendo datos de perfil para el rework: ${rework.name}`);
        let reworkUser;
        try {
            reworkUser = await ReworkModel.getUserReworkData(player.id, rework.id);
        } catch (e) {
            console.error("Error al obtener datos del jugador en Rework:", e);
            return `❌ Hubo un error al conectar con la API de Reworks.`;
        }

        if (!reworkUser) {
            const queueStatus = ReworkModel.getQueueStatus(player.id, rework.id);
            if (queueStatus) {
                const elapsed = Math.round((Date.now() - queueStatus.addedAt) / 1000);
                return `⏳ **${player.username}** ya está en la cola de recalculación para **${rework.name}** (hace ${elapsed}s).\nPor favor, ten paciencia, se actualizará pronto en pp.huismetbenen.nl.`;
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
                return `⏳ **${player.username}** no ha sido recalculado aún en **${rework.name}**.\nLo hemos agregado a la cola de recalculación. Vuelve a intentarlo en unos minutos.`;
            }
        }

        await ReworkModel.removeFromQueue(player.id, rework.id);

        const embed = await doOsuReworkUserEmbed(message, player, reworkUser, rework);
        if (reply) {
            reply.reply({ embeds: [embed] });
            return;
        }
        return { embeds: [embed] };
    }

    // ----------------------------------------------------
    // Caso 2.5: s.rework -top [usuario] (Top recalculado en Rework)
    // ----------------------------------------------------
    if (isTop) {
        if (logger) logger.process("Resolviendo usuario para obtener top de rework");
        const osu_userdata = await argsParser(args, {
            "message": message,
            "res": res,
            "command_function": getOsuUser
        });

        if (!osu_userdata.fn_response || typeof osu_userdata.fn_response === 'string') {
            return osu_userdata.fn_response || "❌ No se pudo resolver el usuario de osu!.";
        }

        const player = osu_userdata.fn_response;
        const requestedMode = osu_userdata.parsed_args.gamemode || player.playmode || "osu";
        const finalReworkQuery = osu_userdata.parsed_args.reworkQuery || "";

        // Obtener el rework correspondiente
        const rework = await ReworkModel.getReworkByQuery(finalReworkQuery, requestedMode);
        if (!rework) {
            return `❌ No se encontró ningún rework que coincida con "${finalReworkQuery}" para el modo de juego especificado.`;
        }

        if (logger) logger.process(`Obteniendo top scores para el rework: ${rework.name}`);
        let scores;
        try {
            scores = await ReworkModel.getUserReworkScores(player.id, rework.id, requestedMode);
        } catch (e) {
            console.error("Error al obtener top scores del jugador en Rework:", e);
            return `❌ Hubo un error al conectar con la API de Reworks.`;
        }

        if (!scores || scores.length === 0) {
            const queueStatus = ReworkModel.getQueueStatus(player.id, rework.id);
            if (queueStatus) {
                const elapsed = Math.round((Date.now() - queueStatus.addedAt) / 1000);
                return `⏳ **${player.username}** ya está en la cola de recalculación para **${rework.name}** (hace ${elapsed}s).\nPor favor, ten paciencia, se actualizará pronto en pp.huismetbenen.nl.`;
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
                return `⏳ **${player.username}** no ha sido recalculado aún en **${rework.name}**.\nLo hemos agregado a la cola de recalculación. Vuelve a intentarlo en unos minutos.`;
            }
        }

        await ReworkModel.removeFromQueue(player.id, rework.id);

        // Ordenar por local_pp descendente
        const sortedScores = scores
            .filter(s => s.values && typeof s.values.local_pp === 'number')
            .sort((a, b) => b.values.local_pp - a.values.local_pp);

        const embed = await doOsuReworkTopEmbed(message, player, sortedScores, rework);
        if (reply) {
            reply.reply({ embeds: [embed] });
            return;
        }
        return { embeds: [embed] };
    }

    // ----------------------------------------------------
    // Caso 3: s.rework [mapa] [+mods] (Cálculo de Beatmap en Rework)
    // ----------------------------------------------------
    if (logger) logger.process("Buscando mapa para calcular rework");
    let beatmap_id = initial_parsed.beatmap_url;

    if (!beatmap_id && initial_parsed.username && initial_parsed.username[0]) {
        const potential_id = initial_parsed.username[0].trim();
        if (/^\d+$/.test(potential_id)) {
            beatmap_id = potential_id;
        }
    }

    if (!beatmap_id) {
        const channel_result = reply ? await findBeatmapInChannel(reply, true, initial_parsed.index) : await findBeatmapInChannel(message, false, initial_parsed.index);
        if (!channel_result.beatmap_url) {
            return channel_result.bad_response || `❌ No se encontró ningún mapa en el historial del canal ni se especificó un ID válido.`;
        }
        beatmap_id = channel_result.beatmap_url;
    }

    let beatmap;
    try {
        beatmap = await getBeatmap(beatmap_id);
    } catch (e) {
        return `❌ No se pudieron cargar los metadatos para el mapa con ID \`${beatmap_id}\`.`;
    }

    let map;
    try {
        map = await getBeatmap_osu(beatmap.beatmapset_id, beatmap.id, beatmap);
    } catch (e) {
        return `❌ No se pudo descargar ni analizar el archivo del mapa \`${beatmap_id}\`.`;
    }

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
        baseStars
    };

    map.free();

    // Obtener Rework
    const rework = await ReworkModel.getReworkByQuery(reworkQuery, activeMode);
    if (!rework) {
        return `❌ No se encontró ningún rework que coincida con "${reworkQuery}" para el modo de juego ${activeMode}.`;
    }

    if (logger) logger.process(`Consultando puntuaciones recalculadas en Rework para beatmap ID: ${beatmap.id}`);
    let beatmapScores = [];
    try {
        beatmapScores = await ReworkModel.getBeatmapReworkScores(beatmap.id, rework.id);
    } catch (e) {
        console.error("Error al obtener scores de beatmap en Rework:", e);
        return `❌ Hubo un error al obtener datos del beatmap desde la API de Reworks.`;
    }

    const reworkResult = ReworkModel.calculateReworkPPForMap(beatmapScores, modsStr, livePPValues);

    const embed = await doOsuReworkMapEmbed(message, beatmap, livePPValues, reworkResult, rework, modsStr);
    
    if (reply) {
        reply.reply({ embeds: [embed] });
        return;
    }
    return { embeds: [embed] };
}

run.description = {
    'header': "Comando de Reworks Próximos de PP",
    'body': "Calcula cuánto PP dará un mapa con mods bajo el rework que viene, muestra el perfil recalculado de un usuario en un rework, o su top de mejores jugadas.",
    'usage': `s.rework : Estima el PP del último mapa del canal con el rework por defecto (master).\ns.rework +HDDT : Estima el PP del último mapa con mods HDDT.\ns.rework -rework 198 : Calcula respecto a un rework específico por nombre o ID.\ns.rework -lista : Muestra la lista de reworks.\ns.rework -o : Compara tus estadísticas y PP actual frente al rework.\ns.rework -o 'usuario' : Compara a otro jugador frente al rework.\ns.rework -top : Muestra tu top 5 recalculado.\ns.rework -top 'usuario' : Muestra el top 5 recalculado de otro jugador.`
};

module.exports = { run, "description": run.description };
