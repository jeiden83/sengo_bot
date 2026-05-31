const { getOsuUser, argsParser } = require("../../utils/osu.js");
const { t } = require("../../../utils/i18n.js");
const axios = require('axios');
const { doOsuSnipesEmbed } = require("../../../views/osuEmbeds.js");

async function fetchSnipedPlayerData(country_code, user_id) {
    const url = `https://api.snipe.huismetbenen.nl/player/${country_code}/${user_id}/`;
    
    try {
        const response = await axios.get(url);
        return response;   
    } catch (error) {
        console.error('Error al obtener los datos:', error.response ? error.response.data : error.message);
        return null;
    }
}

async function run(messages, args){
    const { message, res } = messages;
    const locale = message.locale || 'es';

    // Parseamos args
    const osu_userdata = await argsParser(args,
        {"message" : message, "res" : res, "command_function" : getOsuUser, "resolveUserByIndex": true, "ignoreBeatmap": true});  

    // Obtenemos el nombre y pais, y obtenemos los datos de la pagina
    const { country_code, id } = osu_userdata.fn_response;
    const sniped_userdata = await fetchSnipedPlayerData(country_code, id);

    if (!sniped_userdata) {
        return t(locale, 'snipes.err_fetch');
    }

    return doOsuSnipesEmbed(message, sniped_userdata.data, osu_userdata.fn_response, locale);
}

run.description = {
    'header': t('es', 'commands.snipes.header'),
    'body': t('es', 'commands.snipes.body'),
    'usage': t('es', 'commands.snipes.usage')
};

module.exports = { run, "description": run.description };