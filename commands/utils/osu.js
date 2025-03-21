const { Client, Auth } = require('osu-web.js'); // A remplazar por el nuevo 'osu-api-extended'
const { auth, v2 } = require('osu-api-extended');

const CONFIG = require("../../config.json");

const config = require("../../config.json");

const fs = require('fs');
const path = require('path');

const axios = require('axios');

async function loadToken(){
    const fs = require('fs/promises');
    const tokenFilePath = path.resolve('osu_token.json');

    try{
        const osu_token = JSON.parse(await fs.readFile(tokenFilePath, 'utf-8'));
        
        if(Date.now() >= osu_token.expires_at)
            return await createToken();

        return osu_token;
    } catch(error){

        return await createToken();
    }
    
    async function createToken() {
        const auth = new Auth(config.OSU_CLIENT_ID, config.OSU_CLIENT_SECRET, "");
        const osu_token = await auth.clientCredentialsGrant();

        const accessTokenData = {
            access_token: osu_token.access_token,
            expires_in: osu_token.expires_in,
            token_type: osu_token.token_type,
            expires_at: Date.now() + osu_token.expires_in * 1000
        };

        await fs.writeFile(tokenFilePath, JSON.stringify(accessTokenData, null, 2));

        console.log("# Token recargado");

        return osu_token;
    }
}

async function NewloadToken(){
    await auth.login({
        type: 'v2',
        client_id: CONFIG.OSU_CLIENT_ID,
        client_secret: CONFIG.OSU_CLIENT_SECRET,
        cachedTokenPath: './osu_token.json' 
      });
}

// Usado para guardar la score del usuario de forma local
// Clave para tener una db propia de scores de usuarios
function saveUserscore(recent_scores, pre_calculated) {
    const unranked_statuses = new Set(['pending', 'graveyard', 'qualified']);

    const score = {
        "accuracy": recent_scores.accuracy,
        "ended_at": recent_scores.ended_at,
        "legacy_total_score": recent_scores.legacy_total_score,
        "max_combo": recent_scores.max_combo,
        "statistics": recent_scores.statistics,
        "mods": recent_scores.mods,
        "passed": recent_scores.passed,
        "pp": pre_calculated.pp,
        "rank": recent_scores.rank,
        "started_at": recent_scores.started_at,
        "total_score": recent_scores.total_score,
        "username": recent_scores.user.username,
        "map_completion": pre_calculated.map_completion,
        "beatmap_max_combo": pre_calculated.beatmap_max_combo
    };

    if (unranked_statuses.has(recent_scores.beatmap.status) || !score.passed) {
        const scoresPath = path.join(__dirname, '../../db/local/scores');
        const folderPath = path.join(scoresPath, `${recent_scores.beatmap.id}`, `${recent_scores.user_id}`);

        // Crear las carpetas necesarias si no existen
        fs.mkdirSync(folderPath, { recursive: true });

        const files = fs.readdirSync(folderPath).filter(file => file.endsWith('.json'));

        if (!score.passed) {
            const filePath = path.join(folderPath, '0.json');
            if (fs.existsSync(filePath)) {
                const existingScore = JSON.parse(fs.readFileSync(filePath));
                if (pre_calculated.map_completion > existingScore.map_completion) {
                    fs.writeFileSync(filePath, JSON.stringify(score, null, 2));
                }
            } else {
                fs.writeFileSync(filePath, JSON.stringify(score, null, 2));
            }
        } else {
            // Ordenar archivos por PP de forma descendente
            const scores = files.map(file => {
                const data = JSON.parse(fs.readFileSync(path.join(folderPath, file)));
                return { file, pp: data.pp };
            }).filter(s => s.pp !== undefined && s.pp > 0);

            scores.sort((a, b) => b.pp - a.pp);

            // Verificar si ya existe una puntuación con el mismo PP (duplicado)
            if (scores.some(s => s.pp == pre_calculated.pp)) return;

            // Calcular el índice adecuado para la nueva puntuación
            let index = 1;
            for (let i = 0; i < scores.length; i++) {
                if (pre_calculated.pp > scores[i].pp) break;
                index++;
            }

            // Mover archivos para mantener el orden de PP
            for (let i = scores.length; i >= index; i--) {
                const oldPath = path.join(folderPath, `${i}.json`);
                const newPath = path.join(folderPath, `${i + 1}.json`);
                fs.renameSync(oldPath, newPath);
            }

            // Guardar la nueva puntuación en la posición correspondiente
            const filePath = path.join(folderPath, `${index}.json`);
            fs.writeFileSync(filePath, JSON.stringify(score, null, 2));
        }
    }
}


async function getUserRecentScores(parsed_args){
    await NewloadToken();

    const result = await v2.scores.list({
        type: 'user_recent',
        user_id: parsed_args.username[0],
        mode: parsed_args.gamemode || 'osu',
        include_fails: true,
      });


    return result;
}

