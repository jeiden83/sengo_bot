const { Client, Auth } = require('osu-web.js');
const { auth, v2 } = require('osu-api-extended');
const { getOsuUser, loadToken, NewloadToken } = require("../../models/OsuUserModel.js");
const { getBeatmap_osu, getBeatmap, lookupBeatmapByMD5 } = require("../../models/BeatmapModel.js");
const { 
    normalizeScore,
    normalizeStatistics,
    calculatePP,
    getUnrankedBeatmapUserAllScores,
    getUserRecentScores,
    getUserTopScores,
    getScoreDetails,
    getBeatmapUserScore,
    getBeatmapUserAllScores,
    getRecentScores,
    saveUserscore
} = require("../../models/OsuScoreModel.js");
const { Collection } = require('discord.js');

const { localBeatmapStatus } = require("./admin.js");

const CONFIG = require("../../config.js");

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');
const rosu = require("rosu-pp-js");

const activeGapPromises = new Map();

const gapDiskCacheInMemory = new Map();
const GAP_DISK_CACHE_TTL = 300000; // 5 minutos de vigencia en RAM antes de leer de disco

const PROFILE_CACHE_TTL = 300000; // 5 minutos

function setWithLimit(map, key, value, limit = 100) {
    if (map.size >= limit && !map.has(key)) {
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
    }
    map.set(key, value);
}

class OsuApiQueue {
    constructor() {
        this.queue = [];
        this.running = false;
        this.lastRequestTime = 0;
        this.delayBetweenRequests = 100; // 100ms mínimo base para evitar ráfagas excesivas
        this.cooldownUntil = 0;
    }

    async add(requestFn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ requestFn, resolve, reject, attempts: 0 });
            this.process();
        });
    }

    async process() {
        if (this.running) return;
        this.running = true;

        while (this.queue.length > 0) {
            const now = Date.now();
            if (now < this.cooldownUntil) {
                const sleepTime = this.cooldownUntil - now;
                await new Promise(resolve => setTimeout(resolve, sleepTime));
                continue;
            }

            const timeSinceLast = Date.now() - this.lastRequestTime;
            if (timeSinceLast < this.delayBetweenRequests) {
                await new Promise(resolve => setTimeout(resolve, this.delayBetweenRequests - timeSinceLast));
            }

            const item = this.queue.shift();
            if (!item) continue;

            this.lastRequestTime = Date.now();

            try {
                const result = await item.requestFn();
                item.resolve(result);
            } catch (error) {
                const status = error.response?.status || error.status;
                if (status === 429) {
                    item.attempts++;
                    if (item.attempts < 3) {
                        // Si no ha superado los intentos de reintento en la cola, lo ponemos de vuelta
                        this.queue.unshift(item);
                    } else {
                        item.reject(error);
                    }
                    // Activar el pare general: pausar 3 segundos
                    this.cooldownUntil = Date.now() + 3000;
                    this.delayBetweenRequests = Math.min(this.delayBetweenRequests + 50, 500);
                } else {
                    item.reject(error);
                }
            }
        }

        this.running = false;
    }
}

const osuApiQueue = new OsuApiQueue();

// Lógicas de normalización y base de datos locales delegadas a OsuScoreModel

// Lógica de tokens delegada a OsuUserModel

// Lógica de saveUserscore delegada a OsuScoreModel

// convertGatariMods delegada a OsuScoreModel

// Lógicas de scores delegadas a OsuScoreModel

// Lógica de getOsuUser delegada a OsuUserModel

// Lógicas de beatmaps delegadas a BeatmapModel

