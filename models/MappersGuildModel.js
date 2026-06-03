const axios = require("axios");

let cachedBnData = null;
let lastBnFetch = 0;
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes cache

/**
 * Obtiene la lista completa de usuarios del Mappers' Guild y filtra a los BNs y NATs.
 * @returns {Promise<Array>} Lista de BNs y NATs filtrados.
 */
async function getBnUsers() {
    const now = Date.now();
    if (cachedBnData && (now - lastBnFetch < CACHE_DURATION)) {
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

module.exports = {
    getBnUsers
};