async function getOsuUser(parsed_args){
    const osu_token = await loadToken();
    const look_gamemode = parsed_args.gamemode || 'osu';
    let res;

    try {
        
        res = await new Client(osu_token.access_token).users.getUser(parsed_args.username[0], {urlParams:{mode: look_gamemode}});
        
        if(res.username === "undefined") throw("error");
    } catch (error) {

        res = `El usuario no se encuentra en osu!`;
    }
    
    return res;
}

// Obtener y descargar el beatmap.osu dado el id del set y del .osu
// Usado principalmente para el calculo de pp
async function getBeatmap_osu(beatmapset_id, beatmap_osu_id) {

    // Ruta del archivo con la estructura correcta
    const beatmapsetPath = path.join(__dirname, '../../db/local/beatmap.osu');
    const folderPath = path.join(beatmapsetPath, `${beatmapset_id}`);
    const filePath = path.join(folderPath, `${beatmap_osu_id}.osu`);

    // Verificar si el archivo ya existe en la carpeta /osu/
    if (fs.existsSync(filePath)) {
		
        // console.log(`Archivo encontrado en caché: ${filePath}`);
        return filePath;
    }

    // Realizar la solicitud HTTP si el archivo no está en caché
    const options = {
        method: 'GET',
        url: `https://catboy.best/osu/${beatmap_osu_id}`
    };

    try {
        const { data } = await axios.request(options);

        // Crear la carpeta /osu/ con la estructura correcta si no existe
        fs.mkdirSync(folderPath, { recursive: true });

        // Guardar el archivo en la carpeta /osu/
        fs.writeFileSync(filePath, data);
        // console.log(`Archivo descargado y guardado en: ${filePath}`);
        return filePath;
    } catch (error) {

        console.error('Error al descargar el beatmap:', error.message);
        throw error;
    }
}

// Obtener los detalles de una dificultad de un beatmap dado
async function getBeatmap(beatmap_id){
    await NewloadToken();

    const result = await v2.beatmaps.details({
        type: 'difficulty',
        id: beatmap_id
      });

    return result;
}

async function getBeatmapUserScore(parsed_args) {
    const osu_token = await loadToken();
    
    const gamemode = parsed_args.gamemode || 'osu';
    const mods = parsed_args.mods || '';

    const beatmapId = parsed_args.beatmap_url;
    const userId = parsed_args.username[0];

    const url = `https://osu.ppy.sh/api/v2/beatmaps/${beatmapId}/scores/users/${userId}`;

    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${osu_token.access_token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            params: {
                legacy_only: 0,
                mode: gamemode,
                mods: mods
            }
        });

        return response.data;
    } catch (error) {
        return 'Error obteniendo las puntuaciones'
    }
}

async function getBeatmapUserAllScores(parsed_args) {
    
    const osu_token = await loadToken();
    const gamemode = parsed_args.gamemode || 'osu';
    
    const beatmapId = parsed_args.beatmap_url;
    const userId = parsed_args.username[0];

    const url = `https://osu.ppy.sh/api/v2/beatmaps/${beatmapId}/scores/users/${userId}/all`;
    
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${osu_token.access_token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            params: {
                legacy_only: 0, 
                ruleset: gamemode
            }
        });

        const data = response.data;

        // to dump data for debuggin
        // const fs = require('fs');
        // const filePath = `./scores_${userId}_${beatmapId}.json`;
        // fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        // console.log(`Datos guardados en: ${filePath}`);

        return data;
    } catch (error) {
        console.error('Error obteniendo las puntuaciones:', error);
        return 'Error obteniendo las puntuaciones';
    }
}

async function getRecentScores(parsed_args, limit = 5, page = 0, include_fails = true){
    const osu_token = await loadToken();
    const gamemode = parsed_args.gamemode || 'osu';

    const res = await new Client(osu_token.access_token).users.getUserScores(parsed_args.username[0], 'recent', {
        query:{
            limit : limit,
            mode : gamemode,
            offset : page,
            include_fails : include_fails
        }})

    return res[0];
}

async function findBeatmapInChannel(message, isReply){
    let embedMessage = message;

    if(!isReply){
        const fetch_messages = await message.channel.messages.fetch({ limit: 30 });  // limite de 30 msj a revisar  

        embedMessage = await fetch_messages.find(
            m => m.embeds.length > 0 && (
                (m.embeds[0].url && typeof m.embeds[0].url === 'string') || 
                (m.embeds[0].author && m.embeds[0].author.url && typeof m.embeds[0].author.url === 'string')
            )
        );
    }

    // Si no se encuentra un mensaje
    if(!embedMessage){

        return {'beatmap_url' : null, 'bad_response' : `No se encontro un mapa al cual hacerle >c`};
    }

    // Guardamos la url del mapa encontrado
    try{

        const beatmap_url = embedMessage.embeds[0].url
        ? embedMessage.embeds[0].url.match(/(?:b|beatmaps)\/(\d+)/)[1]
        : embedMessage.embeds[0].author.url.match(/(?:b|beatmaps)\/(\d+)/)[1];
        
        return {'beatmap_url' : beatmap_url, 'bad_response' : `shh`};
    } catch(TypeError){

        console.log("<#> TypeError");
        return {'beatmap_url' : null, 'bad_response' : `No se encontro un mapa al cual hacerle >c`};
    }
}