// Obtener los detalles de una score dada su ID online
// Lógicas de scores adicionales delegadas a OsuScoreModel

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
    let friendsFilter = null;
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

        // Si es el flag de -friends o -amigo o -amigos
        if (arg === "-friends" || arg === "-amigo" || arg === "-amigos") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                if (next_arg !== "" && !next_arg.startsWith("-") && !next_arg.startsWith("+")) {
                    friendsFilter = next_arg;
                    skip_next = true;
                    continue;
                }
            }
            friendsFilter = "SELF";
            continue;
        }
        if (arg.startsWith("-friends")) {
            let next = arg.slice(8).trim();
            friendsFilter = next ? next : "SELF";
            continue;
        }
        if (arg.startsWith("-amigos")) {
            let next = arg.slice(7).trim();
            friendsFilter = next ? next : "SELF";
            continue;
        }
        if (arg.startsWith("-amigo")) {
            let next = arg.slice(6).trim();
            friendsFilter = next ? next : "SELF";
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
        'friendsFilter': friendsFilter,
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
    const key = `${beatmapId}_${gamemode}`;
    if (!forceUpdate && activeGapPromises.has(key)) {
        if (logger) logger.process(`Deduplicador: Ya existe una consulta de gap en curso para el mapa ${beatmapId}. Esperando resolución...`);
        try {
            await activeGapPromises.get(key);
        } catch (e) {
            console.error(`[GAP-DEDUPLICATOR] La consulta en progreso para ${beatmapId} falló:`, e);
        }
        if (logger) logger.process(`Deduplicador: Consulta en curso finalizada. Cargando datos desde caché.`);
        return getNewBeatmapUserScores(beatmapId, usersArray, gamemode, false, logger, beatmapMetadata);
    }

    let resolveActivePromise;
    if (!forceUpdate) {
        const p = new Promise(resolve => { resolveActivePromise = resolve; });
        activeGapPromises.set(key, p);
    }

    try {
        const result = await _getNewBeatmapUserScores(beatmapId, usersArray, gamemode, forceUpdate, logger, beatmapMetadata);
        return result;
    } finally {
        if (resolveActivePromise) resolveActivePromise();
        if (!forceUpdate) activeGapPromises.delete(key);
    }
}

