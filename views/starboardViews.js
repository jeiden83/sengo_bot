const { EmbedBuilder } = require("discord.js");
const { t } = require("../utils/i18n.js");

function doStarboardConfigEmbed({ message, config, locale }) {
    const entradaField = config?.from_channel 
        ? `\`${config.from_channel}\` : <#${config.from_channel}>` 
        : t(locale, 'starboard.no_from_channel');
        
    const starField = config?.star_channel 
        ? `\`${config.star_channel}\` : <#${config.star_channel}>` 
        : t(locale, 'starboard.no_star_channel');
        
    const logsField = config?.logs_channel 
        ? `\`${config.logs_channel}\` : <#${config.logs_channel}>` 
        : t(locale, 'starboard.no_logs_channel');

    const embed = new EmbedBuilder()
        .setAuthor({
            name: t(locale, 'starboard.config_title', { guildName: message.guild.name }),
            iconURL: message.guild.iconURL({ dynamic: true, size: 1024 })
        })
        .addFields(
            {
                name: t(locale, 'starboard.field_from_channel'),
                value: entradaField,
                inline: false
            },
            {
                name: t(locale, 'starboard.field_star_channel'),
                value: starField,
                inline: false
            },
            {
                name: t(locale, 'starboard.field_logs_channel'),
                value: logsField,
                inline: false
            },
            {
                name: t(locale, 'starboard.field_msg_limit'),
                value: `**\`${config?.msj_limit || t(locale, 'starboard.not_configured')}\`**`,
                inline: false
            },
            {
                name: t(locale, 'starboard.field_exp_reward'),
                value: `**\`${config?.exp_value || t(locale, 'starboard.not_configured')}\`**`,
                inline: true
            }
        )
        .setFooter({
            text: "Sengo",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

function doStarboardMsjEmbed({ message, result, config, locale }) {
    const embed = new EmbedBuilder()
        .setAuthor({
            name: t(locale, 'starboard.msg_author_title', { reactions: result.reactions, username: result.user.username }),
            iconURL: message.guild.iconURL({ dynamic: true, size: 1024 }),
            url: result.message.url
        })
        .setColor(message.member.roles.highest.color || '#ffffff')
        .setFooter({
            text: t(locale, 'starboard.msg_footer_exp', { username: result.user.username, exp: config?.exp_value || 0 }),
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp(result.message.createdTimestamp);

    const imageUrl = result.message.attachments.first()?.url ||
        result.message.embeds[0]?.image?.url ||
        null;
        
    embed.setImage(imageUrl);

    return embed;
}

module.exports = {
    doStarboardConfigEmbed,
    doStarboardMsjEmbed
};
