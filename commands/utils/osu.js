const { Client, Auth } = require('osu-web.js'); // A remplazar por el nuevo 'osu-api-extended'
const { auth, v2 } = require('osu-api-extended');
const { Collection } = require('discord.js');

const { localBeatmapStatus } = require("./admin.js");

const CONFIG = require("../../config.json");

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');
const rosu = require("rosu-pp-js");

function calculatePP(recent_scores, map, maximo_pp, Attrs){
	// Se consiguen las estadisticas de la score
	const { great = 0, ok = 0, meh = 0, miss = 0, large_tick_hit = 0, slider_tail_hit = 0, ignore_hit = 0} = recent_scores.statistics;

	// Para el SS
	const max_perfomance_constructor = { 
		mods: recent_scores.mods, 
		lazer: recent_scores.started_at ? true : false,
	};

	const difficulty_constructor = {
		...max_perfomance_constructor,
		
		maxCombo: recent_scores.max_combo,
		misses: miss,
		n300: great,
		n100: ok,
		n50: meh
	}

	if (recent_scores.statistics.large_tick_hit !== undefined) difficulty_constructor.largeTickHits = recent_scores.statistics.large_tick_hit;
	if (recent_scores.statistics.slider_tail_hit !== undefined) difficulty_constructor.sliderEndHits = recent_scores.statistics.slider_tail_hit;
	if (recent_scores.statistics.ignore_hit !== undefined) difficulty_constructor.smallTickHits = recent_scores.statistics.ignore_hit;

	// Por si se quiere calcular el maximo PP del mapa dado
	if(maximo_pp){

		const maxAttrs = new rosu.Performance(max_perfomance_constructor).calculate(Attrs ? Attrs : map); // Por si no hay atributos se calcula con el mapa
		return maxAttrs;
	}

	// Total de objetos hiteados
	const total_hits = great + ok + meh + miss;

	// Se construye la dificultad
	const difficulty = new rosu.Difficulty(max_perfomance_constructor);

	// Se calcula el PP gradual usando el total de hits exacto (para coincidir perfectamente con calculadoras precisas como bathbot)
	return difficulty.gradualPerformance(map).nth(difficulty_constructor, total_hits); // Por si no hay atributos se calcula con el mapa

}
// Para obtener las puntuaciones locales en un mapa dado su id y el id del usuario
function getUnrankedBeatmapUserAllScores(parsed_args) {
    const beatmapId = parsed_args.beatmap_url;
    const userId = parsed_args.username[0].toString();

    try {
        // Ruta base de las puntuaciones locales
        const baseScoresPath = path.join(__dirname, '../../db/local/scores');

        // Ruta de la carpeta del beatmap
        const beatmapFolder = path.join(baseScoresPath, beatmapId);

        // Verificar si existe la carpeta del beatmap
        if (!fs.existsSync(beatmapFolder)) {
            return [];
        }

        // Ruta de la carpeta del usuario dentro del beatmap
        const userScoresFolder = path.join(beatmapFolder, userId);

        // Verificar si existe la carpeta del usuario
        if (!fs.existsSync(userScoresFolder)) {
            return [];
        }

        // Crear un array para almacenar las puntuaciones
        const scores = [];

        // Leer todos los archivos .json dentro de la carpeta del usuario
        const files = fs.readdirSync(userScoresFolder).filter(file => file.endsWith('.json'));

        // Cargar el contenido de cada archivo y almacenarlo en el array
        for (const file of files) {
            const filePath = path.join(userScoresFolder, file);
            const fileData = fs.readFileSync(filePath, 'utf8');
            scores.push(JSON.parse(fileData));
        }

        return scores;

    } catch (error) {
        console.error('Error obteniendo las puntuaciones:', error);
        return 'Error obteniendo las puntuaciones';
    }
}

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
        const auth = new Auth(CONFIG.OSU_CLIENT_ID, CONFIG.OSU_CLIENT_SECRET, "");
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
function saveUserscore(recent_scores, pre_calculated, force_save = false) {
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
        "beatmap_max_combo": pre_calculated.beatmap_max_combo,
        "beatmap_status": recent_scores.beatmap.status,
    };

    // Play fallida en multi
    if(!score["passed"] && score["map_completion"] == 1) score.multi_failed = true;

    // Si es una play en un mapa unranked o es una play fallida, o si está forzado a guardar
    if (unranked_statuses.has(recent_scores.beatmap.status) || !score.passed || force_save) {
        const scoresPath = path.join(__dirname, '../../db/local/scores');
        const folderPath = path.join(scoresPath, `${recent_scores.beatmap.id}`, `${recent_scores.user_id}`);

        // Crear las carpetas necesarias si no existen
        fs.mkdirSync(folderPath, { recursive: true });

        const files = fs.readdirSync(folderPath).filter(file => file.endsWith('.json'));

        // Si es una play fallida
        if (!score.passed) {

            const filePath = path.join(folderPath, `${score.multi_failed ? '0_5' : '0'}.json`); // 0_5 para las fallidas en multi y 0 en solo
            
            if (fs.existsSync(filePath)) {
                const existingScore = JSON.parse(fs.readFileSync(filePath));
                // Reemplazar si es la misma play (mismo timestamp o misma puntuación) o si es mejor
                if (existingScore.ended_at === score.ended_at || existingScore.legacy_total_score === score.legacy_total_score || (score.multi_failed ? (score.pp > existingScore.pp) : (pre_calculated.map_completion > existingScore.map_completion))) {
                    fs.writeFileSync(filePath, JSON.stringify(score, null, 2));
                }
            } else {
                fs.writeFileSync(filePath, JSON.stringify(score, null, 2));
            }
        } else {
            // Obtener todas las puntuaciones existentes
            const existingScores = files
                .filter(file => /^[1-9]\d*\.json$/.test(file))
                .map(file => JSON.parse(fs.readFileSync(path.join(folderPath, file))));

            // Buscar si ya existe la misma play (por fecha o por PP idéntico)
            const samePlayIndex = existingScores.findIndex(s => s.ended_at === score.ended_at || s.pp === score.pp);

            if (samePlayIndex !== -1) {
                // Reemplazar la existente para aplicar correcciones de mods o zona horaria
                existingScores[samePlayIndex] = score;
            } else {
                existingScores.push(score);
            }

            // Ordenar por PP descendente
            existingScores.sort((a, b) => b.pp - a.pp);

            // Eliminar archivos numerados viejos para evitar desorden
            files.filter(file => /^[1-9]\d*\.json$/.test(file)).forEach(file => {
                fs.unlinkSync(path.join(folderPath, file));
            });

            // Guardar todas de nuevo con su nuevo indice
            existingScores.forEach((s, i) => {
                const filePath = path.join(folderPath, `${i + 1}.json`);
                fs.writeFileSync(filePath, JSON.stringify(s, null, 2));
            });
        }
    }
}

