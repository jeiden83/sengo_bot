const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');

// Caché local en memoria y en archivo para persistencia
let reworkUserCache = new Map();
const CACHE_FILE = path.resolve('rework_user_cache.json');
const reworksListCache = { data: null, timestamp: 0 };
const beatmapScoresCache = new Map();

let reworkQueue = new Map();
const QUEUE_FILE = path.resolve('rework_queue.json');
let clientInstance = null;
let checkerInterval = null;

// Inicializar el cliente Discord
function initClient(client) {
    clientInstance = client;
}

// Cargar caché desde archivo si existe
async function initCache() {
    try {
        const data = await fs.readFile(CACHE_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        reworkUserCache = new Map(Object.entries(parsed));
    } catch (err) {
        // Si no existe o tiene formato inválido, inicializamos vacío
        reworkUserCache = new Map();
    }
    await initQueue();
}

// Cargar cola desde archivo si existe
async function initQueue() {
    try {
        const data = await fs.readFile(QUEUE_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        reworkQueue = new Map(Object.entries(parsed));
    } catch (err) {
        reworkQueue = new Map();
    }
    startQueueChecker();
}

// Iniciar verificador de cola en segundo plano
function startQueueChecker() {
    if (checkerInterval) return;
    checkerInterval = setInterval(async () => {
        if (reworkQueue.size === 0 || !clientInstance) return;

        for (const [key, item] of reworkQueue.entries()) {
            try {
                const url = `https://api.pp.huismetbenen.nl/player/userdata/${item.osuId}/${item.reworkId}`;
                let res;
                try {
                    res = await axios.get(url, { timeout: 8000 });
                } catch (err) {
                    // Si la API del rework da 404/error, significa que aún está recalculando o falló
                    continue;
                }

                if (res.data && res.data.user_id) {
                    console.log(`[Rework Queue] Recalculo finalizado para ${item.username} (${item.osuId}) en rework ${item.reworkId}`);

                    const cacheKey = `${item.osuId}:${item.reworkId}`;
                    reworkUserCache.set(cacheKey, res.data);
                    await saveCache();

                    reworkQueue.delete(key);
                    await saveQueue();

                    await sendQueueCompletionNotification(item, res.data);
                }
            } catch (err) {
                console.error(`[Rework Queue] Error al procesar cola para el usuario ${item.username}:`, err);
            }
        }
    }, 30000); // Cada 30 segundos
}

// Notificar por Discord cuando se complete
async function sendQueueCompletionNotification(item, reworkUser) {
    if (!clientInstance || !item.channelId) return;

    try {
        const channel = await clientInstance.channels.fetch(item.channelId).catch(() => null);
        if (!channel) return;

        const OsuUserModel = require("./OsuUserModel.js");
        const player = await OsuUserModel.getOsuUser({ username: [item.osuId], server: 'bancho' }).catch(() => null);
        if (!player || typeof player === 'string') return;

        const reworks = await getReworksList();
        const rework = reworks.find(r => r.id === Number(item.reworkId));
        if (!rework) return;

        const { doOsuReworkUserEmbed, doOsuReworkTopEmbed } = require("../views/osuEmbeds.js");

        const mockMessage = {
            author: { id: item.authorId || "", username: "" },
            member: { roles: { highest: { color: 0xff66aa } } },
            guild: channel.guild || null
        };

        let embed;
        let contentText = `🎉 **${item.username}** ha terminado de ser recalculado para **${rework.name}**!`;

        if (item.isTop) {
            const scores = await getUserReworkScores(item.osuId, item.reworkId, item.gamemode || "osu").catch(() => []);
            const sortedScores = scores
                .filter(s => s.values && typeof s.values.local_pp === 'number')
                .sort((a, b) => b.values.local_pp - a.values.local_pp);

            embed = await doOsuReworkTopEmbed(mockMessage, player, sortedScores, rework);
        } else {
            const scores = await getUserReworkScores(item.osuId, item.reworkId, item.gamemode || "osu").catch(() => []);
            embed = await doOsuReworkUserEmbed(mockMessage, player, reworkUser, rework, scores);
        }

        if (embed && embed.setFooter) {
            embed.setFooter({
                text: `Notificación de Cola de Recalculo Sengo`,
                iconURL: clientInstance.user.displayAvatarURL()
            });
        }

        const sendOptions = {
            content: contentText,
            embeds: [embed]
        };

        if (item.messageId) {
            const originalMsg = await channel.messages.fetch(item.messageId).catch(() => null);
            if (originalMsg) {
                sendOptions.reply = { messageReference: originalMsg.id };
            }
        }

        await channel.send(sendOptions);
    } catch (err) {
        console.error(`[Rework Queue] Error al enviar notificación a Discord para ${item.username}:`, err);
    }
}

// Guardar cola en archivo
async function saveQueue() {
    try {
        const obj = Object.fromEntries(reworkQueue);
        await fs.writeFile(QUEUE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
        console.error("Error al guardar la cola de reworks:", err);
    }
}

// Agregar usuario a la cola local
async function addToQueue(osuId, reworkId, username, channelId = null, messageId = null, isTop = false, gamemode = "osu", authorId = null) {
    const key = `${osuId}:${reworkId}`;
    reworkQueue.set(key, {
        osuId,
        reworkId,
        username,
        addedAt: Date.now(),
        channelId,
        messageId,
        isTop,
        gamemode,
        authorId
    });
    await saveQueue();
}

// Eliminar usuario de la cola local
async function removeFromQueue(osuId, reworkId) {
    const key = `${osuId}:${reworkId}`;
    if (reworkQueue.has(key)) {
        reworkQueue.delete(key);
        await saveQueue();
    }
}

// Obtener estado de la cola para un usuario
function getQueueStatus(osuId, reworkId) {
    const key = `${osuId}:${reworkId}`;
    return reworkQueue.get(key) || null;
}

// Solicitar recalculación de rework a pp.huismetbenen.nl
async function requestReworkRecalculation(osuId, reworkId) {
    const cookie = process.env.HUISMETBENEN_COOKIE || process.env.HUISMETBENEN_ACCESS_TOKEN;
    if (!cookie) {
        return { success: false, error: "HUISMETBENEN_COOKIE o HUISMETBENEN_ACCESS_TOKEN no configurado en .env" };
    }
    const url = 'https://api.pp.huismetbenen.nl/queue/add-to-queue';
    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Sengo',
        'Cookie': `HUISMETBENEN_ACCESS_TOKEN=${cookie}`
    };

    try {
        const res = await axios.patch(url, {
            user_id: Number(osuId),
            rework: Number(reworkId)
        }, { headers, timeout: 8000 });
        return { success: true, status: res.status, data: res.data };
    } catch (err) {
        const errorMsg = err.response ? JSON.stringify(err.response.data) : err.message;
        return { success: false, error: errorMsg };
    }
}

// Guardar caché en archivo
async function saveCache() {
    try {
        const obj = Object.fromEntries(reworkUserCache);
        await fs.writeFile(CACHE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
        console.error("Error al guardar la caché de reworks:", err);
    }
}

// Obtener la lista completa de reworks y cachearla por 1 hora
async function getReworksList() {
    const now = Date.now();
    if (reworksListCache.data && (now - reworksListCache.timestamp) < 3600000) {
        return reworksListCache.data;
    }
    try {
        const res = await axios.get('https://api.pp.huismetbenen.nl/reworks/list', { timeout: 10000 });
        reworksListCache.data = res.data;
        reworksListCache.timestamp = now;
        return res.data;
    } catch (err) {
        console.error("Error al obtener la lista de reworks:", err.message);
        return reworksListCache.data || [];
    }
}

// Encontrar un rework por ID o consulta de texto, con fallback al "next deploy" según el modo
async function getReworkByQuery(query, gamemode) {
    const reworks = await getReworksList();
    
    // Determinar modo de juego numérico (osu: 0, taiko: 1, catch: 2, mania: 3)
    let modeNum = 0;
    if (gamemode === 'taiko' || gamemode === 1) modeNum = 1;
    else if (gamemode === 'fruits' || gamemode === 'catch' || gamemode === 2) modeNum = 2;
    else if (gamemode === 'mania' || gamemode === 3) modeNum = 3;

    if (!query) {
        // Fallback al próximo deploy (master para standard, master_taiko para taiko)
        let defaultCode = 'master';
        if (modeNum === 1) defaultCode = 'master_taiko';
        
        const found = reworks.find(r => r.code === defaultCode);
        if (found) return found;

        // Si no encontramos un master específico, buscar cualquiera CONFIRMED para ese modo
        const confirmed = reworks.find(r => r.category === 'CONFIRMED' && r.gamemode === modeNum);
        if (confirmed) return confirmed;

        // Fallback final
        return reworks.find(r => r.gamemode === modeNum) || reworks[0];
    }

    const cleanQuery = query.toLowerCase().trim();
    
    // Si la consulta es directamente el ID numérico
    if (/^\d+$/.test(cleanQuery)) {
        const foundId = reworks.find(r => r.id === parseInt(cleanQuery));
        if (foundId) return foundId;
    }

    // Búsqueda por código exacto, contiene código, o contiene nombre
    let found = reworks.find(r => r.code.toLowerCase() === cleanQuery);
    if (!found) found = reworks.find(r => r.code.toLowerCase().includes(cleanQuery));
    if (!found) found = reworks.find(r => r.name.toLowerCase().includes(cleanQuery));
    
    return found;
}

// Obtener datos del usuario bajo un rework específico, utilizando caché
async function getUserReworkData(osuId, reworkId) {
    const key = `${osuId}:${reworkId}`;
    
    // Intentar leer de la caché primero
    if (reworkUserCache.has(key)) {
        return reworkUserCache.get(key);
    }

    try {
        const url = `https://api.pp.huismetbenen.nl/player/userdata/${osuId}/${reworkId}`;
        const res = await axios.get(url, { timeout: 10000 });
        
        if (res.data && res.data.user_id) {
            reworkUserCache.set(key, res.data);
            await saveCache(); // Guardar en el archivo persistente
            return res.data;
        }
        return null;
    } catch (err) {
        console.error(`Error al obtener userdata del rework para el usuario ${osuId}:`, err.message);
        return null;
    }
}

// Obtener puntuaciones recalculadas para un beatmap bajo un rework específico
async function getBeatmapReworkScores(beatmapId, reworkId) {
    const key = `${beatmapId}:${reworkId}`;
    if (beatmapScoresCache.has(key)) {
        return beatmapScoresCache.get(key);
    }

    try {
        const url = `https://api.pp.huismetbenen.nl/beatmaps/scores/${beatmapId}/${reworkId}`;
        const res = await axios.get(url, { timeout: 10000 });
        if (Array.isArray(res.data)) {
            beatmapScoresCache.set(key, res.data);
            return res.data;
        }
        return [];
    } catch (err) {
        // Silenciar errores de mapas que no existen o no están rankeados
        return [];
    }
}

// Normalizar lista de mods para emparejamiento
function normalizeMods(mods) {
    if (!mods) return "";
    let arr = [];
    if (typeof mods === 'string') {
        const clean = mods.replace(/[+]/g, '').toUpperCase();
        if (clean === 'NOMOD' || clean === 'NM' || clean === 'NONE' || clean === '') {
            return "";
        }
        // Dividir en fragmentos de 2 caracteres
        for (let i = 0; i < clean.length; i += 2) {
            arr.push(clean.substring(i, i + 2));
        }
    } else if (Array.isArray(mods)) {
        arr = mods.map(m => typeof m === 'object' ? m.acronym : m);
    }
    
    // Ignorar mods que no afectan el escalado de dificultad o PP
    const ignored = new Set(['CL', 'NF', 'SO', 'SD', 'PF']);
    const cleaned = arr
        .map(m => m.toUpperCase())
        .filter(m => !ignored.has(m));
        
    cleaned.sort();
    return cleaned.join("");
}

// Calcular estimaciones de PP y estrellas para el rework
function calculateReworkPPForMap(beatmapScores, modsStr, livePPValues) {
    const targetNormalized = normalizeMods(modsStr);
    
    // Buscar scores que coincidan exactamente con los mods solicitados (normalizados)
    const matchingScores = beatmapScores.filter(s => {
        const norm = normalizeMods(s.mods);
        return norm === targetNormalized;
    });

    let ratio = 1.0;
    let srRatio = 1.0;
    let hasExactMatch = false;

    if (matchingScores.length > 0) {
        hasExactMatch = true;
        let sumRatio = 0;
        let sumSrRatio = 0;
        let count = 0;

        for (const score of matchingScores) {
            if (score.values && score.values.difference_live_relative) {
                sumRatio += score.values.difference_live_relative;
                const liveSr = score.values.sr - (score.values.difference_sr_live || 0);
                if (liveSr > 0) {
                    sumSrRatio += score.values.sr / liveSr;
                } else {
                    sumSrRatio += 1.0;
                }
                count++;
            }
        }
        if (count > 0) {
            ratio = sumRatio / count;
            srRatio = sumSrRatio / count;
        }
    } else if (beatmapScores.length > 0) {
        // Fallback: promedio de todos los scores del mapa
        let sumRatio = 0;
        let sumSrRatio = 0;
        let count = 0;
        for (const score of beatmapScores) {
            if (score.values && score.values.difference_live_relative) {
                sumRatio += score.values.difference_live_relative;
                const liveSr = score.values.sr - (score.values.difference_sr_live || 0);
                if (liveSr > 0) {
                    sumSrRatio += score.values.sr / liveSr;
                } else {
                    sumSrRatio += 1.0;
                }
                count++;
            }
        }
        if (count > 0) {
            ratio = sumRatio / count;
            srRatio = sumSrRatio / count;
        }
    }

    // Calcular valores de PP estimados usando el ratio
    const ppSS = livePPValues.ppSS * ratio;
    const pp99 = livePPValues.pp99 * ratio;
    const pp98 = livePPValues.pp98 * ratio;
    const pp95 = livePPValues.pp95 * ratio;
    const stars = livePPValues.baseStars * srRatio;

    return {
        ppSS,
        pp99,
        pp98,
        pp95,
        stars,
        ratio,
        hasExactMatch,
        hasScores: beatmapScores.length > 0
    };
}

const userReworkScoresCache = new Map();

// Obtener todas las puntuaciones recalculadas del jugador en un rework
async function getUserReworkScores(osuId, reworkId, gamemode) {
    let modeNum = 0;
    if (gamemode === 'taiko' || gamemode === 1) modeNum = 1;
    else if (gamemode === 'fruits' || gamemode === 'catch' || gamemode === 2) modeNum = 2;
    else if (gamemode === 'mania' || gamemode === 3) modeNum = 3;

    // Usar la caché con la clave que incluye topranks
    const key = `${osuId}:${reworkId}:${modeNum}:topranks`;
    if (userReworkScoresCache.has(key)) {
        return userReworkScoresCache.get(key);
    }

    try {
        const url = `https://api.pp.huismetbenen.nl/player/scores/${osuId}/${reworkId}/topranks`;
        const res = await axios.get(url, { timeout: 15000 });
        if (Array.isArray(res.data)) {
            const filtered = res.data.filter(score => {
                const scoreMode = (score.beatmap && typeof score.beatmap.gamemode === 'number')
                    ? score.beatmap.gamemode
                    : 0;
                return scoreMode === modeNum;
            });
            userReworkScoresCache.set(key, filtered);
            return filtered;
        }
        return [];
    } catch (err) {
        console.error(`Error al obtener top scores del rework para el usuario ${osuId}:`, err.message);
        return [];
    }
}

// Inicializar la caché al cargar el módulo
initCache();

module.exports = {
    initClient,
    getReworksList,
    getReworkByQuery,
    getUserReworkData,
    getBeatmapReworkScores,
    normalizeMods,
    calculateReworkPPForMap,
    getUserReworkScores,
    addToQueue,
    removeFromQueue,
    getQueueStatus,
    requestReworkRecalculation
};