async function _getNewBeatmapUserScores(beatmapId, usersArray, gamemode = 'osu', forceUpdate = false, logger = null, beatmapMetadata = null) {
    await NewloadToken();
    const scores = new Collection();

    const cacheDir = path.join(process.cwd(), 'db/local/gap_cache');
    const cacheFile = path.join(cacheDir, `${beatmapId}_${gamemode}.json`);

    const key = `${beatmapId}_${gamemode}`;
    const nowTime = Date.now();
    let cachedData = { updated_at: 0, scores: {} };

    const inMemoryEntry = gapDiskCacheInMemory.get(key);
    if (inMemoryEntry && (nowTime - inMemoryEntry.timestamp) < GAP_DISK_CACHE_TTL && !forceUpdate) {
        cachedData = inMemoryEntry.data;
    } else if (fs.existsSync(cacheFile) && !forceUpdate) {
        try {
            cachedData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            setWithLimit(gapDiskCacheInMemory, key, { data: cachedData, timestamp: nowTime });
        } catch (e) {
            console.error("Error al leer cache de gap:", e);
        }
    }

    const metadata = beatmapMetadata || await getBeatmap(beatmapId);
    const needsPP = metadata && (metadata.status === 'loved' || metadata.status === 'qualified');

    const { getSupabaseClient } = require("../../db/database.js");
    const supabase = getSupabaseClient();

    // Mezclar con los scores de Supabase
    if (supabase && !forceUpdate) {
        try {
            const { data: dbScores, error: dbError } = await supabase
                .from('local_scores')
                .select('*')
                .eq('beatmap_id', beatmapId.toString());
            
            if (!dbError && dbScores) {
                // Agrupar por usuario y elegir la mejor play pasada (o la más reciente si no hay pasadas)
                const dbByUser = {};
                for (const row of dbScores) {
                    const uId = row.user_id.toString();
                    if (!dbByUser[uId]) dbByUser[uId] = [];
                    dbByUser[uId].push(row);
                }

                for (const uId in dbByUser) {
                    const rows = dbByUser[uId];
                    // Priorizar plays pasadas sobre fallidas
                    const passedRows = rows.filter(r => r.passed !== false);
                    const bestRow = passedRows.length > 0
                        ? passedRows.reduce((a, b) => (Number(a.pp || 0) > Number(b.pp || 0) ? a : b))
                        : rows.reduce((a, b) => (new Date(a.ended_at).getTime() > new Date(b.ended_at).getTime() ? a : b));

                    const row = bestRow;
                    // Saltar scores claramente inválidas (legacy y total son 0, no tiene datos útiles de score)
                    const hasValidScore = Number(row.legacy_total_score || 0) > 0 || Number(row.total_score || 0) > 0;
                    if (!hasValidScore && row.passed !== false) {
                        // Score inválida (Lazer guardada sin classic_total_score), no usarla como caché
                        continue;
                    }
                    const rowEndedAtTime = new Date(row.ended_at).getTime();
                    const existing = cachedData.scores[uId];
                    const cachedEndedAtTime = existing ? new Date(existing.ended_at || 0).getTime() : 0;
                    // Solo reemplazar si no hay cached, o si el cached es noScore, o si la DB tiene una play mejor/más reciente
                    const shouldReplace = !existing || existing.noScore === true || rowEndedAtTime > cachedEndedAtTime;
                    
                    if (shouldReplace) {
                        const mappedScore = {
                            id: Number(row.id),
                            accuracy: row.accuracy,
                            ended_at: row.ended_at,
                            started_at: row.started_at,
                            legacy_total_score: Number(row.legacy_total_score),
                            total_score: Number(row.total_score),
                            max_combo: row.max_combo,
                            statistics: row.statistics || {},
                            mods: row.mods || [],
                            passed: row.passed,
                            pp: row.pp,
                            rank: row.rank,
                            map_completion: row.map_completion,
                            beatmap: {
                                id: Number(row.beatmap_id),
                                status: row.beatmap_status
                            },
                            user: {
                                id: Number(row.user_id),
                                username: row.username,
                                country_code: row.country_code
                            },
                            user_id: Number(row.user_id),
                            // Si le falta country_code, marcar como expirado para que la API lo refresque
                            fetched_at: row.country_code ? new Date(row.created_at).getTime() : 0
                        };
                        normalizeScore(mappedScore);
                        cachedData.scores[uId] = mappedScore;
                    }
                }
            }
        } catch (err) {
            console.error("[GAP] Error al mezclar cache de Supabase en getNewBeatmapUserScores:", err);
        }
    }

    let tokenPool = [];
    let tokenIndex = 0;

    if (supabase) {
        try {
            const { data: dbTokens, error: dbError } = await supabase
                .from('oauth_tokens')
                .select('discord_id, username, access_token, refresh_token, expires_at');
            
            if (!dbError && dbTokens) {
                const { getValidTokenForUser } = require("../../utils/osuAuth.js");
                const refreshed = await Promise.all(dbTokens.map(async (row) => {
                    try {
                        const token = await getValidTokenForUser(row.discord_id);
                        if (token) {
                            return {
                                token,
                                username: row.username || row.discord_id
                            };
                        }
                    } catch (err) {
                        console.error(`[GAP] Error al refrescar token para el usuario ${row.discord_id} en la pool:`, err);
                    }
                    return null;
                }));
                tokenPool = refreshed.filter(t => t !== null);
            }
        } catch (e) {
            console.error("[GAP] Error al cargar la pool de tokens OAuth:", e);
        }
    }

    if (tokenPool.length > 0 && logger) {
        logger.process(`Pool de tokens OAuth cargada con ${tokenPool.length} tokens activos.`);
    }

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
        const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

        // Poblamos con los scores cacheados válidos
        for (const user of usersArray) {
            const cachedScore = cachedData.scores[user.osu_id];
            let isFresh = false;
            if (cachedScore) {
                const fetchedAt = cachedScore.fetched_at || cachedData.updated_at || 0;
                isFresh = (now - fetchedAt < CACHE_TTL) && !forceUpdate;
            }
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
            const concurrencyLimit = Math.max(25, tokenPool.length);
            const chunkTokensUsed = [];
            let nextIndex = 0;
            let lastLogTime = 0;
            let lastRequestTime = 0;
            const delayBetweenRequests = 90; // Espaciado mínimo de 90ms entre inicios de peticiones para evitar 429 por IP (burst limit)

            const executeWorker = async () => {
                while (nextIndex < usersToFetch.length) {
                    const user = usersToFetch[nextIndex++];
                    if (!user) break;

                    // Espaciar el inicio de las peticiones para evitar activar el limitador por IP de Cloudflare/osu!
                    const nowLaunch = Date.now();
                    const timeToWait = Math.max(0, lastRequestTime + delayBetweenRequests - nowLaunch);
                    lastRequestTime = nowLaunch + timeToWait;
                    if (timeToWait > 0) {
                        await new Promise(resolve => setTimeout(resolve, timeToWait));
                    }

                    try {
                        let result = null;
                        let success = false;
                        let useBotToken = false;
                        let tokenName = 'Bot';

                        if (tokenPool.length > 0) {
                            const tokenObj = tokenPool[tokenIndex % tokenPool.length];
                            tokenIndex++;
                            const token = tokenObj.token;
                            tokenName = tokenObj.username;
                            chunkTokensUsed.push(tokenName);

                            let poolAttempts = 0;
                            try {
                                const url = `https://osu.ppy.sh/api/v2/beatmaps/${beatmapId}/scores/users/${user.osu_id}?mode=${gamemode}`;
                                const response = await osuApiQueue.add(() => axios.get(url, {
                                    headers: {
                                        'Authorization': `Bearer ${token}`,
                                        'Content-Type': 'application/json',
                                        'Accept': 'application/json',
                                        'x-api-version': '20240728'
                                    }
                                }));
                                result = response.data;
                                success = true;
                            } catch (error) {
                                const status = error.response?.status;
                                if (status === 404) {
                                    result = null;
                                    success = true;
                                } else {
                                    const errorMsg = error.response?.data ? ` | Detalles: ${JSON.stringify(error.response.data)}` : '';
                                    console.warn(`[GAP] Petición fallida para user_id ${user.osu_id} con token de la pool (${tokenName}) (estado ${status})${errorMsg}. Reintentando con token del bot...`);
                                    useBotToken = true;
                                }
                            }
                        } else {
                            useBotToken = true;
                        }

                        if (useBotToken && !success) {
                            try {
                                result = await osuApiQueue.add(() => v2.scores.list({
                                    type: 'user_beatmap_best',
                                    beatmap_id: beatmapId,
                                    user_id: user.osu_id,
                                    mode: gamemode
                                }));
                                success = true;
                            } catch (error) {
                                throw error;
                            }
                        }

                        if (success) {
                            processedCount++;
                            if (result && result.score) {
                                normalizeScore(result.score);
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

                                result.score.fetched_at = Date.now();
                                scores.set(user.osu_id.toString(), result.score);
                                cachedData.scores[user.osu_id] = result.score;
                                cacheModified = true;

                                // Guardamos asíncronamente en Supabase
                                const scoreObj = result.score;
                                const beatmap_max_combo = mapInstance ? (mapInstance.maxCombo || 0) : 0;
                                const { great = 0, ok = 0, meh = 0, miss = 0 } = scoreObj.statistics || {};
                                const total_hits = great + ok + meh + miss;
                                const map_completion = scoreObj.passed ? 100 : (mapInstance && mapInstance.nObjects > 0 ? total_hits / mapInstance.nObjects : 0);

                                const pre_calculated = {
                                    pp: scoreObj.pp,
                                    beatmap_max_combo: beatmap_max_combo,
                                    map_completion: map_completion
                                };

                                const scoreToSave = {
                                    ...scoreObj,
                                    beatmap: {
                                        id: beatmapId,
                                        status: metadata?.status || 'ranked'
                                    },
                                    user: {
                                        username: scoreObj.user?.username || user.username || `User ${user.osu_id}`,
                                        country_code: scoreObj.user?.country_code || null
                                    },
                                    user_id: user.osu_id
                                };

                                saveUserscore(scoreToSave, pre_calculated, true).catch(err => {
                                    console.error(`[GAP] Error al guardar score de user ${user.osu_id} en Supabase:`, err);
                                });
                            } else {
                                cachedData.scores[user.osu_id] = { noScore: true, fetched_at: Date.now() };
                                cacheModified = true;
                            }
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
                            cachedData.scores[user.osu_id] = { noScore: true, fetched_at: Date.now() };
                            cacheModified = true;
                        } else {
                            // En caso de fallos de red temporales, timeouts o errores de servidor (5xx)
                            // NO guardamos noScore para poder reintentar en futuras consultas
                            if (status !== 429) {
                                console.error(`[GAP] Error de conexión/servidor al obtener score de osu_id ${user.osu_id}:`, errorMsg);
                            }
                        }
                    }

                    const now = Date.now();
                    if (logger && (processedCount % 10 === 0 || processedCount === usersToFetch.length || now - lastLogTime > 1500)) {
                        lastLogTime = now;
                        let errorDetails = errorCount > 0 ? ` | Errores: ${errorCount}` : "";
                        if (rateLimitCount > 0) {
                            errorDetails += ` (429 RateLimit: ${rateLimitCount})`;
                        }
                        logger.process(`Progreso API: ${processedCount}/${usersToFetch.length} procesados${errorDetails}`);
                    }
                }
            };

            const workers = [];
            const activeWorkers = Math.min(concurrencyLimit, usersToFetch.length);
            for (let w = 0; w < activeWorkers; w++) {
                workers.push(executeWorker());
            }
            await Promise.all(workers);
        }

        if (errorCount > 0) {
            const noScoreCount = errorCount - rateLimitCount;
            const limitStr = rateLimitCount > 0 ? `, ${rateLimitCount} rate limit (429)` : "";
            console.log(`[GAP] Sincronización finalizada: ${usersToFetch.length} consultados. ${noScoreCount} no tienen score registrada${limitStr}.`);
        }

        // Guardar la caché actualizada si hubo cambios
        if (cacheModified) {
            try {
                if (!fs.existsSync(cacheDir)) {
                    fs.mkdirSync(cacheDir, { recursive: true });
                }
                cachedData.updated_at = Date.now();
                fs.writeFileSync(cacheFile, JSON.stringify(cachedData, null, 2), 'utf8');
                setWithLimit(gapDiskCacheInMemory, key, { data: cachedData, timestamp: Date.now() });
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
                    tempUserScores[uId].push(normalizeScore(row));
                }

                // Elegir la mejor play de cada usuario
                for (const uId in tempUserScores) {
                    const scoresList = tempUserScores[uId];
                    const best = scoresList.reduce((a, b) => (Number(a.total_score || a.legacy_total_score || 0) > Number(b.total_score || b.legacy_total_score || 0) ? a : b));
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
                    const bestLocal = localList.reduce((a, b) => (Number(a.total_score || a.legacy_total_score || a.score || 0) > Number(b.total_score || b.legacy_total_score || b.score || 0) ? a : b));
                    const uId = userId.toString();
                    const normalizedLocal = normalizeScore(bestLocal);
                    
                    // Si ya existe de Supabase, quedarnos con la de mayor total_score
                    if (userScores.has(uId)) {
                        const existing = userScores.get(uId);
                        if (Number(normalizedLocal.total_score) > Number(existing.total_score)) {
                            userScores.set(uId, normalizedLocal);
                        }
                    } else {
                        userScores.set(uId, normalizedLocal);
                    }
                }
            }
        } catch (e) {
            console.error("Error al leer scores locales físicas:", e);
        }
    }

    return userScores;
}

