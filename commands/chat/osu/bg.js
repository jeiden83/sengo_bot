const { getBeatmap, findBeatmapInChannel, argsParserNoCommand } = require("../../utils/osu.js");
const { doOsuBgEmbed } = require("../../../views/osuBeatmapViews.js");

async function run(messages, args) {
    const { message, reply } = messages;
    const parsed_args = argsParserNoCommand(args);

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
        const { beatmap_url } = reply ? await findBeatmapInChannel(reply, true, parsed_args.index) : await findBeatmapInChannel(message, false, parsed_args.index);
        if (!beatmap_url) {
            return `❌ No se encontró ningún mapa en el historial del canal para obtener el fondo.`;
        }
        beatmap_id = beatmap_url;
    }

    // 3. Obtener metadatos del beatmap
    let beatmap;
    try {
        beatmap = await getBeatmap(beatmap_id);
    } catch (e) {
        return `❌ No se pudieron cargar los metadatos del mapa con ID \`${beatmap_id}\`.`;
    }

    // 4. Construir Embed utilizando la capa de visualización (View)
    const embed = doOsuBgEmbed(message, beatmap);

    if (reply) {
        reply.reply({ embeds: [embed] });
        return;
    }

    return { embeds: [embed] };
}

run.description = {
    'header': 'Muestra el fondo en alta resolución de un beatmap',
    'body': 'Obtiene y envía la imagen de fondo (Background) en alta resolución del último mapa enviado en el canal o del mapa especificado.',
    'usage': 's.bg : Envía el fondo del último mapa del canal.\ns.bg <id_mapa> : Envía el fondo de un mapa por su ID.'
};

module.exports = { run, "description": run.description };