async function parsingCommandFunction(parsed_args, command_parameters){
    const {message, res, command_function, beatmap_url} = command_parameters;
    const discord_id = message.author.id;
    let user_found;
    
    // Buscamos el user linkeado con el bot 
    user_found = await res.User.findOne({ discord_id });

    // Si no hay args
    const no_args = Object.values(parsed_args).flat().filter(el => el !== '').length == 0;
    if(no_args || parsed_args.override === 'rm' && parsed_args.username[0] == ''){

        // si no hay uno linkeado al bot
        if(!user_found) return {'fn_response': `No se encontro un usuario en \`osu\` linkeado al usuario \`${message.author.username}\` de discord.`, 'user_found': user_found, 'reparsed_args': parsed_args};

        // Aplicamos el comando con el linkeado al bot
        const fn_response = await command_function({'username' : [user_found.osu_id], 'beatmap_url' : beatmap_url, 'gamemode' : parsed_args.gamemode});
        return {'fn_response': fn_response, 'user_found': user_found, 'reparsed_args': parsed_args};
    // Si hay args
    } else {

        // Si entre los args hubo uno de username
        if(parsed_args.username.length != 0 && parsed_args.username[0] != "") {
            
            // Para manejar mejor el username
            let arg_user = parsed_args.username[0].split(" ")[0];

            // Si es una id de discord, buscamos en la db y actualizamos el parsed_arg con la id de osu vinculada
            if(arg_user.length >= 17) {
                user_found = await res.User.findOne({ discord_id : arg_user });

                if(!user_found) return {'fn_response': `No se encontro ese usuario de discord linkeado al bot.`, 'user_found': user_found, 'reparsed_args': parsed_args};
                parsed_args.username[0] = user_found.osu_id;

            // Se busca el nombre de osu 
            } else {

                // Se actualiza para cambiarlo a la id
                parsed_args.username[0] = (await getOsuUser(parsed_args)).id;
            }

        // Si no hubo un username entre los args
        } else {

            // Se usa el linkeado al bot
            if(!user_found) return `No se encontro un usuario en \`osu\` linkeado al usuario \`${message.author.username}\` de discord.`;
            parsed_args.username[0] = user_found.osu_id;
        }

        // Se hace la peticion con los args
        parsed_args['beatmap_url'] = beatmap_url;   // agregamos para el >c

        const fn_response = await command_function(parsed_args);

        return {'fn_response': fn_response, 'user_found': user_found, 'reparsed_args': parsed_args};
    }
}

function argsParserNoCommand(args) {
    let username = [];
    let gamemode = '';
    let args_aux = new String(args);

    const gamemode_set = {
        'mania': 'mania', 'osu': 'osu', 'std': 'osu', 'taiko': 'taiko', 'ctb': 'fruits', 'fruits': 'fruits'
    };

    const args_commands = [

        // Si empieza con un guion
        function (args) {
            if (gamemode_set[args.slice(1)]) {
                gamemode = gamemode_set[args.slice(1)];
                return true;
            }
            return false;
        },

        // Si empieza con el selector de modo
        function (args) {
            if (args.startsWith("m=")) {
                gamemode = gamemode_set[args.split("=")[1]];
                return true;
            }
            if (args.startsWith("mode") || args.startsWith("modo")) {
                gamemode = gamemode_set[args.split("=")[1]];
                return true;
            }
            return false;
        },

        // Si empieza con <@ y termina con > (discord_tag)
        function (args) {
            if (args.startsWith("<@") && args.endsWith(">")) {
                username.push(args.match(/\d+/)[0]);
                return true;
            }
            return false;
        },

        // Si el argumento es un numero de tamaño 18 (discord_id)
        function (args) {
            if (args.length >= 17) {
                username.push(args);
                return true;
            }
            return false;
        }
    ];

    // Separamos por las comas y revisamos cada args_commands por cada args del mensaje
    args_aux.split(",").forEach(arg => {
        let handled = false;

        args_commands.forEach(fn => {

            if (fn(arg)) {
                handled = true;
            }
        });

        if (!handled) {
            username.push(arg);
        }
    });


    let parsed_args = {
        'username': [username.map(x => x.replace(`"`, "")).join(" ").trim()],
        'gamemode': gamemode
    };
    return parsed_args;
}

async function argsParser(args, command_parameters){
    const parsed_args = argsParserNoCommand(args);
    const { fn_response, user_found, reparsed_args} = await parsingCommandFunction(parsed_args, command_parameters);

    return {
        'fn_response': fn_response,
        'parsed_args': reparsed_args,
        'user_found': user_found        
    }
}

module.exports = { 
    getBeatmap_osu,
    saveUserscore,
    getUserRecentScores,
    getBeatmap,
    findBeatmapInChannel,
    parsingCommandFunction,
    getBeatmapUserScore,
    loadToken, 
    getOsuUser, 
    getRecentScores, 
    argsParser, 
    argsParserNoCommand, 
    getBeatmapUserAllScores}