const { getBeatmap_osu, getBeatmap, findBeatmapInChannel, argsParser, argsParserNoCommand, getOsuUser } = require("../../utils/osu.js");
const ReworkModel = require("../../../models/ReworkModel.js");
const rosu = require("rosu-pp-js");
const { doOsuReworkMapEmbed, doOsuReworkUserEmbed, doOsuReworkListEmbed } = require("../../../views/osuEmbeds.js");

async function run(messages, args) {
    const { message, res, reply, logger } = messages;

    // 1. Parsear argumentos usando argsParserNoCommand
    const initial_parsed = argsParserNoCommand(args);
    const isLista = initial_parsed.listMode;
    const isUserCompare = initial_parsed.reworkCompare;
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
            return `❌ No se encontraron datos recalculados para **${player.username}** en el rework **${rework.name}**.\n💡 *Nota: Es probable que el usuario no esté en la base de datos de recalculación o deba ser agregado a la cola en pp.huismetbenen.nl.*`;
        }

        const embed = await doOsuReworkUserEmbed(message, player, reworkUser, rework);
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
    'body': "Calcula cuánto PP dará un mapa con mods bajo el rework que viene, o muestra el perfil recalculado de un usuario en un rework.",
    'usage': `s.rework : Estima el PP del último mapa del canal con el rework por defecto (master).\ns.rework +HDDT : Estima el PP del último mapa con mods HDDT.\ns.rework -rework 198 : Calcula respecto a un rework específico por nombre o ID.\ns.rework -lista : Muestra la lista de reworks.\ns.rework -o : Compara tus estadísticas y PP actual frente al rework.\ns.rework -o 'usuario' : Compara a otro jugador frente al rework.`
};

module.exports = { run, "description": run.description };