function convertGatariMods(modsBitmask) {
    const ModList = [
        { bit: 1, acronym: 'NF' },
        { bit: 2, acronym: 'EZ' },
        { bit: 8, acronym: 'HD' },
        { bit: 16, acronym: 'HR' },
        { bit: 32, acronym: 'SD' },
        { bit: 64, acronym: 'DT' },
        { bit: 128, acronym: 'RX' },
        { bit: 256, acronym: 'HT' },
        { bit: 512, acronym: 'NC' },
        { bit: 1024, acronym: 'FL' },
        { bit: 4096, acronym: 'SO' },
        { bit: 16384, acronym: 'PF' }
    ];
    let mods = [];
    for (let mod of ModList) {
        if ((modsBitmask & mod.bit) === mod.bit) {
            if (mod.acronym === 'NC') mods = mods.filter(m => m.acronym !== 'DT');
            if (mod.acronym === 'PF') mods = mods.filter(m => m.acronym !== 'SD');
            mods.push({ acronym: mod.acronym });
        }
    }
    return mods;
}

// Para obtener las puntuaciones recientes de un usuario en un mapa
async function getUserRecentScores(parsed_args){
    const server = parsed_args.server || 'bancho';

    if (server === 'gatari') {
        try {
            const modeMap = { 'osu': 0, 'taiko': 1, 'fruits': 2, 'mania': 3 };
            const m = modeMap[parsed_args.gamemode || 'osu'];
            
            const reqUrl = `https://api.gatari.pw/user/scores/recent?id=${parsed_args.username[0]}&mode=${m}&l=100`;
            const response = await fetch(reqUrl);
            const data = await response.json();
            
            if (!data.scores || data.scores.length === 0) return [];
            
            const userResponse = await fetch(`https://api.gatari.pw/users/get?u=${parsed_args.username[0]}`);
            const userData = await userResponse.json();
            const u = userData.users && userData.users[0] ? userData.users[0] : { username: "Unknown", id: parsed_args.username[0], country: "XX" };

            return data.scores.map(s => {
                const passed = s.ranking !== "F";
                return {
                    accuracy: s.accuracy / 100,
                    passed: passed,
                    rank: s.ranking,
                    mods: convertGatariMods(s.mods),
                    max_combo: s.max_combo,
                    statistics: {
                        perfect: s.count_gekis,
                        great: s.count_300,
                        good: s.count_katu,
                        ok: s.count_100,
                        meh: s.count_50,
                        miss: s.count_miss
                    },
                    pp: s.pp,
                    total_score: s.score,
                    legacy_total_score: s.score,
                    ended_at: new Date(s.time * 1000).toISOString(),
                    beatmap: {
                        id: s.beatmap.beatmap_id,
                        version: s.beatmap.version,
                        difficulty_rating: s.beatmap.difficulty,
                        mode: parsed_args.gamemode || 'osu',
                        beatmapset_id: s.beatmap.beatmapset_id
                    },
                    beatmapset: {
                        title: s.beatmap.title,
                        covers: { "cover@2x": `https://assets.ppy.sh/beatmaps/${s.beatmap.beatmapset_id}/covers/cover@2x.jpg` }
                    },
                    user: {
                        username: u.username,
                        id: u.id,
                        country_code: u.country,
                        avatar_url: `https://a.gatari.pw/${u.id}`,
                        server: 'gatari'
                    }
                };
            });
        } catch (e) {
            return [];
        }
    }

    await NewloadToken();

    const result = await v2.scores.list({
        type: 'user_recent',
        user_id: parsed_args.username[0],
        mode: parsed_args.gamemode || "osu",
        include_fails: true,
        limit: 100,
      });

    return result;
}

