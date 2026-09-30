const { getDailyChallenge, getDailyChallengeLeaderboard } = require("../../utils/osu.js");
const { doOsuDailyEmbed } = require("../../../views/osuDailyViews.js");
const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message } = messages;
    const locale = message.locale || 'es';

    try {
        const challenge = await getDailyChallenge();
        if (!challenge || !challenge.dailyRoom) {
            return t(locale, 'daily.err_no_daily');
        }

        const { dailyRoom, beatmap } = challenge;
        if (!beatmap) {
            return t(locale, 'daily.err_no_beatmap');
        }

        let leaderboard = [];
        try {
            leaderboard = await getDailyChallengeLeaderboard(dailyRoom.id);
        } catch (lbError) {
            console.error("Error al obtener la tabla de clasificación del Daily Challenge:", lbError);
        }

        // Construir Embed utilizando la capa de visualización (View)
        const embed = doOsuDailyEmbed(message, dailyRoom, beatmap, leaderboard);
        return { embeds: [embed] };

    } catch (error) {
        console.error("Error en s.daily:", error);
        return t(locale, 'daily.err_unexpected');
    }
}

run.alias = {
    "daily": {
        "args": ""
    }
};

run.description = {
    'header': t('es', 'commands.daily.header'),
    'body': t('es', 'commands.daily.body'),
    'usage': t('es', 'commands.daily.usage')
};

module.exports = { run, description: run.description };
