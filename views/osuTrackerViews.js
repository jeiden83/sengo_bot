const { EmbedBuilder } = require("discord.js");
const { t } = require("../utils/i18n.js");

/**
 * Genera el embed de ayuda para el comando track.
 */
function doTrackHelpEmbed(prefix, locale = "es") {
    return new EmbedBuilder()
        .setTitle(t(locale, "track.help_title"))
        .setDescription(t(locale, "track.help_desc", { prefix }))
        .setColor("#FF66AA");
}

/**
 * Genera el embed de éxito al agregar un usuario al tracking.
 */
function doTrackAddEmbed(osuUsername, osuId, userMention, channelId, locale = "es", topLimit = null, guildLimit = 100) {
    const limitInfo = (topLimit !== null && topLimit !== undefined)
        ? t(locale, "track.list_limit_custom", { limit: topLimit })
        : t(locale, "track.list_limit_guild", { limit: guildLimit });

    return new EmbedBuilder()
        .setTitle(t(locale, "track.add_success_title"))
        .setDescription(t(locale, "track.add_success_desc", {
            osuUsername,
            osuId,
            userMention: userMention ? `(${userMention})` : "",
            channelId,
            limitInfo
        }))
        .setColor("#55FF55");
}

/**
 * Genera el embed de éxito al remover un usuario del tracking.
 */
function doTrackRemoveEmbed(osuUsername, osuId, locale = "es") {
    return new EmbedBuilder()
        .setTitle(t(locale, "track.remove_success_title"))
        .setDescription(t(locale, "track.remove_success_desc", {
            osuUsername,
            osuId
        }))
        .setColor("#FF5555");
}

/**
 * Genera el embed con la lista de usuarios trackeados.
 */
function doTrackListEmbed(guildName, trackedUsers, channelId, locale = "es", guildLimit = 100) {
    const channelInfo = channelId 
        ? t(locale, "track.list_channel_info", { channelId, guildLimit }) 
        : t(locale, "track.list_no_channel");

    const lines = trackedUsers.map((u, i) => {
        const discordMention = u.discord_id 
            ? `<@${u.discord_id}>` 
            : t(locale, "track.list_no_discord");
        const limitTag = (u.top_limit !== null && u.top_limit !== undefined)
            ? t(locale, "track.list_limit_custom", { limit: u.top_limit })
            : t(locale, "track.list_limit_guild", { limit: guildLimit });
        return `**${i + 1}.** [${u.osu_username}](https://osu.ppy.sh/users/${u.osu_id}) (ID: \`${u.osu_id}\`) - ${discordMention} • ${limitTag}`;
    });

    const description = `${channelInfo}\n\n${lines.join("\n")}`;

    return new EmbedBuilder()
        .setTitle(t(locale, "track.list_title", { guildName }))
        .setDescription(description)
        .setColor("#FF66AA")
        .setFooter({ text: t(locale, "track.list_footer", { count: trackedUsers.length }) });
}

module.exports = {
    doTrackHelpEmbed,
    doTrackAddEmbed,
    doTrackRemoveEmbed,
    doTrackListEmbed
};
