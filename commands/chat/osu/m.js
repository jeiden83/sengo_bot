const { getBeatmap_osu, getBeatmap, findBeatmapInChannel, argsParserNoCommand } = require("../../utils/osu.js");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const rosu = require("rosu-pp-js");

function formatLength(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

async function run(messages, args) {
    const { message, res, reply } = messages;

    const parsed_args = argsParserNoCommand(args);

    // 1. Extraer ID de beatmap o link explícito si existe
    let beatmap_id = parsed_args.beatmap_url;
    if (!beatmap_id && args && args.length > 0) {
        for (const arg of args) {
            if (arg && typeof arg === 'string' && /^\d+$/.test(arg)) {
                beatmap_id = arg;
                break;
            }
        }
    }

    // 2. Si no hay ID explícito, buscar en el historial del canal
    if (!beatmap_id) {
        const { beatmap_url, bad_response } = reply ? await findBeatmapInChannel(reply, true) : await findBeatmapInChannel(message, false);
        if (!beatmap_url) {
            return `❌ No se encontró ningún mapa en el historial del canal ni se especificó un ID válido.`;
        }
        beatmap_id = beatmap_url;
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

    // Emojis de mods para título
    const emoji_mods = require("../../../src/emoji_mods.json");
    const mods_emoji_str = modsStr ? modsStr.match(/.{1,2}/g).reduce((acc, mod) => {
        return `${acc}<:${mod}:${emoji_mods[mod] || '123'}>`;
    }, ' +') : '';

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

    const mode_names = {
        'osu': 'osu!',
        'taiko': 'osu!taiko',
        'fruits': 'osu!catch',
        'mania': 'osu!mania'
    };

    const csLabel = activeMode === 'mania' ? 'Keys' : 'CS';

    let objectsValue = '';
    if (activeMode === 'osu') {
        objectsValue = `
▸ **Círculos:** \`${map.nCircles}\`
▸ **Sliders:** \`${map.nSliders}\`
▸ **Spinners:** \`${map.nSpinners}\`
        `;
    } else if (activeMode === 'taiko') {
        objectsValue = `
▸ **Notas:** \`${map.nCircles}\`
▸ **Drumrolls:** \`${map.nSliders}\`
▸ **Dendens:** \`${map.nSpinners}\`
        `;
    } else if (activeMode === 'fruits') {
        const nFruits = difficulty.nFruits !== undefined ? difficulty.nFruits : map.nCircles;
        const nDroplets = difficulty.nDroplets !== undefined ? difficulty.nDroplets : map.nSliders;
        const nTinyDroplets = difficulty.nTinyDroplets !== undefined ? difficulty.nTinyDroplets : 0;
        objectsValue = `
▸ **Frutas:** \`${nFruits}\`
▸ **Droplets:** \`${nDroplets}\`
▸ **Tiny Droplets:** \`${nTinyDroplets}\`
        `;
    } else if (activeMode === 'mania') {
        objectsValue = `
▸ **Notas:** \`${map.nCircles}\`
▸ **Hold Notes:** \`${map.nHolds}\`
        `;
    }

    // Liberar memoria del mapa
    map.free();

    // 7. Construcción del Embed Premium
    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Creado por ${beatmap.beatmapset.creator}`,
            iconURL: `https://a.ppy.sh/${beatmap.beatmapset.user_id}`,
            url: `https://osu.ppy.sh/users/${beatmap.beatmapset.user_id}`
        })
        .setTitle(`${beatmap.beatmapset.artist} - ${beatmap.beatmapset.title} [${beatmap.version}]${mods_emoji_str}`)
        .setURL(`https://osu.ppy.sh/b/${beatmap.id}`)
        .setDescription(`
**Modo:** \`${mode_names[activeMode] || activeMode}\`${isConverted ? ' *(Convertido)*' : ''}
**Dificultad:** \`${stars.toFixed(2)}★\` ${Math.abs(stars - baseStars) > 0.01 ? `*(Base: ${baseStars.toFixed(2)}★)*` : ''}
**Estado:** \`${statusName}\`

**Valores de PP recomendados (Perfect Combo):**
▸ **SS (100%):** \`${ppSS}pp\`
▸ **99%:** \`${pp99}pp\`
▸ **98%:** \`${pp98}pp\`
▸ **95%:** \`${pp95}pp\`
        `)
        .addFields(
            {
                name: '📊 Atributos de Mapa',
                value: `
▸ **BPM:** \`${bpm}\` ${speedMultiplier !== 1.0 ? `*(Base: ${baseBpm})*` : ''}
▸ **Duración:** \`${formatLength(totalLength)}\` *(Drain: ${formatLength(hitLength)})*
▸ **Combo Máximo:** \`x${maxCombo}\`
                `,
                inline: true
            },
            {
                name: '⚙️ Dificultad Física',
                value: `
▸ **${csLabel}:** \`${activeMode === 'mania' ? cs.toFixed(0) : cs.toFixed(1)}\` ${Math.abs(cs - baseCs) > 0.01 ? `*(Base: ${activeMode === 'mania' ? baseCs.toFixed(0) : baseCs.toFixed(1)})*` : ''}
▸ **AR:** \`${ar.toFixed(1)}\` ${Math.abs(ar - baseAr) > 0.01 ? `*(Base: ${baseAr.toFixed(1)})*` : ''}
▸ **OD:** \`${od.toFixed(1)}\` ${Math.abs(od - baseOd) > 0.01 ? `*(Base: ${baseOd.toFixed(1)})*` : ''}
▸ **HP:** \`${hp.toFixed(1)}\` ${Math.abs(hp - baseHp) > 0.01 ? `*(Base: ${baseHp.toFixed(1)})*` : ''}
                `,
                inline: true
            },
            {
                name: '🎯 Conteo de Objetos',
                value: objectsValue,
                inline: true
            }
        )
        .setImage(beatmap.beatmapset.covers["cover@2x"])
        .setColor(embedColor)
        .setFooter({
            text: `SengoBot • Beatmap ID: ${beatmap.id}`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    // Construir la fila de botones de descarga
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setLabel('osu!direct')
                .setStyle(ButtonStyle.Link)
                .setURL(`https://osu.direct/d/${beatmap.beatmapset_id}`),
            new ButtonBuilder()
                .setLabel('Nerinyan')
                .setStyle(ButtonStyle.Link)
                .setURL(`https://api.nerinyan.moe/d/${beatmap.beatmapset_id}?novideo=1`),
            new ButtonBuilder()
                .setLabel('Sayobot')
                .setStyle(ButtonStyle.Link)
                .setURL(`https://txy1.sayobot.cn/beatmaps/download/novideo/${beatmap.beatmapset_id}`)
        );

    if (reply) {
        reply.reply({ embeds: [embed], components: [row] });
        return;
    }

    return { embeds: [embed], components: [row] };
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