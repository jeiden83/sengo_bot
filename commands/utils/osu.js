const { Client, Auth } = require('osu-web.js'); // A remplazar por el nuevo 'osu-api-extended'
const { auth, v2 } = require('osu-api-extended');
const { Collection } = require('discord.js');

const { localBeatmapStatus } = require("./admin.js");

const CONFIG = require("../../config.js");

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');
const rosu = require("rosu-pp-js");

const beatmapCache = new Map();
const userScoresCache = new Map();

function clearUserScoresCache(userId) {
    if (!userId) return;
    for (const key of userScoresCache.keys()) {
        if (key.startsWith(`${userId}:`)) {
            userScoresCache.delete(key);
        }
    }
}

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
async function getUnrankedBeatmapUserAllScores(parsed_args) {
    const beatmapId = parsed_args.beatmap_url;
    const userId = parsed_args.username[0].toString();

    try {
        const { getSupabaseClient } = require("../../db/database.js");
        const supabase = getSupabaseClient();

        if (!supabase) {
            console.warn("⚠️ Supabase no está conectado.");
            return [];
        }

        const { data, error } = await supabase
            .from('local_scores')
            .select('*')
            .eq('beatmap_id', beatmapId.toString())
            .eq('user_id', userId.toString())
            .order('pp', { ascending: false });

        if (error) {
            console.error('❌ Error obteniendo las puntuaciones de Supabase:', error.message);
            return 'Error obteniendo las puntuaciones';
        }

        return data || [];

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
        scopes: ['public'],
        cachedTokenPath: './osu_token.json' 
      });
}

