const { getBeatmap_osu, getBeatmap, findBeatmapInChannel, argsParserNoCommand, getBeatmapsetTags } = require("../../utils/osu.js");
const { t } = require("../../../utils/i18n.js");
const rosu = require("rosu-pp-js");

function formatLength(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

async function run(messages, args) {
    const { message, reply } = messages;
    const locale = message.locale || 'es';

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
            return channel_result.bad_response || t(locale, 'map.err_no_map');
        }
        beatmap_id = channel_result.beatmap_url;
    }

    // 3. Obtener metadatos y el archivo del beatmap
    let beatmap;
    try {
        beatmap = await getBeatmap(beatmap_id);
    } catch (e) {
        return t(locale, 'map.err_metadata', { id: beatmap_id });
    }

    if (parsed_args.mapset) {
        let beatmapset;
        try {
            const { getBeatmapset } = require("../../utils/osu.js");
            beatmapset = await getBeatmapset(beatmap.beatmapset_id);
        } catch (e) {
            return t(locale, 'map.err_mapset', { id: beatmap.beatmapset_id });
        }

        if (!beatmapset) {
            return t(locale, 'map.err_mapset', { id: beatmap.beatmapset_id });
        }

        // Estilo de estados de mapa con traducciones
        const status_names = {
            'ranked': t(locale, 'map.status_ranked'),
            'approved': t(locale, 'map.status_approved'),
            'loved': t(locale, 'map.status_loved'),
            'qualified': t(locale, 'map.status_qualified'),
            'pending': t(locale, 'map.status_pending'),
            'wip': t(locale, 'map.status_wip'),
            'graveyard': t(locale, 'map.status_graveyard')
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

        const { doOsuMapsetEmbed } = require("../../../views/osuEmbeds.js");
        const { embed, components } = doOsuMapsetEmbed({
            beatmapset,
            statusName,
            embedColor,
            locale
        });

        if (reply) {
            reply.reply({ embeds: [embed], components });
            return;
        }

        return { embeds: [embed], components };
    }

    let map;
    try {
        map = await getBeatmap_osu(beatmap.beatmapset_id, beatmap.id, beatmap);
    } catch (e) {
        return t(locale, 'map.err_parse', { id: beatmap_id });
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

    // Estilo de estados de mapa con traducciones
    const status_names = {
        'ranked': t(locale, 'map.status_ranked'),
        'approved': t(locale, 'map.status_approved'),
        'loved': t(locale, 'map.status_loved'),
        'qualified': t(locale, 'map.status_qualified'),
        'pending': t(locale, 'map.status_pending'),
        'wip': t(locale, 'map.status_wip'),
        'graveyard': t(locale, 'map.status_graveyard')
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
        objectsValue = t(locale, 'map.objects_osu', { circles: map.nCircles, sliders: map.nSliders, spinners: map.nSpinners });
    } else if (activeMode === 'taiko') {
        objectsValue = t(locale, 'map.objects_taiko', { circles: map.nCircles, sliders: map.nSliders, spinners: map.nSpinners });
    } else if (activeMode === 'fruits') {
        const nFruits = difficulty.nFruits !== undefined ? difficulty.nFruits : map.nCircles;
        const nDroplets = difficulty.nDroplets !== undefined ? difficulty.nDroplets : map.nSliders;
        const nTinyDroplets = difficulty.nTinyDroplets !== undefined ? difficulty.nTinyDroplets : 0;
        objectsValue = t(locale, 'map.objects_fruits', { fruits: nFruits, droplets: nDroplets, tiny: nTinyDroplets });
    } else if (activeMode === 'mania') {
        objectsValue = t(locale, 'map.objects_mania', { circles: map.nCircles, holds: map.nHolds });
    }

    // Liberar memoria del mapa
    map.free();

    // Obtener tags del beatmapset
    let userTags = [];
    try {
        userTags = await getBeatmapsetTags(beatmap.beatmapset_id, 2);
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
        userTags,
        locale
    });

    let sentMessage;
    if (reply && typeof reply.reply === 'function') {
        sentMessage = await reply.reply({ embeds: [embed], components });
    } else if (message.channel && typeof message.channel.send === 'function') {
        sentMessage = await message.channel.send({ embeds: [embed], components });
    } else {
        return { embeds: [embed], components };
    }

    if (!sentMessage) return;

    // Generar y cachear el gráfico de strains de dificultad en segundo plano
    (async () => {
        if (!sentMessage || typeof sentMessage.edit !== 'function') return;

        try {
            const fs = require("fs");
            const path = require("path");

            const cacheDir = path.resolve(__dirname, "../../../db/local/beatmap.osu", String(beatmap.beatmapset_id));
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }

            const cacheFileName = `${beatmap.id}_${activeMode}_${activeModsStr || 'nomod'}.png`;
            const cacheFilePath = path.join(cacheDir, cacheFileName);

            let graphBuffer;
            if (fs.existsSync(cacheFilePath)) {
                graphBuffer = fs.readFileSync(cacheFilePath);
            } else {
                const { generateStrainGraph } = require("../../../utils/strainGraph.js");
                const tempMap = await getBeatmap_osu(beatmap.beatmapset_id, beatmap.id, beatmap);
                
                try {
                    if (beatmap.mode === 'osu' && requestedMode && requestedMode !== 'osu') {
                        const modeMap = {
                            'osu': rosu.GameMode.Osu,
                            'taiko': rosu.GameMode.Taiko,
                            'fruits': rosu.GameMode.Catch,
                            'mania': rosu.GameMode.Mania
                        };
                        if (modeMap[requestedMode] !== undefined) {
                            tempMap.convert(modeMap[requestedMode]);
                        }
                    }

                    graphBuffer = generateStrainGraph(tempMap, activeModsStr, activeMode, totalLength);
                    fs.writeFileSync(cacheFilePath, graphBuffer);
                } finally {
                    tempMap.free();
                }
            }

            const { AttachmentBuilder } = require("discord.js");
            const strainsAttachment = new AttachmentBuilder(graphBuffer, { name: 'strains.png' });

            const { doOsuStrainEmbed } = require("../../../views/osuEmbeds.js");
            const strainEmbed = doOsuStrainEmbed({ embedColor });

            await sentMessage.edit({
                embeds: [embed, strainEmbed],
                components: components,
                files: [strainsAttachment]
            });
        } catch (err) {
            console.error("Error al generar/enviar el gráfico de strain:", err);
        }
    })();

    return;
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
    'header': t('es', 'commands.map.header'),
    'body': t('es', 'commands.map.body'),
    'usage': t('es', 'commands.map.usage')
};

module.exports = { run, "description": run.description };