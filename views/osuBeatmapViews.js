const { EmbedBuilder } = require("discord.js");
const { getEmbedColor } = require("./osuViewHelpers.js");
const { t } = require("../utils/i18n.js");

/**
 * Renderiza el embed para mostrar el fondo de un beatmap.
 */
function doOsuBgEmbed(message, beatmap) {
    const beatmapset_id = beatmap.beatmapset_id;
    const bg_url = `https://assets.ppy.sh/beatmaps/${beatmapset_id}/covers/fullsize.jpg`;
    const embedColor = getEmbedColor(message);
    const locale = message.locale || 'es';

    return new EmbedBuilder()
        .setAuthor({
            name: t(locale, 'bg.embed_author', {
                artist: beatmap.beatmapset.artist,
                title: beatmap.beatmapset.title,
                version: beatmap.version
            }),
            url: `https://osu.ppy.sh/b/${beatmap.id}`
        })
        .setImage(bg_url)
        .setColor(embedColor)
        .setFooter({
            text: t(locale, 'bg.embed_footer', { id: beatmapset_id }),
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();
}

module.exports = {
    doOsuBgEmbed
};