async function triggerBackgroundGapCache(message, beatmapId, gamemode = 'osu') {
    try {
        const { getSupabaseClient } = require("../../db/database.js");
        const supabase = getSupabaseClient();
        if (!supabase) return;

        const guildId = message.guild ? message.guild.id : null;
        if (!guildId) return;

        let { data: linkedUsers, error } = await supabase
            .from('users')
            .select('discord_id, osu_id, main_gamemode')
            .not('osu_id', 'is', null)
            .contains('guilds', [guildId]);

        if (error) {
            console.error(`[BG-GAP] Error al consultar usuarios vinculados:`, error);
            return;
        }

        if (!linkedUsers || linkedUsers.length === 0) return;

        const targetMode = gamemode || 'osu';
        const filteredUsers = linkedUsers.filter(user => {
            if (targetMode !== 'osu' && linkedUsers.length <= 30) {
                return true;
            }
            const userMode = user.main_gamemode || 'osu';
            return userMode === targetMode;
        });

        const usersArray = filteredUsers.map(user => ({
            id: user.discord_id,
            osu_id: user.osu_id,
            main_gamemode: user.main_gamemode
        }));

        if (usersArray.length === 0) return;

        getNewBeatmapUserScores(beatmapId, usersArray, gamemode, false, null)
            .then(() => {
                console.log(`[BG-GAP] Caché de gap completado para el mapa ${beatmapId} (${usersArray.length} usuarios).`);
            })
            .catch(err => {
                console.error(`[BG-GAP] Error en la ejecución de cache de gap:`, err);
            });

    } catch (err) {
        console.error(`[BG-GAP] Error al inicializar el proceso en segundo plano:`, err);
    }
}