// Usado para guardar la score del usuario en Supabase
// Clave para tener una db propia de scores de usuarios
async function saveUserscore(recent_scores, pre_calculated, force_save = false) {
    const unranked_statuses = new Set(['pending', 'graveyard', 'qualified']);

    const score = {
        "accuracy": recent_scores.accuracy,
        "ended_at": recent_scores.ended_at,
        "legacy_total_score": recent_scores.legacy_total_score,
        "max_combo": recent_scores.max_combo,
        "statistics": recent_scores.statistics,
        "mods": recent_scores.mods || [],
        "passed": recent_scores.passed !== undefined ? recent_scores.passed : true,
        "pp": pre_calculated.pp,
        "rank": recent_scores.rank,
        "started_at": recent_scores.started_at,
        "total_score": recent_scores.total_score,
        "username": recent_scores.user.username,
        "map_completion": pre_calculated.map_completion,
        "beatmap_max_combo": pre_calculated.beatmap_max_combo,
        "beatmap_status": recent_scores.beatmap.status,
        "beatmap_id": recent_scores.beatmap.id.toString(),
        "user_id": recent_scores.user_id.toString(),
        "multi_failed": false
    };

    // Play fallida en multi
    if(!score["passed"] && score["map_completion"] == 1) score.multi_failed = true;

    // Si es una play en un mapa unranked o es una play fallida, o si está forzado a guardar
    if (unranked_statuses.has(recent_scores.beatmap.status) || !score.passed || force_save) {
        const { getSupabaseClient } = require("../../db/database.js");
        const supabase = getSupabaseClient();

        if (!supabase) {
            console.warn("⚠️ Supabase no está conectado.");
            return;
        }

        try {
            // Si es una play fallida
            if (!score.passed) {
                // Buscar si ya existe una score fallida del mismo tipo (solo o multi)
                const { data: existingFails, error: selectError } = await supabase
                    .from('local_scores')
                    .select('*')
                    .eq('beatmap_id', score.beatmap_id)
                    .eq('user_id', score.user_id)
                    .eq('passed', false)
                    .eq('multi_failed', score.multi_failed);

                if (selectError) throw selectError;

                const existingScore = existingFails && existingFails[0];

                if (existingScore) {
                    // Reemplazar si es la misma play (mismo timestamp o misma puntuación) o si es mejor
                    const samePlay = existingScore.ended_at === score.ended_at || 
                                     Number(existingScore.legacy_total_score) === Number(score.legacy_total_score);
                    
                    const isBetter = score.multi_failed ? 
                        (score.pp > existingScore.pp) : 
                        (score.map_completion > existingScore.map_completion);

                    if (samePlay || isBetter) {
                        const { error: updateError } = await supabase
                            .from('local_scores')
                            .update(score)
                            .eq('id', existingScore.id);
                        
                        if (updateError) throw updateError;
                    }
                } else {
                    const { error: insertError } = await supabase
                        .from('local_scores')
                        .insert(score);
                    
                    if (insertError) throw insertError;
                }
            } else {
                // Obtener todas las puntuaciones pasadas existentes
                const { data: existingPassed, error: selectError } = await supabase
                    .from('local_scores')
                    .select('*')
                    .eq('beatmap_id', score.beatmap_id)
                    .eq('user_id', score.user_id)
                    .eq('passed', true);

                if (selectError) throw selectError;

                // Buscar si ya existe la misma play (por fecha o por PP idéntico)
                const samePlay = existingPassed.find(s => s.ended_at === score.ended_at || s.pp === score.pp);

                if (samePlay) {
                    // Reemplazar la existente para aplicar correcciones de mods o zona horaria
                    const { error: updateError } = await supabase
                        .from('local_scores')
                        .update(score)
                        .eq('id', samePlay.id);
                    
                    if (updateError) throw updateError;
                } else {
                    const { error: insertError } = await supabase
                        .from('local_scores')
                        .insert(score);
                    
                    if (insertError) throw insertError;
                }
            }
        } catch (err) {
            console.error('❌ Error al guardar score en Supabase:', err.message);
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
    if (parsed_args && parsed_args.username && parsed_args.username[0]) {
        clearUserScoresCache(parsed_args.username[0]);
    }
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

    try {
        let globalToken = null;
        try {
            const tokenData = JSON.parse(fs.readFileSync('./osu_token.json', 'utf8'));
            globalToken = tokenData.access_token;
        } catch (err) {
            console.error("Error al leer osu_token.json:", err);
        }

        if (!globalToken) {
            throw new Error("No global token available");
        }

        const urlObj = new URL(`https://osu.ppy.sh/api/v2/users/${parsed_args.username[0]}/scores/recent`);
        urlObj.searchParams.append('mode', parsed_args.gamemode || "osu");
        urlObj.searchParams.append('include_fails', '1');
        urlObj.searchParams.append('limit', '100');

        const apiRes = await fetch(urlObj.toString(), {
            headers: {
                'Authorization': `Bearer ${globalToken}`,
                'Content-Type': 'application/json',
                'x-api-version': '20240728'
            }
        });

        if (apiRes.ok) {
            const resJson = await apiRes.json();
            return resJson;
        } else {
            throw new Error(`Status ${apiRes.status}`);
        }
    } catch (e) {
        console.error("Error fetching recent scores via fetch:", e);
        return await v2.scores.list({
            type: 'user_recent',
            user_id: parsed_args.username[0],
            mode: parsed_args.gamemode || "osu",
            include_fails: true,
            limit: 100,
        });
    }
}

// Para obtener las mejores puntuaciones (top) de un usuario
async function getUserTopScores(parsed_args){
    const server = parsed_args.server || 'bancho';

    if (server === 'gatari') {
        try {
            const modeMap = { 'osu': 0, 'taiko': 1, 'fruits': 2, 'mania': 3 };
            const m = modeMap[parsed_args.gamemode || 'osu'];
            
            const reqUrl = `https://api.gatari.pw/user/scores/best?id=${parsed_args.username[0]}&mode=${m}&l=200`;
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

    try {
        let globalToken = null;
        try {
            const tokenData = JSON.parse(fs.readFileSync('./osu_token.json', 'utf8'));
            globalToken = tokenData.access_token;
        } catch (err) {
            console.error("Error al leer osu_token.json:", err);
        }

        if (!globalToken) {
            throw new Error("No global token available");
        }

        const fetchBest = async (offset) => {
            const urlObj = new URL(`https://osu.ppy.sh/api/v2/users/${parsed_args.username[0]}/scores/best`);
            urlObj.searchParams.append('mode', parsed_args.gamemode || "osu");
            urlObj.searchParams.append('limit', '100');
            urlObj.searchParams.append('offset', offset.toString());

            const apiRes = await fetch(urlObj.toString(), {
                headers: {
                    'Authorization': `Bearer ${globalToken}`,
                    'Content-Type': 'application/json',
                    'x-api-version': '20240728'
                }
            });

            if (apiRes.ok) {
                return await apiRes.json();
            } else {
                throw new Error(`Status ${apiRes.status}`);
            }
        };

        const result1 = await fetchBest(0);
        if (!result1 || result1.length < 100) {
            return result1 || [];
        }

        const result2 = await fetchBest(100);
        return result1.concat(result2 || []);
    } catch (e) {
        console.error("Error fetching top scores via fetch:", e);
        try {
            const result1 = await v2.scores.list({
                type: 'user_best',
                user_id: parsed_args.username[0],
                mode: parsed_args.gamemode || "osu",
                limit: 100,
                offset: 0
            });

            if (!result1 || result1.length < 100) {
                return result1 || [];
            }

            const result2 = await v2.scores.list({
                type: 'user_best',
                user_id: parsed_args.username[0],
                mode: parsed_args.gamemode || "osu",
                limit: 100,
                offset: 100
            });

            return result1.concat(result2 || []);
        } catch (err) {
            console.error("Error al obtener mejores jugadas de Bancho en fallback:", err);
            return [];
        }
    }
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
                    server: 'gatari',
                    is_supporter: u.donor === 1 || u.donor === true || false
                };
            }
            throw new Error("User not found in Gatari");
        } catch (e) {
            if (/^\d+$/.test(parsed_args.username[0])) {
                return `El usuario no se encuentra en Gatari!\n💡 **Consejo:** Si estás usando tu cuenta enlazada, recuerda que las IDs de Bancho y Gatari son diferentes. Prueba buscando con tu nombre de usuario: \`/osu usuario:TuNombre servidor:Gatari\``;
            }
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
            // Si es un mapa rankeado, lo devolvemos de inmediato sin consultar la base de datos
            if (!unranked_statuses.has(beatmap_metadata.status)) {
                return filePath;
            }
    		
            const beatmap_index = await localBeatmapStatus(beatmap_osu_id);
    
            // Si es un mapa rankeado entonces que lo devuelva, ya que ellos no sufren cambios
            if(!unranked_statuses.has(beatmap_metadata.status)){
    
                // Si no se encuentra en el index, pues que lo actualice
                if(!beatmap_index) await localBeatmapStatus(beatmap_osu_id, beatmap_metadata);
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
            await localBeatmapStatus(beatmap_osu_id, beatmap_metadata);
    
            return filePath;
        } catch (error) {
    
            console.error('Error al descargar el beatmap:', error.message);
            throw error;
        }
    }
}

// Obtener los detalles de una dificultad de un beatmap dado
async function getBeatmap(beatmap_id){
    const cached = beatmapCache.get(beatmap_id);
    const now = Date.now();
    if (cached && (now - cached.timestamp) < 3600000) { // 1 hora de caché para metadatos del mapa
        return cached.data;
    }

    await NewloadToken();

    const result = await v2.beatmaps.details({
        type: 'difficulty',
        id: beatmap_id
      });

    beatmapCache.set(beatmap_id, { data: result, timestamp: now });
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
    const userId = parsed_args.username[0];
    const beatmapId = parsed_args.beatmap_url;
    const mode = parsed_args.gamemode || 'osu';
    const cacheKey = `${userId}:${beatmapId}:${mode}`;

    const cached = userScoresCache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.timestamp) < 30000) { // 30 segundos de caché
        return cached.scores;
    }

    await NewloadToken();

    const result = await v2.scores.list({
        type: 'user_beatmap_all',

        user_id: userId,
        beatmap_id: beatmapId,
        mode: mode,
      });


    // buscamos tambien las locales, por si hay fallidas
    const local_scores = await getUnrankedBeatmapUserAllScores(parsed_args);  

    const allScores = result.concat(typeof local_scores === "string" ? [] : local_scores);
    userScoresCache.set(cacheKey, { scores: allScores, timestamp: now });

    return allScores;
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