async function getOsuUser(parsed_args){
    const server = parsed_args.server || 'bancho';
    const look_gamemode = parsed_args.gamemode || 'osu';

    if (server === 'gatari') {
        try {
            const response = await fetch(`https://api.gatari.pw/users/get?u=${parsed_args.username[0]}`);
            const data = await response.json();
            
            const modeMap = { 'osu': 0, 'taiko': 1, 'fruits': 2, 'mania': 3 };
            const m = modeMap[look_gamemode];
            const statsRes = await fetch(`https://api.gatari.pw/user/stats?u=${parsed_args.username[0]}&mode=${m}`);
            const statsData = await statsRes.json();

            let achCount = [];
            if (data.users && data.users.length > 0) {
                const u = data.users[0];
                const achRes = await fetch(`https://api.gatari.pw/user/achievements?u=${u.id}`);
                const achText = await achRes.text();
                if (achText) {
                    try {
                        const achData = JSON.parse(achText);
                        if (achData.data) {
                            Object.values(achData.data).forEach(cat => {
                                if (cat.achievements) {
                                    achCount.push(...cat.achievements.filter(a => a !== null));
                                }
                            });
                        }
                    } catch (e) {}
                }
            }

            if (data.users && data.users.length > 0 && statsData.stats) {
                const u = data.users[0];
                const s = statsData.stats;
                return {
                    id: u.id,
                    username: u.username,
                    country_code: u.country,
                    avatar_url: `https://a.gatari.pw/${u.id}`,
                    cover_url: `https://a.gatari.pw/${u.id}`,
                    join_date: new Date(u.registered_on * 1000).toISOString(),
                    rank_highest: null,
                    user_achievements: achCount,
                    statistics: {
                        global_rank: s.rank,
                        pp: s.pp,
                        hit_accuracy: s.avg_accuracy,
                        play_count: s.playcount,
                        play_time: s.playtime,
                        level: { current: s.level, progress: s.level_progress },
                        rank: { country: s.country_rank }
                    },
                    server: 'gatari'
                };
            }
            throw new Error("User not found in Gatari");
        } catch (e) {
            return `El usuario no se encuentra en Gatari!`;
        }
    }

    const osu_token = await loadToken();
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
async function getBeatmap_osu(beatmapset_id, beatmap_osu_id, beatmap_metadata) {
    
    return new rosu.Beatmap(fs.readFileSync(await run()));
    
    async function run() {
        const unranked_statuses = new Set(['pending', 'graveyard', 'qualified']);
    
        // Ruta del archivo con la estructura correcta
        const beatmapsetPath = path.join(__dirname, '../../db/local/beatmap.osu');
        const folderPath = path.join(beatmapsetPath, `${beatmapset_id}`);
        const filePath = path.join(folderPath, `${beatmap_osu_id}.osu`);
    
        // Verificar si el archivo ya existe en la carpeta /osu/
        if (fs.existsSync(filePath)) {
    		
            const beatmap_index = localBeatmapStatus(beatmap_osu_id);
    
            // Si es un mapa rankeado entonces que lo devuelva, ya que ellos no sufren cambios
            if(!unranked_statuses.has(beatmap_metadata.status)){
    
                // Si no se encuentra en el index, pues que lo actualice
                if(!beatmap_index) localBeatmapStatus(beatmap_osu_id, beatmap_metadata);
                return filePath;
            }
    
            // Si en el index local el beatmap.osu tiene el mismo tiempo de modificacion que el que unranked que se obtuvo
            
            if(beatmap_index && beatmap_index.last_updated == beatmap_metadata.last_updated){
    
                return filePath;
            }
    
            // Si bien existe, es unranked y cambio su tiempo de modificacion, por lo cual hay que cambiar el actual tanto guardado
            // Como en el index
        }
    
        // Realizar la solicitud HTTP si el archivo no está en caché
        const options = {
            method: 'GET',
            url: `https://osu.direct/api/osu/${beatmap_osu_id}/raw`,
            httpsAgent: new https.Agent({
                rejectUnauthorized: false, // Ignorar certificados expirados
            }),
        };
    
        try {
            const { data } = await axios.request(options);
    
            // Crear la carpeta /osu/ con la estructura correcta si no existe
            fs.mkdirSync(folderPath, { recursive: true });
    
            // Guardar el archivo en la carpeta /osu/
            fs.writeFileSync(filePath, data);
    
            // Se actualiza el index de los beatmaps
            localBeatmapStatus(beatmap_osu_id, beatmap_metadata);
    
            return filePath;
        } catch (error) {
    
            console.error('Error al descargar el beatmap:', error.message);
            throw error;
        }
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

// Obtener los detalles de un beatmap dado su MD5 checksum
async function lookupBeatmapByMD5(md5){
    await NewloadToken();
    try {
        const result = await v2.beatmaps.lookup({ type: 'difficulty', checksum: md5 });
        return result;
    } catch(e) {
        return null;
    }
}

// Obtener los detalles de una score dada su ID online
async function getScoreDetails(score_id){
    await NewloadToken();
    try {
        const result = await v2.scores.details({ id: score_id });
        return result;
    } catch(e) {
        return null;
    }
}

// 
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

// Para obtener todas las puntuaciones de un usuario en un mapa dado
async function getBeatmapUserAllScores(parsed_args){
    await NewloadToken();

    const result = await v2.scores.list({
        type: 'user_beatmap_all',

        user_id: parsed_args.username[0],
        beatmap_id: parsed_args.beatmap_url,
        mode: parsed_args.gamemode || 'osu',
      });


    // buscamos tambien las locales, por si hay fallidas
    const local_scores = getUnrankedBeatmapUserAllScores(parsed_args);  

    return result.concat(typeof local_scores === "string" ? [] : local_scores);
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

    try {
        const extractId = str =>
            str?.match(/#(?:osu|taiko|fruits|mania)\/(\d+)/)?.[1] ||
            str?.match(/osu\.ppy\.sh\/b(?:eatmaps)?\/(\d+)/)?.[1] ||
            null;
    
        const e = embedMessage.embeds?.[0];
    
        let fields_url = null;
        if (e?.fields) {
            for (const field of e.fields) {
                const id = extractId(field.value) || extractId(field.name);
                if (id) {
                    fields_url = id;
                    break;
                }
            }
        }
    
        const beatmap_url =
            extractId(embedMessage.content) ||
            extractId(e?.url) ||
            extractId(e?.author?.url) ||
            extractId(e?.title) ||
            extractId(e?.description) ||
            fields_url;
    
        return beatmap_url
            ? { beatmap_url, bad_response: 'shh' }
            : { beatmap_url: null, bad_response: 'No se encontro un mapa al cual hacerle >c' };
    } catch {
        console.log("<#> TypeError");
        return { beatmap_url: null, bad_response: 'No se encontro un mapa al cual hacerle >c' };
    }
}

async function parsingCommandFunction(parsed_args, command_parameters){
    const {message, res, command_function, beatmap_url, gamemode} = command_parameters;
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
        const fn_response = await command_function({'username' : [user_found.osu_id], 'beatmap_url' : beatmap_url, 'gamemode' : user_found.main_gamemode});
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
                const osuUser = await getOsuUser(parsed_args);
                if (typeof osuUser === 'string') {
                    return {'fn_response': osuUser, 'user_found': user_found, 'reparsed_args': parsed_args};
                }
                parsed_args.username[0] = osuUser.id;
            }

        // Si no hubo un username entre los args
        } else {

            // Se usa el linkeado al bot
            if(!user_found) return `No se encontro un usuario en \`osu\` linkeado al usuario \`${message.author.username}\` de discord.`;
            parsed_args.username[0] = user_found.osu_id;
        }

        // Se hace la peticion con los args
        parsed_args['beatmap_url'] = beatmap_url;   // agregamos para el >c
        if (!parsed_args.gamemode && gamemode) parsed_args.gamemode = gamemode;

        const fn_response = await command_function(parsed_args);

        return {'fn_response': fn_response, 'user_found': user_found, 'reparsed_args': parsed_args};
    }
}

function argsParserNoCommand(args) {
    let username = [];
    let gamemode = args.gamemode || "";
    let server = args.server || "bancho";
    let index = 1;
    let listMode = false;
    let args_aux = new String(args);

    const gamemode_set = {
        'mania': 'mania', 'osu': 'osu', 'std': 'osu', 'taiko': 'taiko', 'ctb': 'fruits', 'fruits': 'fruits'
    };
    const server_set = {
        'gatari': 'gatari', 'bancho': 'bancho'
    };

    const args_commands = [

        // Si empieza con un guion
        function (args) {
            if (gamemode_set[args.slice(1)]) {
                gamemode = gamemode_set[args.slice(1)];
                return true;
            }
            if (server_set[args.slice(1)]) {
                server = server_set[args.slice(1)];
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
    let args_list = args_aux.split(",");
    let skip_next = false;

    for (let i = 0; i < args_list.length; i++) {
        if (skip_next) {
            skip_next = false;
            continue;
        }
        let arg = args_list[i].trim();
        if (!arg) continue;

        // Si es exactamente "-l"
        if (arg === "-l") {
            listMode = true;
            continue;
        }

        // Si es exactamente "-i"
        if (arg === "-i") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                let num = parseInt(next_arg);
                if (!isNaN(num)) {
                    index = num;
                    skip_next = true;
                    continue;
                }
            }
        }
        // Si empieza con "-i" seguido de un numero (ej: "-i2")
        if (arg.startsWith("-i")) {
            let num = parseInt(arg.slice(2));
            if (!isNaN(num)) {
                index = num;
                continue;
            }
        }

        let handled = false;

        args_commands.forEach(fn => {
            if (fn(arg)) {
                handled = true;
            }
        });

        if (!handled) {
            username.push(arg);
        }
    }


    let parsed_args = {
        'username': [username.map(x => x.replace(/"/g, "")).join(" ").trim()],
        'gamemode': gamemode,
        'server': server,
        'index': index,
        'listMode': listMode
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

async function getNewBeatmapUserScores(beatmapId, usersArray, gamemode = 'osu') {
    await NewloadToken();
    const scores = new Collection();

    const promises = usersArray.map(async (user) => {
        try {
            const result = await v2.scores.list({
                type: 'user_beatmap_best',
                beatmap_id: beatmapId,
                user_id: user.osu_id
            });

            if (result) {
                // Usamos user_id como clave para detectar duplicados luego
                scores.set(result.score.user_id.toString(), result.score);
            }
        } catch (error) {
            // console.log(`No result for: ${user.osu_id}`)
        }
    });

    const chunkSize = 10;
    for (let i = 0; i < promises.length; i += chunkSize) {
        await Promise.all(promises.slice(i, i + chunkSize));
    }

    const unrankedScores = await getUnrankedUserScores(beatmapId, gamemode);

    for (const [userId, score] of unrankedScores.entries()) {
        if (!scores.has(userId)) {
            scores.set(userId, score);
        }
    }

    return scores;
}

async function getUnrankedUserScores(beatmapId, gamemode = 'osu') {
    const scoresPath = path.join(process.cwd(), 'db/local/scores', `${beatmapId}`);
    const userScores = new Collection();

    if (!fs.existsSync(scoresPath)) return userScores;

    const userFolders = fs.readdirSync(scoresPath).filter(f => fs.statSync(path.join(scoresPath, f)).isDirectory());

    for (const userId of userFolders) {
        const folderPath = path.join(scoresPath, userId);
        const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.json'));

        for (const file of files) {
            const filePath = path.join(folderPath, file);
            try {
                const data = JSON.parse(fs.readFileSync(filePath));
                if (!userScores.has(userId)) userScores.set(userId, []);
                userScores.get(userId).push(data);
            } catch (e) {
                console.error(`Error leyendo ${filePath}:`, e);
            }
        }
    }

    // Crear nuevo Collection con la mejor play de cada usuario (por total_score)
    const bestPlays = new Collection();

    for (const [userId, scores] of userScores.entries()) {
        const best = scores.reduce((a, b) => (a.total_score > b.total_score ? a : b));
        bestPlays.set(userId, best);
    }

    return bestPlays;
}

module.exports = { 
    getUnrankedUserScores, 
    NewloadToken, 
    getNewBeatmapUserScores,
    getUnrankedBeatmapUserAllScores,
    getBeatmap_osu,
    saveUserscore,
    getUserRecentScores,
    getBeatmap,
    lookupBeatmapByMD5,
    getScoreDetails,
    findBeatmapInChannel,
    parsingCommandFunction,
    getBeatmapUserScore,
    loadToken, 
    getOsuUser, 
    getRecentScores, 
    argsParser, 
    argsParserNoCommand, 
    getBeatmapUserAllScores,
    calculatePP
}