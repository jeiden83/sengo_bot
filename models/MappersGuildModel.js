const fs = require("fs");
const path = require("path");
const axios = require("axios");

const CACHE_FILE = path.join(process.cwd(), "data/bn_cache.json");

let cachedBnData = null;
let lastBnFetch = 0;

// Cargar la caché persistente desde disco al iniciar el módulo
try {
    if (fs.existsSync(CACHE_FILE)) {
        const fileContent = fs.readFileSync(CACHE_FILE, "utf8");
        const parsed = JSON.parse(fileContent);
        if (parsed && Array.isArray(parsed.data)) {
            cachedBnData = parsed.data;
            lastBnFetch = parsed.lastFetch || 0;
            console.log(`[BN-CACHE] Caché persistente cargada desde disco (${cachedBnData.length} BNs).`);
        }
    }
} catch (err) {
    console.error("[BN-CACHE] Error al cargar caché persistente desde disco:", err);
}

/**
 * Obtiene la lista completa de usuarios del Mappers' Guild y filtra a los BNs y NATs.
 * @param {boolean} force - Si es true, ignora la caché y realiza la petición.
 * @returns {Promise<Array>} Lista de BNs y NATs filtrados.
 */
async function getBnUsers(force = false) {
    const now = Date.now();
    if (!force && cachedBnData) {
        return cachedBnData;
    }

    try {
        const response = await axios.get("https://bn.mappersguild.com/api/users/relevantInfo", {
            timeout: 15000,
            headers: {
                "User-Agent": "SengoBot (https://github.com/jeiden83/sengo_bot)"
            }
        });

        if (response.data && Array.isArray(response.data.users)) {
            // Filtrar usuarios que tienen rol de BN o NAT
            const filteredUsers = response.data.users.filter(u => {
                const hasBnRole = u.isBn || u.isNat || u.isTrialNat;
                const hasBnGroup = u.groups && (u.groups.includes('bn') || u.groups.includes('nat') || u.groups.includes('gmt'));
                return hasBnRole || hasBnGroup;
            });

            // Mapear campos para asegurar compatibilidad y coherencia en las búsquedas
            const mappedUsers = filteredUsers.map(u => {
                // Mapear preferencias para que no tengan arrays anidados y coincidan con lo mostrado en el perfil
                const genrePreferences = (u.genrePreferences || []).concat(u.customGenrePreferences || []);
                const languagePreferences = (u.languagePreferences || []).concat(u.customLanguagePreferences || []);
                const detailPreferences = (u.detailPreferences || []).concat(u.customDetailPreferences || []);
                
                return {
                    id: u._id || u.id,
                    osuId: u.osuId,
                    username: u.username,
                    groups: u.groups || [],
                    modes: u.modes || [],
                    modesInfo: u.modesInfo || [],
                    requestStatus: u.requestStatus || [],
                    requestLink: u.requestLink || null,
                    requestInfo: u.requestInfo || null,
                    languages: u.languages || [],
                    lastOpenedForRequests: u.lastOpenedForRequests || null,
                    bnDuration: u.bnDuration || 0,
                    cover: u.cover || null,
                    countryCode: u.countryCode || 'XX',
                    rankedBeatmapsets: u.rankedBeatmapsets || 0,
                    genrePreferences,
                    languagePreferences,
                    detailPreferences,
                    customMapPreferences: u.customMapPreferences || []
                };
            });

            cachedBnData = mappedUsers;
            lastBnFetch = now;

            // Guardar caché persistente en disco de forma asíncrona
            try {
                fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
                fs.writeFile(CACHE_FILE, JSON.stringify({
                    lastFetch: lastBnFetch,
                    data: cachedBnData
                }, null, 2), "utf8", (err) => {
                    if (err) {
                        console.error("[BN-CACHE] Error al escribir caché persistente en disco:", err);
                    }
                });
            } catch (err) {
                console.error("[BN-CACHE] Error al guardar caché en disco:", err);
            }

            return cachedBnData;
        } else {
            throw new Error("Formato de respuesta inválido de Mappers' Guild API");
        }
    } catch (error) {
        console.error("Error al consultar Mappers' Guild:", error);
        // Si falla la consulta pero hay caché vieja, usarla como respaldo
        if (cachedBnData) {
            return cachedBnData;
        }
        throw error;
    }
}

/**
 * Inicia el servicio en segundo plano para actualizar los datos de BNs cada hora.
 */
function startBnBackgroundService() {
    const Logger = require("../utils/logger.js");
    Logger.system("Iniciando servicio de actualización periódica de BNs (Mappers' Guild)...");
    
    // Precarga inicial al iniciar el bot
    getBnUsers(true).then(() => {
        Logger.system("Datos de BNs (Mappers' Guild) precargados exitosamente en caché.");
    }).catch(err => {
        Logger.system(`Error en precarga inicial de BNs: ${err.message}`);
    });

    // Ejecutar cada 1 hora
    setInterval(async () => {
        Logger.system("Ejecutando actualización periódica horaria de BNs...");
        try {
            await getBnUsers(true);
            Logger.system("Actualización periódica de BNs completada exitosamente.");
        } catch (err) {
            Logger.system(`Error al actualizar periódicamente los BNs: ${err.message}`);
        }
    }, 60 * 60 * 1000); // 1 hora
}

module.exports = {
    getBnUsers,
    startBnBackgroundService
};