const getGamemodeFromMessage = (msg) => {
    if (!msg) return null;
    
    // 1. Buscar en embeds
    const e = msg.embeds?.[0];
    if (e) {
        const authorText = (e.author?.name || '').toLowerCase();
        const titleText = (e.title || '').toLowerCase();
        const descText = (e.description || '').toLowerCase();
        const footerText = (e.footer?.text || '').toLowerCase();
        const combined = `${authorText} | ${titleText} | ${descText} | ${footerText}`;

        if (combined.includes('mania')) return 'mania';
        if (combined.includes('taiko')) return 'taiko';
        if (combined.includes('fruits') || combined.includes('ctb') || combined.includes('catch')) return 'fruits';
        if (combined.includes('std') || combined.includes('standard') || combined.includes('osu!')) {
            if (!combined.includes('mania') && !combined.includes('taiko') && !combined.includes('fruits')) {
                return 'osu';
            }
        }
    }

    // 2. Buscar en contenido de texto
    const content = (msg.content || '').toLowerCase();
    if (content.includes('osu!mania') || content.includes(' en mania')) return 'mania';
    if (content.includes('osu!taiko') || content.includes(' en taiko')) return 'taiko';
    if (content.includes('osu!ctb') || content.includes('osu!fruits') || content.includes(' en fruits') || content.includes('catch')) return 'fruits';
    if (content.includes('osu!std') || content.includes(' en standard') || content.includes(' en osu')) return 'osu';

    return null;
};

