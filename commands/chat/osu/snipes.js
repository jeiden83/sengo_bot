const { getOsuUser, argsParser } = require("../../utils/osu.js");
const { t } = require("../../../utils/i18n.js");
const { getSupabaseClient } = require("../../../db/database.js");
const { doOsuSnipesEmbed, doOsuSnipesProgressEmbed } = require("../../../views/osuEmbeds.js");

const modeToInt = {
    'osu': 0,
    'taiko': 1,
    'fruits': 2,
    'mania': 3
};

async function run(messages, args){
    const { message, res } = messages;
    const locale = message.locale || 'es';

    // Parseamos argumentos de entrada del usuario
    const osu_userdata = await argsParser(args,
        {"message" : message, "res" : res, "command_function" : getOsuUser, "resolveUserByIndex": true, "ignoreBeatmap": true});  

    const { country_code, id } = osu_userdata.fn_response;
    const playmode = osu_userdata.fn_response.playmode || 'osu';
    const look_gamemode = modeToInt[playmode] ?? 0;

    // Solo soportamos Venezuela (VE) por ahora mientras se raspa la base de datos nacional
    if (country_code !== 'VE') {
        return t(locale, 'snipes.err_country_support');
    }

    const supabase = getSupabaseClient();

    // 1. Obtener total de mapas rankeados en este modo de juego
    const { count: totalMaps, error: errTotal } = await supabase
        .from('ranked_beatmaps')
        .select('beatmap_id', { count: 'exact', head: true })
        .eq('mode', look_gamemode);

    if (errTotal) {
        console.error("Error al obtener total de mapas en snipes.js:", errTotal);
        return t(locale, 'snipes.err_db_maps');
    }

    // 2. Obtener mapas que ya han sido procesados y guardados en top_scores en este modo de juego
    const { count: processedMaps, error: errProcessed } = await supabase
        .from('top_scores')
        .select('beatmap_id, ranked_beatmaps!inner(mode)', { count: 'exact', head: true })
        .eq('ranked_beatmaps.mode', look_gamemode);

    if (errProcessed) {
        console.error("Error al obtener mapas procesados en snipes.js:", errProcessed);
        return t(locale, 'snipes.err_db_progress');
    }

    const percentage = totalMaps > 0 ? (processedMaps / totalMaps) * 100 : 0;

    // Si el porcentaje es menor al 99.9%, mostramos la tarjeta de progreso
    if (percentage < 99.9) {
        return doOsuSnipesProgressEmbed(percentage, processedMaps, totalMaps, country_code, playmode, locale);
    }

    // 3. Si el poblamiento está completado (o es mayor a 99.9%), extraemos y adaptamos los datos de Supabase
    const { data: userScores, error: errUserScores } = await supabase
        .from('top_scores')
        .select('pp, mods, ended_at, ranked_beatmaps!inner(mode)')
        .eq('user_id', id.toString())
        .eq('ranked_beatmaps.mode', look_gamemode);

    if (errUserScores) {
        console.error("Error al obtener puntuaciones del usuario en snipes.js:", errUserScores);
        return t(locale, 'snipes.err_db_scores');
    }

    if (!userScores || userScores.length === 0) {
        return doOsuSnipesEmbed(message, null, osu_userdata.fn_response, locale);
    }

    const modsCount = {};
    const datesSet = {};
    let totalPP = 0;
    let countWithPP = 0;

    userScores.forEach(s => {
        // Agrupar mods
        const modsStr = s.mods || 'NM';
        if (modsStr === 'NM') {
            modsCount['NM'] = (modsCount['NM'] || 0) + 1;
        } else {
            const modsArr = modsStr.match(/.{1,2}/g) || [];
            modsArr.forEach(mod => {
                modsCount[mod] = (modsCount[mod] || 0) + 1;
            });
        }

        // Agrupar por año
        if (s.ended_at && s.ended_at !== new Date(0).toISOString()) {
            const year = new Date(s.ended_at).getFullYear();
            datesSet[year] = (datesSet[year] || 0) + 1;
        }

        // Promedio de PP
        if (typeof s.pp === 'number' && s.pp > 0) {
            totalPP += s.pp;
            countWithPP++;
        }
    });

    const averagePP = countWithPP > 0 ? (totalPP / countWithPP) : 0;

    const adaptedData = {
        count_total: userScores.length,
        average_pp: averagePP,
        mods_count: modsCount,
        dates_set: datesSet
    };

    return doOsuSnipesEmbed(message, adaptedData, osu_userdata.fn_response, locale);
}

run.description = {
    'header': t('es', 'commands.snipes.header'),
    'body': t('es', 'commands.snipes.body'),
    'usage': t('es', 'commands.snipes.usage')
};

module.exports = { run, "description": run.description };