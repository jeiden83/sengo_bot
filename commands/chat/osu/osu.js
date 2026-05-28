const { getOsuUser, argsParser } = require("../../utils/osu.js");
const { doOsuProfileEmbed } = require("../../../views/osuEmbeds.js");

async function getOsuWorldUser(userId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
        const response = await fetch(`https://osuworld.octo.moe/api/users/${userId}`, {
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
        osuworld_data = await getOsuWorldUser(osu_userdata.fn_response.id);
    }

    return doOsuProfileEmbed(message, osu_userdata.fn_response, (osu_userdata.parsed_args.gamemode), is_detailed, osuworld_data);
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

run.description =
{
    'header': 'Para obtener el perfil de osu!',
    'body': 'Muestra el perfil de un usuario en osu! dado, sea el vinculado al bot o segun el argumento, con su banner bien hermoso y opción de ver detalles adicionales.',
    'usage': `s.osu : Muestra el perfil vinculado al bot.\ns.osu 'usuario_osu' : Muestra el perfil de std del usuario en el argumento.\ns.osu 'usuario_osu' -d : Muestra el perfil completo junto a las estadísticas y grados detallados.\ns.scores : Muestra tus estadísticas y grados detallados directos.`
}

module.exports = { run }