async function findBeatmapInChannel(message, isReply, targetIndex = 1){
    const extractAllIds = str => {
        if (!str) return [];
        const ids = [];
        const regex = /#(?:osu|taiko|fruits|mania)\/(\d+)|osu\.ppy\.sh\/b(?:eatmaps)?\/(\d+)/g;
        let match;
        while ((match = regex.exec(str)) !== null) {
            const id = match[1] || match[2];
            if (id) ids.push(id);
        }
        return ids;
    };

    const getBeatmapIdFromMessage = (msg, index = 1) => {
        if (!msg) return { beatmap_url: null, fromList: false };
        const e = msg.embeds?.[0];

        // 1. Check description
        if (e?.description) {
            const ids = extractAllIds(e.description);
            if (ids.length > 0) {
                const idx = (index >= 1 && index <= ids.length) ? index - 1 : 0;
                return { beatmap_url: ids[idx], fromList: ids.length > 1 };
            }
        }

        // 2. Check fields
        if (e?.fields) {
            let ids = [];
            for (const field of e.fields) {
                ids.push(...extractAllIds(field.value));
                ids.push(...extractAllIds(field.name));
            }
            if (ids.length > 0) {
                const idx = (index >= 1 && index <= ids.length) ? index - 1 : 0;
                return { beatmap_url: ids[idx], fromList: ids.length > 1 };
            }
        }

        // 3. Check other elements
        let otherIds = [];
        if (msg.content) otherIds.push(...extractAllIds(msg.content));
        if (e?.url) otherIds.push(...extractAllIds(e.url));
        if (e?.author?.url) otherIds.push(...extractAllIds(e.author.url));
        if (e?.title) otherIds.push(...extractAllIds(e.title));

        if (otherIds.length > 0) {
            const uniqueOther = [];
            for (const id of otherIds) {
                if (!uniqueOther.includes(id)) {
                    uniqueOther.push(id);
                }
            }
            const idx = (index >= 1 && index <= uniqueOther.length) ? index - 1 : 0;
            return { beatmap_url: uniqueOther[idx], fromList: uniqueOther.length > 1 };
        }

        return { beatmap_url: null, fromList: false };
    };

    try {
        if (isReply) {
            const { beatmap_url, fromList } = getBeatmapIdFromMessage(message, targetIndex);
            const gamemode = getGamemodeFromMessage(message);
            return beatmap_url
                ? { beatmap_url, gamemode, fromList, bad_response: 'shh' }
                : { beatmap_url: null, gamemode: null, fromList: false, bad_response: 'No se encontro un mapa al cual hacerle >c' };
        }

        const fetch_messages = await message.channel.messages.fetch({ limit: 30 });
        for (const msg of fetch_messages.values()) {
            const { beatmap_url, fromList } = getBeatmapIdFromMessage(msg, targetIndex);
            if (beatmap_url) {
                const gamemode = getGamemodeFromMessage(msg);
                return { beatmap_url, gamemode, fromList, bad_response: 'shh' };
            }
        }

        return { beatmap_url: null, gamemode: null, fromList: false, bad_response: 'No se encontro un mapa al cual hacerle >c' };
    } catch (error) {
        console.error("<#> findBeatmapInChannel error:", error);
        return { beatmap_url: null, gamemode: null, fromList: false, bad_response: 'No se encontro un mapa al cual hacerle >c' };
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
        const defaultMode = (command_parameters.ignore_main_gamemode && gamemode) ? gamemode : user_found.main_gamemode;
        parsed_args.gamemode = defaultMode;
        const fn_response = await command_function({'username' : [user_found.osu_id], 'beatmap_url' : beatmap_url, 'gamemode' : defaultMode});
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
            if(!user_found) return { 'fn_response': `No se encontro un usuario en \`osu\` linkeado al usuario \`${message.author.username}\` de discord.`, 'user_found': user_found, 'reparsed_args': parsed_args };
            parsed_args.username[0] = user_found.osu_id;
        }

        // Se hace la peticion con los args
        parsed_args['beatmap_url'] = beatmap_url;   // agregamos para el >c
        if (!parsed_args.gamemode) {
            if (command_parameters.ignore_main_gamemode && gamemode) {
                parsed_args.gamemode = gamemode;
            } else if (user_found && user_found.main_gamemode) {
                parsed_args.gamemode = user_found.main_gamemode;
            } else if (gamemode) {
                parsed_args.gamemode = gamemode;
            }
        } else if (!parsed_args.gamemode && gamemode) {
            parsed_args.gamemode = gamemode;
        }

        const fn_response = await command_function(parsed_args);

        return {'fn_response': fn_response, 'user_found': user_found, 'reparsed_args': parsed_args};
    }
}

