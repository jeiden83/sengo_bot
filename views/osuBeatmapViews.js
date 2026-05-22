const { EmbedBuilder } = require("discord.js");
const { getEmbedColor } = require("./osuViewHelpers.js");

/**
 * Renderiza el embed para mostrar el fondo de un beatmap.
 */
function doOsuBgEmbed(message, beatmap) {
    const beatmapset_id = beatmap.beatmapset_id;
    const bg_url = `https://assets.ppy.sh/beatmaps/${beatmapset_id}/covers/fullsize.jpg`;
    const embedColor = getEmbedColor(message);

    return new EmbedBuilder()
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
}

module.exports = {
    doOsuBgEmbed
};
