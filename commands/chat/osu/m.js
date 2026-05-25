const { getBeatmap_osu, getBeatmap, findBeatmapInChannel, argsParserNoCommand, getBeatmapsetTags } = require("../../utils/osu.js");
const rosu = require("rosu-pp-js");

function formatLength(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

async function run(messages, args) {
    const { message, reply } = messages;

    const parsed_args = argsParserNoCommand(args);

    // 1. Extraer ID de beatmap o link explícito si existe
    let beatmap_id = parsed_args.beatmap_url;
    if (!beatmap_id && parsed_args.username && parsed_args.username[0]) {
        const potential_id = parsed_args.username[0].trim();
        if (/^\d+$/.test(potential_id)) {
            beatmap_id = potential_id;
        }
    }

    // 2. Si no hay ID explícito, buscar en el historial del canal
    if (!beatmap_id) {
        const channel_result = reply ? await findBeatmapInChannel(reply, true, parsed_args.index) : await findBeatmapInChannel(message, false, parsed_args.index);
        if (!channel_result.beatmap_url) {
            return channel_result.bad_response || `❌ No se encontró ningún mapa en el historial del canal ni se especificó un ID válido.`;
        }
        beatmap_id = channel_result.beatmap_url;
    }

    // 3. Obtener metadatos y el archivo del beatmap
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

    // 4. Parsear los mods del mensaje
    let modsStr = parsed_args.modFilter || parsed_args.modContainFilter || "";
    // Si tiene "CL", lo removemos para el cálculo de dificultad
    const activeModsStr = modsStr.replace(/CL/g, "");

    // 5. Determinar modo de juego y realizar conversión si es necesario
    let requestedMode = parsed_args.gamemode; // 'osu', 'taiko', 'fruits', 'mania' o ''
    let activeMode = beatmap.mode; // 'osu', 'taiko', 'fruits', 'mania'
    let isConverted = false;

    // Si el base es 'osu' (std) y el usuario especificó otro modo de juego, lo convertimos
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
            isConverted = true;
        }
    }

    // Calcular estrellas base (con o sin conversión, pero sin mods)
    const baseStarsPerf = new rosu.Performance({ mods: [] });
    const baseStarsAttrs = baseStarsPerf.calculate(map);
    const baseStars = baseStarsAttrs.difficulty.stars;

    // Calcular atributos base del mapa (con o sin conversión, pero sin mods)
    const baseBuilder = new rosu.BeatmapAttributesBuilder({ map: map });
    const baseMapAttrs = baseBuilder.build();
    const baseCs = baseMapAttrs.cs;
    const baseAr = baseMapAttrs.ar;
    const baseOd = baseMapAttrs.od;
    const baseHp = baseMapAttrs.hp;
    const baseBpm = Math.round(map.bpm);

    // Calcular estadísticas y atributos ajustados por mods
    const builder = new rosu.BeatmapAttributesBuilder({
        map: map,
        mods: activeModsStr
    });
    const mapAttrs = builder.build();

    const perf = new rosu.Performance({ mods: activeModsStr });
    const attrs = perf.calculate(map);
    const difficulty = attrs.difficulty;

    const stars = difficulty.stars;
    const maxCombo = difficulty.maxCombo || beatmap.max_combo || 0;

    const cs = mapAttrs.cs;
    const ar = mapAttrs.ar;
    const od = mapAttrs.od;
    const hp = mapAttrs.hp;
    const speedMultiplier = mapAttrs.clockRate;

    const bpm = (map.bpm * speedMultiplier).toFixed(0);
    const totalLength = Math.floor(beatmap.total_length / speedMultiplier);
    const hitLength = Math.floor(beatmap.hit_length / speedMultiplier);

    // 6. Calcular PP para diferentes precisiones
    const ppSS = new rosu.Performance({ mods: activeModsStr }).calculate(map).pp.toFixed(2);
    const pp99 = new rosu.Performance({ mods: activeModsStr, accuracy: 99 }).calculate(map).pp.toFixed(2);
    const pp98 = new rosu.Performance({ mods: activeModsStr, accuracy: 98 }).calculate(map).pp.toFixed(2);
    const pp95 = new rosu.Performance({ mods: activeModsStr, accuracy: 95 }).calculate(map).pp.toFixed(2);



    // Estilo de estados de mapa
    const status_names = {
        'ranked': 'Ranked 🟢',
        'approved': 'Approved 🟡',
        'loved': 'Loved 💞',
        'qualified': 'Qualified 🔵',
        'pending': 'Pending ⏳',
        'wip': 'WIP 🛠️',
        'graveyard': 'Graveyard ⚰️'
    };
    const status_colors = {
        'ranked': '#4ade80',
        'approved': '#facc15',
        'loved': '#f472b6',
        'qualified': '#38bdf8',
        'pending': '#9ca3af',
        'wip': '#9ca3af',
        'graveyard': '#4b5563'
    };

    const statusName = status_names[beatmap.status] || beatmap.status.toUpperCase();
    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : (status_colors[beatmap.status] || '#ffffff');



    const csLabel = activeMode === 'mania' ? 'Keys' : 'CS';

    let objectsValue = '';
    if (activeMode === 'osu') {
        objectsValue = `Círculos: \`${map.nCircles}\` | Sliders: \`${map.nSliders}\` | Spinners: \`${map.nSpinners}\``;
    } else if (activeMode === 'taiko') {
        objectsValue = `Notas: \`${map.nCircles}\` | Drumrolls: \`${map.nSliders}\` | Dendens: \`${map.nSpinners}\``;
    } else if (activeMode === 'fruits') {
        const nFruits = difficulty.nFruits !== undefined ? difficulty.nFruits : map.nCircles;
        const nDroplets = difficulty.nDroplets !== undefined ? difficulty.nDroplets : map.nSliders;
        const nTinyDroplets = difficulty.nTinyDroplets !== undefined ? difficulty.nTinyDroplets : 0;
        objectsValue = `Frutas: \`${nFruits}\` | Droplets: \`${nDroplets}\` | Tiny: \`${nTinyDroplets}\``;
    } else if (activeMode === 'mania') {
        objectsValue = `Notas: \`${map.nCircles}\` | Hold: \`${map.nHolds}\``;
    }

    // Liberar memoria del mapa
    map.free();

    // Obtener tags del beatmapset
    let userTags = [];
    try {
        userTags = await getBeatmapsetTags(beatmap.beatmapset_id);
    } catch (e) {
        console.error("Error al obtener tags en m.js:", e);
    }

    const { doOsuMapEmbed } = require("../../../views/osuEmbeds.js");
    const { embed, components } = doOsuMapEmbed({
        beatmap,
        activeMode,
        isConverted,
        stars,
        baseStars,
        statusName,
        embedColor,
        ppValues: { ppSS, pp99, pp98, pp95 },
        attributes: {
            bpm,
            baseBpm,
            speedMultiplier,
            totalLength,
            hitLength,
            maxCombo,
            cs,
            baseCs,
            ar,
            baseAr,
            od,
            baseOd,
            hp,
            baseHp,
            csLabel,
            modsStr
        },
        objectsValue,
        userTags
    });

    if (reply) {
        reply.reply({ embeds: [embed], components });
        return;
    }

    return { embeds: [embed], components };
}

run.alias = {
    "map": {
        "args": ""
    },
    "mapa": {
        "args": ""
    }
};

run.description = {
    'header': "Muestra detalles completos de un beatmap",
    'body': 'Obtiene y calcula estadísticas detalladas y valores de PP ajustados a mods de cualquier beatmap.',
    'usage': `s.m : Muestra el último mapa enviado en el canal.\ns.m <id_mapa> : Muestra un mapa específico por su ID.\ns.m +HDHR : Muestra las estadísticas y PP ajustadas a los mods HDHR.`
};

module.exports = { run, "description": run.description };