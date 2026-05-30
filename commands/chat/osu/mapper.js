const { getOsuUser, argsParser } = require("../../utils/osu.js");
const { doOsuMapperEmbed } = require("../../../views/osuUserViews.js");

async function run(messages, args) {
    const { message, res, logger } = messages;

    if (logger) logger.process("Consultando perfil de osu! y estadísticas de creador...");

    const osu_userdata = await argsParser(args, {
        "message": message,
        "res": res,
        "command_function": getOsuUser,
        "resolveUserByIndex": true,
        "ignoreBeatmap": true
    });

    if (!osu_userdata.fn_response || typeof osu_userdata.fn_response === 'string') {
        return osu_userdata.fn_response;
    }

    const osuUser = osu_userdata.fn_response;
    const embed = doOsuMapperEmbed(message, osuUser);
    
    return { embeds: [embed] };
}

run.alias = {
    "mapper": {
        "args": ""
    },
    "mapcreator": {
        "args": ""
    },
    "creator": {
        "args": ""
    }
};

run.description = {
    'header': 'Estadísticas de creador/mapper de un usuario',
    'body': 'Muestra estadísticas detalladas del mapper en osu! (seguidores, Kudosu, mapas rankeados, amados, graveyard, guest diffs y nominaciones).',
    'usage': `s.mapper : Muestra tus estadísticas como mapper.\ns.mapper 'usuario_osu' : Muestra las estadísticas de mapper del usuario especificado.`
};

module.exports = { run };
