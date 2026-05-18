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

    // 1. Extraer ID de beatmap o link explícito si existe
    let beatmap_id = null;
    if (args && args.length > 0) {
        for (const arg of args) {
            if (arg && typeof arg === 'string') {
                const match = arg.match(/osu\.ppy\.sh\/b(?:eatmaps)?\/(\d+)/) ||
                              arg.match(/osu\.ppy\.sh\/beatmapsets\/\d+#(?:osu|taiko|fruits|mania)\/(\d+)/) ||
                              arg.match(/^\d+$/);
                if (match) {
                    beatmap_id = match[1] || match[0];
                    break;
                }
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
    const parsed_args = argsParserNoCommand(args);
    let modsStr = parsed_args.modFilter || parsed_args.modContainFilter || "";
    if (!modsStr) {
        for (const arg of args) {
            if (arg && typeof arg === 'string' && arg.startsWith("+")) {
                modsStr = arg.slice(1).toUpperCase();
                break;
            }
        }
    }
    // Si tiene "CL", lo removemos para el cálculo de dificultad
    const activeModsStr = modsStr.replace(/CL/g, "");

    // 5. Calcular estadísticas ajustadas por mods
    const perf = new rosu.Performance({ mods: activeModsStr });
    const attrs = perf.calculate(map);
    const difficulty = attrs.difficulty;

    const stars = difficulty.stars;
    const maxCombo = difficulty.maxCombo || beatmap.max_combo || 0;
    
    // rosu-pp-js expone cs, ar, od, hp en su difficulty object
    const cs = difficulty.cs !== undefined ? difficulty.cs : beatmap.cs;
    const ar = difficulty.ar !== undefined ? difficulty.ar : beatmap.ar;
    const od = difficulty.od !== undefined ? difficulty.od : beatmap.accuracy;
    const hp = difficulty.hp !== undefined ? difficulty.hp : beatmap.drain;

    // Calcular velocidad ajustada por DT/HT
    let speedMultiplier = 1.0;
    if (activeModsStr.includes("DT") || activeModsStr.includes("NC")) {
        speedMultiplier = 1.5;
    } else if (activeModsStr.includes("HT")) {
        speedMultiplier = 0.75;
    }

    const bpm = (beatmap.beatmapset.bpm * speedMultiplier).toFixed(0);
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
    const roleColor = message.member.roles.highest.color || '#ffffff';
    const embedColor = roleColor !== 0 ? roleColor : (status_colors[beatmap.status] || '#ffffff');

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
**Dificultad:** \`${stars.toFixed(2)}★\` ${stars !== beatmap.difficulty_rating ? `*(Base: ${beatmap.difficulty_rating.toFixed(2)}★)*` : ''}
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
▸ **BPM:** \`${bpm}\` ${speedMultiplier !== 1.0 ? `*(Base: ${beatmap.beatmapset.bpm})*` : ''}
▸ **Duración:** \`${formatLength(totalLength)}\` *(Drain: ${formatLength(hitLength)})*
▸ **Combo Máximo:** \`x${maxCombo}\`
                `,
                inline: true
            },
            {
                name: '⚙️ Dificultad Física',
                value: `
▸ **CS:** \`${cs.toFixed(1)}\` ${cs !== beatmap.cs ? `*(Base: ${beatmap.cs})*` : ''}
▸ **AR:** \`${ar.toFixed(1)}\` ${ar !== beatmap.ar ? `*(Base: ${beatmap.ar})*` : ''}
▸ **OD:** \`${od.toFixed(1)}\` ${od !== beatmap.accuracy ? `*(Base: ${beatmap.accuracy})*` : ''}
▸ **HP:** \`${hp.toFixed(1)}\` ${hp !== beatmap.drain ? `*(Base: ${beatmap.drain})*` : ''}
                `,
                inline: true
            },
            {
                name: '🎯 Conteo de Objetos',
                value: `
▸ **Círculos:** \`${beatmap.count_circles}\`
▸ **Sliders:** \`${beatmap.count_sliders}\`
▸ **Spinners:** \`${beatmap.count_spinners}\`
                `,
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
                .setURL(`https://api.nerinyan.moe/d/${beatmap.beatmapset_id}`),
            new ButtonBuilder()
                .setLabel('Nerinyan (No Video)')
                .setStyle(ButtonStyle.Link)
                .setURL(`https://api.nerinyan.moe/d/${beatmap.beatmapset_id}?novideo=1`),
            new ButtonBuilder()
                .setLabel('Sayobot')
                .setStyle(ButtonStyle.Link)
                .setURL(`https://txy1.sayobot.cn/beatmaps/download/full/${beatmap.beatmapset_id}`),
            new ButtonBuilder()
                .setLabel('Sayobot (No Video)')
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