function argsParserNoCommand(args) {
    let username = [];
    let gamemode = args.gamemode || "";
    let server = args.server || "bancho";
    let index = 1;
    let explicitIndex = false;
    let page = 1;
    let listMode = false;
    let modFilter = null;
    let modContainFilter = null;
    let searchFilter = null;
    let ppThreshold = null;
    let recentSort = false;
    let comboSort = false;
    let accSort = false;
    let bestSort = false;
    let detailed = false;
    let filterPass = false;
    let targetGuildId = null;
    let country = null;
    let beatmap_url = null;
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
    
    let grouped_args = [];
    let inside_quotes = false;
    let quote_char = "";
    let temp_quote_arg = "";

    for (let j = 0; j < args_list.length; j++) {
        let current = args_list[j];
        
        // Si empieza y termina con la misma comilla (ya sea " o ')
        if ((current.startsWith('"') && current.endsWith('"') && current.length > 1) ||
            (current.startsWith("'") && current.endsWith("'") && current.length > 1)) {
            grouped_args.push(current.slice(1, -1));
            continue;
        }

        if (!inside_quotes && (current.startsWith('"') || current.startsWith("'"))) {
            inside_quotes = true;
            quote_char = current[0];
            temp_quote_arg = current.slice(1);
            continue;
        }

        if (inside_quotes && current.endsWith(quote_char)) {
            inside_quotes = false;
            temp_quote_arg += " " + current.slice(0, -1);
            grouped_args.push(temp_quote_arg);
            temp_quote_arg = "";
            continue;
        }

        if (inside_quotes) {
            temp_quote_arg += " " + current;
        } else {
            grouped_args.push(current);
        }
    }
    if (inside_quotes && temp_quote_arg) {
        grouped_args.push(temp_quote_arg);
    }
    args_list = grouped_args;

    let skip_next = false;

    for (let i = 0; i < args_list.length; i++) {
        if (skip_next) {
            skip_next = false;
            continue;
        }
        let arg = args_list[i].trim();
        if (!arg) continue;

        // Si empieza con '+' (para mods exactos, ej: +HDHR)
        if (arg.startsWith("+")) {
            const possible_mods = arg.slice(1).toUpperCase().trim();
            if (possible_mods.length > 0) {
                modFilter = possible_mods;
                continue;
            }
        }

        // Si es el flag de -pais o -country
        if (arg === "-pais" || arg === "-country") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                if (next_arg !== "" && !next_arg.startsWith("-") && !next_arg.startsWith("+")) {
                    country = next_arg.toUpperCase();
                    skip_next = true;
                    continue;
                }
            }
            country = "SELF";
            continue;
        }
        if (arg.startsWith("-pais")) {
            let next = arg.slice(5).trim();
            country = next ? next.toUpperCase() : "SELF";
            continue;
        }
        if (arg.startsWith("-country")) {
            let next = arg.slice(8).trim();
            country = next ? next.toUpperCase() : "SELF";
            continue;
        }

        // Si es una URL o ID de beatmap (evitando IDs de discord que son >= 17 digitos)
        const extractId = str =>
            str?.match(/#(?:osu|taiko|fruits|mania)\/(\d+)/)?.[1] ||
            str?.match(/osu\.ppy\.sh\/b(?:eatmaps)?\/(\d+)/)?.[1] ||
            str?.match(/osu\.ppy\.sh\/beatmapsets\/\d+#(?:osu|taiko|fruits|mania)\/(\d+)/)?.[1] ||
            (str?.match(/^\d{5,10}$/) ? str : null);

        const possible_id = extractId(arg);
        if (possible_id) {
            beatmap_url = possible_id;
            continue;
        }

        // Si es un modo de juego o servidor, los capturamos antes de cualquier otra regla (como -m)
        if (arg.startsWith("-")) {
            const possible_val = arg.slice(1).toLowerCase();
            if (gamemode_set[possible_val]) {
                gamemode = gamemode_set[possible_val];
                continue;
            }
            if (server_set[possible_val]) {
                server = server_set[possible_val];
                continue;
            }
        }

        // Si es exactamente "-l"
        if (arg === "-l") {
            listMode = true;
            continue;
        }

        // Si es exactamente "-r"
        if (arg === "-r") {
            recentSort = true;
            continue;
        }

        // Si es exactamente "-c"
        if (arg === "-c") {
            comboSort = true;
            continue;
        }

        // Si es exactamente "-acc"
        if (arg === "-acc") {
            accSort = true;
            continue;
        }

        // Si es exactamente "-b"
        if (arg === "-b") {
            bestSort = true;
            continue;
        }

        // Si es exactamente "-d"
        if (arg === "-d") {
            detailed = true;
            continue;
        }

        // Si es exactamente "-ps"
        if (arg === "-ps") {
            filterPass = true;
            continue;
        }

        // Si es exactamente "-server"
        if (arg === "-server") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                targetGuildId = next_arg;
                skip_next = true;
                continue;
            }
        }
        if (arg.startsWith("-server")) {
            let next = arg.slice(7).trim();
            if (next.length > 0) {
                targetGuildId = next;
                continue;
            }
        }

        // Si es exactamente "-i"
        if (arg === "-i") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                let num = parseInt(next_arg);
                if (!isNaN(num)) {
                    index = num;
                    explicitIndex = true;
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
                explicitIndex = true;
                continue;
            }
        }

        // Si es exactamente "-p"
        if (arg === "-p") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                let num = parseInt(next_arg);
                if (!isNaN(num)) {
                    page = num;
                    skip_next = true;
                    continue;
                }
            }
        }
        // Si empieza con "-p" seguido de un numero (ej: "-p2")
        if (arg.startsWith("-p")) {
            let num = parseInt(arg.slice(2));
            if (!isNaN(num)) {
                page = num;
                continue;
            }
        }

        // Si es exactamente "-mx" (revisar antes de -m para evitar falsos positivos)
        if (arg === "-mx") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                modContainFilter = next_arg.toUpperCase();
                skip_next = true;
                continue;
            }
        }
        if (arg.startsWith("-mx")) {
            let next = arg.slice(3).trim();
            if (next.length > 0) {
                modContainFilter = next.toUpperCase();
                continue;
            }
        }

        // Si es exactamente "-m"
        if (arg === "-m") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                modFilter = next_arg.toUpperCase();
                skip_next = true;
                continue;
            }
        }
        if (arg.startsWith("-m")) {
            let next = arg.slice(2).trim();
            if (next.length > 0) {
                modFilter = next.toUpperCase();
                continue;
            }
        }

        // Si es exactamente "-?"
        if (arg === "-?") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                searchFilter = next_arg.toLowerCase();
                skip_next = true;
                continue;
            }
        }
        if (arg.startsWith("-?")) {
            let next = arg.slice(2).trim();
            if (next.length > 0) {
                searchFilter = next.toLowerCase();
                continue;
            }
        }

        // Si es exactamente "-g" o "-pp"
        if (arg === "-g" || arg === "-pp") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                let num = parseFloat(next_arg);
                if (!isNaN(num)) {
                    ppThreshold = num;
                    skip_next = true;
                    continue;
                }
            }
        }
        if (arg.startsWith("-g")) {
            let num = parseFloat(arg.slice(2).trim());
            if (!isNaN(num)) {
                ppThreshold = num;
                continue;
            }
        }
        if (arg.startsWith("-pp")) {
            let num = parseFloat(arg.slice(3).trim());
            if (!isNaN(num)) {
                ppThreshold = num;
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
        'explicitIndex': explicitIndex,
        'page': page,
        'listMode': listMode,
        'modFilter': modFilter,
        'modContainFilter': modContainFilter,
        'searchFilter': searchFilter,
        'ppThreshold': ppThreshold,
        'recentSort': recentSort,
        'comboSort': comboSort,
        'accSort': accSort,
        'bestSort': bestSort,
        'detailed': detailed,
        'filterPass': filterPass,
        'targetGuildId': targetGuildId,
        'country': country,
        'beatmap_url': beatmap_url
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

async function getNewBeatmapUserScores(beatmapId, usersArray, gamemode = 'osu', forceUpdate = false, logger = null, beatmapMetadata = null) {
    await NewloadToken();
    const scores = new Collection();

    const cacheDir = path.join(process.cwd(), 'db/local/gap_cache');
    const cacheFile = path.join(cacheDir, `${beatmapId}_${gamemode}.json`);

    let cachedData = { updated_at: 0, scores: {} };
    if (fs.existsSync(cacheFile) && !forceUpdate) {
        try {
            cachedData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        } catch (e) {
            console.error("Error al leer cache de gap:", e);
        }
    }

    const metadata = beatmapMetadata || await getBeatmap(beatmapId);
    const needsPP = metadata && (metadata.status === 'loved' || metadata.status === 'qualified');

    let mapInstance = null;
    let cacheModified = false;
    let processedCount = 0;
    let errorCount = 0;
    let rateLimitCount = 0;

    try {
        if (needsPP) {
            try {
                mapInstance = await getBeatmap_osu(metadata.beatmapset_id, metadata.id, metadata);
            } catch (e) {
                console.error("[GAP] Error al cargar el beatmap para el cálculo de PP:", e);
            }
        }

        const usersToFetch = [];
        const now = Date.now();
        const CACHE_TTL = 30 * 60 * 1000; // 30 minutos

        // Poblamos con los scores cacheados válidos
        for (const user of usersArray) {
            const cachedScore = cachedData.scores[user.osu_id];
            const isFresh = (now - (cachedData.updated_at || 0) < CACHE_TTL) && !forceUpdate;
            if (cachedScore && isFresh) {
                if (cachedScore.noScore !== true) {
                    // Si necesita PP y no lo tiene, lo calculamos
                    if (mapInstance && (cachedScore.pp === undefined || cachedScore.pp === null || cachedScore.pp === 0)) {
                        try {
                            const ppResult = calculatePP(cachedScore, mapInstance);
                            cachedScore.pp = ppResult.pp;
                            cachedData.scores[user.osu_id] = cachedScore;
                            cacheModified = true;
                        } catch (err) {
                            console.error(`[GAP] Error al calcular el PP para el usuario en caché ${user.osu_id}:`, err);
                        }
                    }
                    scores.set(user.osu_id.toString(), cachedScore);
                }
            } else {
                usersToFetch.push(user);
            }
        }

        if (logger) {
            const cachedCount = usersArray.length - usersToFetch.length;
            if (cachedCount > 0) {
                logger.process(`Caché: Usando puntuaciones de ${cachedCount} usuarios (recientes)`);
            }
            if (usersToFetch.length > 0) {
                logger.process(`Consultando osu! API para ${usersToFetch.length} usuarios (faltantes o expirados)`);
            }
        }

        if (usersToFetch.length > 0) {
            const chunkSize = 12;
            for (let i = 0; i < usersToFetch.length; i += chunkSize) {
                const chunk = usersToFetch.slice(i, i + chunkSize);
                
                await Promise.all(chunk.map(async (user) => {
                    try {
                        const result = await v2.scores.list({
                            type: 'user_beatmap_best',
                            beatmap_id: beatmapId,
                            user_id: user.osu_id,
                            mode: gamemode
                        });

                        processedCount++;
                        if (result && result.score) {
                            delete result.score.beatmap;
                            delete result.score.beatmapset;

                            // Calcular PP si hace falta
                            if (mapInstance && (result.score.pp === undefined || result.score.pp === null || result.score.pp === 0)) {
                                try {
                                    const ppResult = calculatePP(result.score, mapInstance);
                                    result.score.pp = ppResult.pp;
                                } catch (err) {
                                    console.error(`[GAP] Error al calcular el PP para el usuario ${user.osu_id}:`, err);
                                }
                            }

                            scores.set(user.osu_id.toString(), result.score);
                            cachedData.scores[user.osu_id] = result.score;
                            cacheModified = true;
                        } else {
                            cachedData.scores[user.osu_id] = { noScore: true };
                            cacheModified = true;
                        }
                    } catch (error) {
                        processedCount++;
                        errorCount++;
                        const status = error.status || error.response?.status;
                        const errorMsg = error.message || error;
                        const isNoScoreError = (typeof errorMsg === 'string' && (errorMsg.includes('empty error') || errorMsg.includes('404') || errorMsg.toLowerCase().includes('not found'))) || status === 404;

                        if (status === 429) {
                            rateLimitCount++;
                        } else if (isNoScoreError) {
                            cachedData.scores[user.osu_id] = { noScore: true };
                            cacheModified = true;
                        } else {
                            // En caso de fallos de red temporales, timeouts o errores de servidor (5xx)
                            // NO guardamos noScore para poder reintentar en futuras consultas
                            if (status !== 429) {
                                console.error(`[GAP] Error de conexión/servidor al obtener score de osu_id ${user.osu_id}:`, errorMsg);
                            }
                        }
                    }
                }));

                if (logger) {
                    let errorDetails = errorCount > 0 ? ` | Errores: ${errorCount}` : "";
                    if (rateLimitCount > 0) {
                        errorDetails += ` (429 RateLimit: ${rateLimitCount})`;
                    }
                    logger.process(`Progreso API: ${processedCount}/${usersToFetch.length} procesados${errorDetails}`);
                }

                if (i + chunkSize < usersToFetch.length) {
                    await new Promise(resolve => setTimeout(resolve, 150));
                }
            }

            if (errorCount > 0) {
                const noScoreCount = errorCount - rateLimitCount;
                const limitStr = rateLimitCount > 0 ? `, ${rateLimitCount} rate limit (429)` : "";
                console.log(`[GAP] Sincronización finalizada: ${usersToFetch.length} consultados. ${noScoreCount} no tienen score registrada${limitStr}.`);
            }
        }

        // Guardar la caché actualizada si hubo cambios
        if (cacheModified) {
            try {
                if (!fs.existsSync(cacheDir)) {
                    fs.mkdirSync(cacheDir, { recursive: true });
                }
                cachedData.updated_at = Date.now();
                fs.writeFileSync(cacheFile, JSON.stringify(cachedData, null, 2), 'utf8');
            } catch (e) {
                console.error("Error al guardar cache de gap:", e);
            }
        }

    } finally {
        if (mapInstance) {
            try {
                mapInstance.free();
            } catch (e) {
                console.error("[GAP] Error freeing mapInstance:", e);
            }
        }
    }

    const unrankedScores = await getUnrankedUserScores(beatmapId, gamemode);

    for (const [userId, score] of unrankedScores.entries()) {
        if (!scores.has(userId)) {
            scores.set(userId, score);
        }
    }

    if (logger) {
        let completionMsg = `Sincronización de scores completada. Total: ${scores.size} jugadas.`;
        if (errorCount > 0) {
            completionMsg += ` (Hubo ${errorCount} errores de conexión/rate limit)`;
        }
        logger.process(completionMsg);
    }

    return scores;
}

async function getUnrankedUserScores(beatmapId, gamemode = 'osu') {
    const userScores = new Collection();

    // 1. Intentar consultar Supabase si está disponible
    try {
        const { getSupabaseClient } = require("../../db/database.js");
        const supabase = getSupabaseClient();

        if (supabase) {
            const { data, error } = await supabase
                .from('local_scores')
                .select('*')
                .eq('beatmap_id', beatmapId.toString());

            if (error) {
                console.error('❌ Error obteniendo scores locales de Supabase:', error.message);
            } else if (data && data.length > 0) {
                // Agrupar todas las jugadas por user_id
                const tempUserScores = {};
                for (const row of data) {
                    const uId = row.user_id.toString();
                    if (!tempUserScores[uId]) tempUserScores[uId] = [];
                    tempUserScores[uId].push(row);
                }

                // Elegir la mejor play de cada usuario
                for (const uId in tempUserScores) {
                    const scoresList = tempUserScores[uId];
                    const best = scoresList.reduce((a, b) => (Number(a.total_score) > Number(b.total_score) ? a : b));
                    userScores.set(uId, best);
                }
            }
        }
    } catch (error) {
        console.error('Error obteniendo scores locales de Supabase en getUnrankedUserScores:', error);
    }

    // 2. Mezclar/complementar con las scores locales físicas si existen
    const scoresPath = path.join(process.cwd(), 'db/local/scores', `${beatmapId}`);
    if (fs.existsSync(scoresPath)) {
        try {
            const userFolders = fs.readdirSync(scoresPath).filter(f => fs.statSync(path.join(scoresPath, f)).isDirectory());

            for (const userId of userFolders) {
                const folderPath = path.join(scoresPath, userId);
                const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.json'));
                const localList = [];

                for (const file of files) {
                    const filePath = path.join(folderPath, file);
                    try {
                        const data = JSON.parse(fs.readFileSync(filePath));
                        localList.push(data);
                    } catch (e) {
                        console.error(`Error leyendo ${filePath}:`, e);
                    }
                }

                if (localList.length > 0) {
                    const bestLocal = localList.reduce((a, b) => (Number(a.total_score) > Number(b.total_score) ? a : b));
                    const uId = userId.toString();
                    // Si ya existe de Supabase, quedarnos con la de mayor total_score
                    if (userScores.has(uId)) {
                        const existing = userScores.get(uId);
                        if (Number(bestLocal.total_score) > Number(existing.total_score)) {
                            userScores.set(uId, bestLocal);
                        }
                    } else {
                        userScores.set(uId, bestLocal);
                    }
                }
            }
        } catch (e) {
            console.error("Error al leer scores locales físicas:", e);
        }
    }

    return userScores;
}

module.exports = { 
    getUnrankedUserScores, 
    NewloadToken, 
    getNewBeatmapUserScores,
    getUnrankedBeatmapUserAllScores,
    getBeatmap_osu,
    saveUserscore,
    getUserRecentScores,
    getUserTopScores,
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