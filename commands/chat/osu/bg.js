const { getBeatmap, findBeatmapInChannel } = require("../../utils/osu.js");
const { EmbedBuilder } = require("discord.js");

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

    const beatmapset_id = beatmap.beatmapset_id;
    // La imagen en alta resolución del fondo completo del mapa
    const bg_url = `https://assets.ppy.sh/beatmaps/${beatmapset_id}/covers/fullsize.jpg`;

    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ffffff';

    // 4. Construir Embed
    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Fondo de: ${beatmap.beatmapset.artist} - ${beatmap.beatmapset.title} [${beatmap.version}]`,
            url: `https://osu.ppy.sh/b/${beatmap.id}`
        })
        .setImage(bg_url)
        .setColor(embedColor)
        .setFooter({
            text: `SengoBot • Beatmapset ID: ${beatmapset_id}`,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

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