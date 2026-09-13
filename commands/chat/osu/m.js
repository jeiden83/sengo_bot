const { getBeatmap_osu, getBeatmap, findBeatmapInChannel, argsParserNoCommand, getBeatmapsetTags } = require("../../utils/osu.js");
const { t } = require("../../../utils/i18n.js");
const ppEngine = require("../../../utils/ppEngine.js");

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

    const engine = ppEngine.getEngine(parsed_args.ppEngine);
    let map;
    try {
        map = await getBeatmap_osu(beatmap.beatmapset_id, beatmap.id, beatmap, parsed_args.ppEngine);
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
            'osu': engine.GameMode.Osu,
            'taiko': engine.GameMode.Taiko,
            'fruits': engine.GameMode.Catch,
            'mania': engine.GameMode.Mania
        };
        if (modeMap[requestedMode] !== undefined) {
            map.convert(modeMap[requestedMode]);
            activeMode = requestedMode;
            isConverted = true;
        }
    }

    // Calcular estrellas base (con o sin conversión, pero sin mods)
    const baseDiffAttrs = new engine.Difficulty({ mods: [] }).calculate(map);
    const baseStars = baseDiffAttrs.stars || 0;

    // Calcular atributos base del mapa (con o sin conversión, pero sin mods)
    const baseBuilder = new engine.BeatmapAttributesBuilder({ map: map });
    const baseMapAttrs = baseBuilder.build();
    const baseCs = baseMapAttrs.cs;
    const baseAr = baseMapAttrs.ar;
    const baseOd = baseMapAttrs.od;
    const baseHp = baseMapAttrs.hp;
    const baseBpm = Math.round(map.bpm);

    // Calcular estadísticas y atributos ajustados por mods
    const builder = new engine.BeatmapAttributesBuilder({
        map: map,
        mods: activeModsStr
    });
    const mapAttrs = builder.build();

    const diffAttrs = new engine.Difficulty({ mods: activeModsStr }).calculate(map);
    const stars = diffAttrs.stars;
    const maxCombo = diffAttrs.maxCombo || beatmap.max_combo || 0;
    const difficulty = diffAttrs;

    const cs = mapAttrs.cs;
    const ar = mapAttrs.ar;
    const od = mapAttrs.od;
    const hp = mapAttrs.hp;
    const speedMultiplier = mapAttrs.clockRate;

    const bpm = (map.bpm * speedMultiplier).toFixed(0);
    const totalLength = Math.floor(beatmap.total_length / speedMultiplier);
    const hitLength = Math.floor(beatmap.hit_length / speedMultiplier);

    // 6. Calcular PP y desglose de skills para diferentes precisiones
    const skillsByAcc = [100, 99, 98, 95].map(acc => {
        const perf = new engine.Performance({ mods: activeModsStr, accuracy: acc }).calculate(diffAttrs);
        return {
            accuracy: acc,
            pp: Number(perf.pp || 0),
            aimPP: Number(perf.ppAim || 0),
            speedPP: Number(perf.ppSpeed || 0),
            accPP: Number(perf.ppAcc || 0),
            flPP: Number(perf.ppFlashlight || 0),
            readingPP: Number(perf.ppReading || 0),
            diffPP: Number(perf.ppDifficulty || 0)
        };
    });

    const ppSS = skillsByAcc[0].pp.toFixed(2);
    const pp99 = skillsByAcc[1].pp.toFixed(2);
    const pp98 = skillsByAcc[2].pp.toFixed(2);
    const pp95 = skillsByAcc[3].pp.toFixed(2);

    const skillsData = {
        activeMode,
        stars,
        baseStars,
        aimStars: diffAttrs.aimStars || diffAttrs.aim || 0,
        speedStars: diffAttrs.speedStars || diffAttrs.speed || 0,
        flashlightStars: diffAttrs.flashlightStars || diffAttrs.flashlight || 0,
        readingStars: diffAttrs.readingStars || diffAttrs.reading || 0,
        stamina: diffAttrs.stamina || 0,
        rhythm: diffAttrs.rhythm || 0,
        od: od != null ? od : (diffAttrs.od || 0),
        skillsByAcc
    };

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
    // Asegurar que tenemos las fechas y el user_id del beatmapset si no están presentes (por ejemplo, si vino de la DB)
    if (beatmap.beatmapset && (!beatmap.beatmapset.submitted_date || !beatmap.beatmapset.last_updated || !beatmap.beatmapset.user_id)) {
        try {
            const { getBeatmapset } = require("../../utils/osu.js");
            const fullSet = await getBeatmapset(beatmap.beatmapset_id);
            if (fullSet) {
                beatmap.beatmapset.submitted_date = fullSet.submitted_date;
                beatmap.beatmapset.last_updated = fullSet.last_updated;
                beatmap.beatmapset.user_id = fullSet.user_id;
            }
        } catch (e) {
            console.error("Error al obtener detalles del beatmapset en m.js:", e);
        }
    }

    const { doOsuMapEmbed, doOsuMapSkillsEmbed, buildMapButtonsRows } = require("../../../views/osuEmbeds.js");
    const { embed: overviewEmbed, components } = doOsuMapEmbed({
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

    const skillsEmbed = doOsuMapSkillsEmbed({
        beatmap,
        activeMode,
        isConverted,
        stars,
        baseStars,
        statusName,
        embedColor,
        attributes: {
            bpm,
            speedMultiplier,
            totalLength,
            hitLength,
            maxCombo,
            cs,
            ar,
            od,
            hp,
            csLabel,
            modsStr
        },
        skillsData,
        locale
    });

    const { AttachmentBuilder } = require("discord.js");
    const { generateSkillsBarChart } = require("../../../utils/skillsGraph.js");
    const skillsBuffer = generateSkillsBarChart({
        beatmapTitle: `${beatmap.beatmapset.artist} - ${beatmap.beatmapset.title} [${beatmap.version}]`,
        modsStr: activeModsStr,
        activeMode,
        stars,
        skillsData,
        locale
    });

    let currentView = 'overview';
    let strainEmbed = null;
    let strainsAttachment = null;

    let sentMessage;
    if (reply && typeof reply.reply === 'function') {
        sentMessage = await reply.reply({ embeds: [overviewEmbed], components });
    } else if (message.channel && typeof message.channel.send === 'function') {
        sentMessage = await message.channel.send({ embeds: [overviewEmbed], components });
    } else {
        return { embeds: [overviewEmbed], components };
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
                            'osu': engine.GameMode.Osu,
                            'taiko': engine.GameMode.Taiko,
                            'fruits': engine.GameMode.Catch,
                            'mania': engine.GameMode.Mania
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

            strainsAttachment = new AttachmentBuilder(graphBuffer, { name: 'strains.png' });

            const { doOsuStrainEmbed } = require("../../../views/osuEmbeds.js");
            strainEmbed = doOsuStrainEmbed({ embedColor });

            // Solo actualizar el mensaje si el usuario ya se encuentra en la vista de skills
            if (currentView === 'skills') {
                await sentMessage.edit({
                    embeds: [skillsEmbed, strainEmbed],
                    components: buildMapButtonsRows({ beatmap, locale, activeView: 'skills' }),
                    files: [new AttachmentBuilder(skillsBuffer, { name: 'skills.png' }), strainsAttachment]
                });
            }
        } catch (err) {
            console.error("Error al generar/enviar el gráfico de strain:", err);
        }
    })();

    // Collector para alternar entre las vistas de .m
    if (typeof sentMessage.createMessageComponentCollector === 'function') {
        const collector = sentMessage.createMessageComponentCollector({
            idle: 90000 // 90 segundos de inactividad
        });

        collector.on('collect', async i => {
            try {
                if (i.user.id !== message.author.id) {
                    await i.reply({
                        content: t(locale, 'about.only_author') || '❌ Solo quien ejecutó el comando puede alternar las vistas.',
                        ephemeral: true
                    });
                    return;
                }

                if (i.customId === 'map_view_overview') {
                    if (currentView === 'overview') {
                        await i.deferUpdate();
                        return;
                    }
                    currentView = 'overview';
                } else if (i.customId === 'map_view_skills') {
                    if (currentView === 'skills') {
                        await i.deferUpdate();
                        return;
                    }
                    currentView = 'skills';
                } else {
                    return;
                }

                let embeds;
                let files;
                if (currentView === 'overview') {
                    embeds = [overviewEmbed];
                    files = [];
                } else {
                    embeds = strainEmbed ? [skillsEmbed, strainEmbed] : [skillsEmbed];
                    files = strainsAttachment
                        ? [new AttachmentBuilder(skillsBuffer, { name: 'skills.png' }), strainsAttachment]
                        : [new AttachmentBuilder(skillsBuffer, { name: 'skills.png' })];
                }
                const rows = buildMapButtonsRows({ beatmap, locale, activeView: currentView });

                await i.update({
                    embeds,
                    files,
                    components: rows
                });
            } catch (err) {
                console.error("Error al alternar vista en m.js:", err);
            }
        });

        collector.on('end', async () => {
            try {
                // Deshabilitar botones de vista pero mantener los links de descarga intactos
                const disabledRows = buildMapButtonsRows({ beatmap, locale, activeView: currentView, disabled: true });
                await sentMessage.edit({ components: disabledRows });
            } catch {}
        });
    }

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