const userPreloadRegistry = new Map();
const PRELOAD_REGISTRY_TTL = 10 * 60 * 1000; // 10 minutos de expiración de sesión

async function handlePredictivePreload(discordId, beatmapId, gamemode = 'osu', message = null) {
    if (!discordId) return;

    let cleanBeatmapId = beatmapId;
    if (beatmapId && typeof beatmapId === 'string' && (beatmapId.includes('osu.ppy.sh') || beatmapId.includes('#'))) {
        const match = /#(?:osu|taiko|fruits|mania)\/(\d+)|osu\.ppy\.sh\/b(?:eatmaps)?\/(\d+)/i.exec(beatmapId);
        if (match) {
            cleanBeatmapId = match[1] || match[2];
        }
    }

    const now = Date.now();
    let userState = userPreloadRegistry.get(discordId);

    // Si no existe, expiró o cambió de mapa, inicializamos el estado
    if (!userState || (now - userState.timestamp) > PRELOAD_REGISTRY_TTL || (cleanBeatmapId && userState.beatmapId !== cleanBeatmapId)) {
        userState = {
            beatmapId: cleanBeatmapId || null,
            stages: new Set(),
            timestamp: now
        };
        setWithLimit(userPreloadRegistry, discordId, userState, 150);
    } else {
        userState.timestamp = now; // Refrescar vigencia
        if (cleanBeatmapId && !userState.beatmapId) {
            userState.beatmapId = cleanBeatmapId;
        }
    }

    // FASE 1: Precarga de Beatmap (.osu) y Caché de Gap
    if (userState.beatmapId && !userState.stages.has('beatmap_and_gap')) {
        userState.stages.add('beatmap_and_gap');
        triggerBackgroundOsuPreload(null, userState.beatmapId, gamemode, message);
    }

    // FASE 2: Precarga de Perfil de Usuario y Top Scores
    if (!userState.stages.has('profile_and_top')) {
        userState.stages.add('profile_and_top');
        triggerBackgroundOsuPreload(discordId, null, gamemode, message);
    }
}

