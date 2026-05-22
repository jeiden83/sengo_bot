const { getOsuUser, argsParser } = require("../../utils/osu.js");
const axios = require('axios');
const { doOsuSnipesEmbed } = require("../../../views/osuEmbeds.js");

async function fetchSnipedPlayerData(country_code, user_id) {
    const url = `https://api.snipe.huismetbenen.nl/player/${country_code}/${user_id}/`;
    
    try {
        const response = await axios.get(url);
        return response;   
    } catch (error) {
        console.error('Error al obtener los datos:', error.response ? error.response.data : error.message);
        return "Error de peticion";
    }
}

async function run(messages, args){
    const { message, res } = messages;

    // Parseamos args
    const osu_userdata = await argsParser(args,
        {"message" : message, "res" : res, "command_function" : getOsuUser});  

    // Obtenemos el nombre y pais, y obtenemos los datos de la pagina
    const { country_code, id } = osu_userdata.fn_response;
    const sniped_userdata = await fetchSnipedPlayerData(country_code, id);

    return doOsuSnipesEmbed(message, sniped_userdata.data, osu_userdata.fn_response);
}

run.description = 
{
    'header' : 'Numero de tops nacionales',
    'body' : 'Toma en cuenta la pagina \`https://snipe.huismetbenen.nl/\` para esto. \nTe dice cuantos tops nacionales tienes, el promedio de pp por top, los mods mas usados y el año en el que snipeaste mas gente.',
    'usage' : `s.snipes : Obtiene los snipes del usuario linkeado al bot \ns.snipes 'usuario' : Los snipes del usuario en el argumento.`
}

module.exports = { run }