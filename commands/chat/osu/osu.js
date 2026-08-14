const { getOsuUser, argsParser } = require("../../utils/osu.js");
const { doOsuProfileEmbed, doOsuUserBadgesEmbed } = require("../../../views/osuEmbeds.js");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { t } = require("../../../utils/i18n.js");

async function getOsuWorldUser(userId, mode) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
        let url = `https://osuworld.octo.moe/api/users/${userId}`;
        if (mode) {
            let osuWorldMode = mode.toLowerCase();
            if (osuWorldMode === 'ctb' || osuWorldMode === 'fruits') {
                osuWorldMode = 'fruits';
            }
            url += `?mode=${osuWorldMode}`;
        }
        const response = await fetch(url, {
            signal: controller.signal
        });
        clearTimeout(timeout);
        if (!response.ok) return null;
        const data = await response.json();
        if (data && data.error) return null;
        return data;
    } catch (e) {
        clearTimeout(timeout);
        return null;
    }
}

async function run(messages, args) {
    const { message, res, logger } = messages;
    const locale = message.locale || 'es';

    if (logger) logger.process("Consultando base de datos y API de osu!");
    const osu_userdata = await argsParser(args,
        { "message": message, "res": res, "command_function": getOsuUser, "resolveUserByIndex": true, "ignoreBeatmap": true });

    if (!osu_userdata.fn_response || typeof osu_userdata.fn_response === 'string') {
        return osu_userdata.fn_response;
    }

    // Preload de recomendaciones de farm en segundo plano
    if (osu_userdata.fn_response && osu_userdata.fn_response.id) {
        const recommendCommand = require("./recommend.js");
        if (recommendCommand.preloadDefaultRecommendation) {
            recommendCommand.preloadDefaultRecommendation(
                osu_userdata.fn_response.id.toString(),
                osu_userdata.fn_response.username,
                osu_userdata.fn_response.avatar_url,
                res
            ).catch(() => {});
        }

        // Actualizar el estado de supporter en segundo plano si está en la DB
        const OsuUserModel = require("../../../models/OsuUserModel.js");
        if (OsuUserModel.updateSupporterStatusInBackground) {
            OsuUserModel.updateSupporterStatusInBackground(
                osu_userdata.fn_response.id.toString(),
                osu_userdata.fn_response.is_supporter
            ).catch(() => {});
        }

        // Actualizar estadísticas de Ranked Play en segundo plano
        const OsuMatchmakingModel = require("../../../models/OsuMatchmakingModel.js");
        if (OsuMatchmakingModel.updateUserRankedStatsInBackground) {
            OsuMatchmakingModel.updateUserRankedStatsInBackground(osu_userdata.fn_response);
        }
    }

    const is_detailed = osu_userdata.parsed_args.detailed || false;

    let osuworld_data = null;
    if (osu_userdata.fn_response && osu_userdata.fn_response.id) {
        osuworld_data = await getOsuWorldUser(osu_userdata.fn_response.id, osu_userdata.parsed_args.gamemode);
    }

    const result = doOsuProfileEmbed(message, osu_userdata.fn_response, (osu_userdata.parsed_args.gamemode), is_detailed, osuworld_data, locale);
    if (!result || !result.embeds) return result;

    const hasBadges = osu_userdata.fn_response.badges && Array.isArray(osu_userdata.fn_response.badges) && osu_userdata.fn_response.badges.length > 0;

    if (is_detailed && hasBadges) {
        const badgesBtnRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('profile_show_badges')
                .setLabel(t(locale, 'profile.badges_btn', { count: osu_userdata.fn_response.badges.length }) || `Insignias (${osu_userdata.fn_response.badges.length})`)
                .setEmoji('🎖️')
                .setStyle(ButtonStyle.Secondary)
        );
        result.components = [badgesBtnRow];

        const sentMessage = await message.channel.send(result);
        if (!sentMessage || typeof sentMessage.createMessageComponentCollector !== 'function') {
            return null;
        }

        let currentBadgePage = 1;
        const totalBadges = osu_userdata.fn_response.badges.length;
        const totalBadgePages = Math.max(1, Math.ceil(totalBadges / 5));

        const collector = sentMessage.createMessageComponentCollector({
            filter: btnInt => btnInt.user.id === message.author.id,
            idle: 120000
        });

        collector.on('collect', async i => {
            try {
                await i.deferUpdate();
                const btnId = i.customId;

                if (btnId === 'profile_show_badges') {
                    currentBadgePage = 1;
                    const badgesEmbed = doOsuUserBadgesEmbed(message, osu_userdata.fn_response, currentBadgePage, locale);
                    await sentMessage.edit(badgesEmbed);
                } else if (btnId === 'badges_back') {
                    await sentMessage.edit(result);
                } else if (btnId === 'badges_first') {
                    currentBadgePage = 1;
                    const badgesEmbed = doOsuUserBadgesEmbed(message, osu_userdata.fn_response, currentBadgePage, locale);
                    await sentMessage.edit(badgesEmbed);
                } else if (btnId === 'badges_last') {
                    currentBadgePage = totalBadgePages;
                    const badgesEmbed = doOsuUserBadgesEmbed(message, osu_userdata.fn_response, currentBadgePage, locale);
                    await sentMessage.edit(badgesEmbed);
                } else if (btnId === 'badges_prev') {
                    currentBadgePage = Math.max(1, currentBadgePage - 1);
                    const badgesEmbed = doOsuUserBadgesEmbed(message, osu_userdata.fn_response, currentBadgePage, locale);
                    await sentMessage.edit(badgesEmbed);
                } else if (btnId === 'badges_next') {
                    currentBadgePage = Math.min(totalBadgePages, currentBadgePage + 1);
                    const badgesEmbed = doOsuUserBadgesEmbed(message, osu_userdata.fn_response, currentBadgePage, locale);
                    await sentMessage.edit(badgesEmbed);
                }
            } catch (err) {
                console.error('[OSU-PROFILE] Error en collector de insignias:', err);
            }
        });

        collector.on('end', async () => {
            try {
                await sentMessage.edit({ components: [] });
            } catch {}
        });

        return null;
    }

    return result;
}

run.alias = {
    "mania": {
        "args": "-mania"
    },
    "minijuego": {
        "args": "-mania"
    },
    "ctb": {
        "args": "-ctb"
    },
    "taiko": {
        "args": "-taiko"
    },
    "std": {
        "args": ""
    },
    "o": {
        "args": ""
    },
    "scores": {
        "args": "-d"
    },
}

run.description = {
    'header': t('es', 'commands.osu.header'),
    'body': t('es', 'commands.osu.body'),
    'usage': t('es', 'commands.osu.usage')
}

module.exports = { run, "description": run.description }