async function triggerBackgroundOsuPreload(discordId, beatmapId, gamemode = 'osu', message = null) {
    try {
        Promise.resolve().then(async () => {
            // 1. Precarga del Beatmap y del archivo .osu
            if (beatmapId) {
                try {
                    const mapMeta = await getBeatmap(beatmapId);
                    if (mapMeta && mapMeta.beatmapset_id) {
                        await getBeatmap_osu(mapMeta.beatmapset_id, beatmapId, mapMeta);
                        console.log(`[BG-PRELOAD] Mapa precargado: ${beatmapId}`);

                        // Si hay un mensaje provisto y pertenece a una guild, gatillar precarga del gap y compare
                        if (message && message.guild) {
                            triggerBackgroundGapCache(message, beatmapId, gamemode).catch(err => {
                                console.error(`[BG-PRELOAD] Error al precargar gap para el mapa ${beatmapId}:`, err);
                            });
                        }
                    }
                } catch (err) {
                    console.error(`[BG-PRELOAD] Error al precargar beatmap ${beatmapId}:`, err);
                }
            }

            // 2. Precarga del Perfil de Usuario y mejores puntuaciones (Top 100)
            if (discordId) {
                try {
                    const { getSupabaseClient } = require("../../db/database.js");
                    const supabase = getSupabaseClient();
                    if (supabase) {
                        const { data: userRecord, error } = await supabase
                            .from('users')
                            .select('osu_id, username, main_gamemode')
                            .eq('discord_id', discordId)
                            .maybeSingle();

                        if (!error && userRecord && userRecord.username) {
                            const osuUsername = userRecord.username;
                            const targetMode = gamemode || userRecord.main_gamemode || 'osu';
                            const targetServer = 'bancho';

                            const dummyArgs = {
                                username: [osuUsername],
                                gamemode: targetMode,
                                server: targetServer
                            };

                            await Promise.all([
                                getOsuUser(dummyArgs).catch(e => console.error(`[BG-PRELOAD] Error al precargar perfil de ${osuUsername}:`, e)),
                                getUserTopScores(dummyArgs).catch(e => console.error(`[BG-PRELOAD] Error al precargar top scores de ${osuUsername}:`, e))
                            ]);
                            console.log(`[BG-PRELOAD] Perfil/top precargado: ${osuUsername}`);
                        }
                    }
                } catch (err) {
                    console.error(`[BG-PRELOAD] Error al precargar perfil del usuario discord ${discordId}:`, err);
                }
            }
        });
    } catch (err) {
        console.error(`[BG-PRELOAD] Error general en triggerBackgroundOsuPreload:`, err);
    }
}

module.exports = { 
    handlePredictivePreload,
    triggerBackgroundOsuPreload, 
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
    calculatePP,
    triggerBackgroundGapCache,
    normalizeScore,
    normalizeStatistics
}