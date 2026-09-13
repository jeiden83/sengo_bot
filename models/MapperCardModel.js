const { Client } = require("osu-web.js");
const OsuUserModel = require("./OsuUserModel.js");
const MappingTrackerModel = require("./MappingTrackerModel.js");

/**
 * Modelo para recopilar y estructurar todos los datos necesarios para la Mapper Card (.card -mapper).
 */
class MapperCardModel {
    /**
     * Obtiene una instancia autenticada del cliente osu-web.js
     */
    static async getOsuClient() {
        const token = await OsuUserModel.loadToken();
        return new Client(token.access_token);
    }

    /**
     * Recopila todos los datos del mapper para la tarjeta
     * @param {Object} osuUser - Objeto de usuario básico de osu!
     * @param {Object} options - Opciones adicionales (guildId, etc.)
     */
    static async getMapperCardData(osuUser, options = {}) {
        if (!osuUser || !osuUser.id) {
            throw new Error("Usuario de osu! inválido o no proporcionado");
        }

        const userId = Number(osuUser.id);
        const guildId = options.guildId || null;
        const countryCode = (osuUser.country_code || osuUser.country?.code || "VE").toUpperCase();

        const osuClient = await this.getOsuClient();

        // 1. Consultar usuario completo y beatmapsets en paralelo
        const [fullUser, rankedSets, pendingSets, graveyardSets, lovedSets, ranksInfo] = await Promise.all([
            osuClient.users.getUser(userId, { urlObject: { key: 'id' } }).catch(() => osuUser),
            osuClient.users.getUserBeatmaps(userId, 'ranked', { query: { limit: 10 } }).catch(() => []),
            osuClient.users.getUserBeatmaps(userId, 'pending', { query: { limit: 10 } }).catch(() => []),
            osuClient.users.getUserBeatmaps(userId, 'graveyard', { query: { limit: 10 } }).catch(() => []),
            osuClient.users.getUserBeatmaps(userId, 'loved', { query: { limit: 10 } }).catch(() => []),
            MappingTrackerModel.getMapperRankings(userId, countryCode, guildId, false).catch(() => ({ nationalRank: null, serverRank: null }))
        ]);

        // 2. Unificar y ordenar mapsets por fecha para obtener el último y el previo
        const allSets = [
            ...(pendingSets || []),
            ...(rankedSets || []),
            ...(lovedSets || []),
            ...(graveyardSets || [])
        ];

        allSets.sort((a, b) => {
            const dateA = new Date(a.submitted_date || a.last_updated || 0).getTime();
            const dateB = new Date(b.submitted_date || b.last_updated || 0).getTime();
            if (dateB !== dateA) return dateB - dateA;
            return (b.id || 0) - (a.id || 0);
        });

        // Deduplicar por set ID
        const uniqueSets = [];
        const seenSetIds = new Set();
        for (const s of allSets) {
            if (s && s.id && !seenSetIds.has(s.id)) {
                seenSetIds.add(s.id);
                uniqueSets.push(s);
            }
        }

        const latestSet = uniqueSets[0] || null;
        const prevSet = uniqueSets[1] || null;

        // 3. Conteos de mapas
        const rankedCount = fullUser.ranked_and_approved_beatmapset_count ?? rankedSets.length;
        const lovedCount = fullUser.loved_beatmapset_count ?? lovedSets.length;
        const pendingCount = fullUser.pending_beatmapset_count ?? pendingSets.length;
        const graveyardCount = fullUser.graveyard_beatmapset_count ?? graveyardSets.length;
        const totalUploaded = rankedCount + lovedCount + pendingCount + graveyardCount;

        // Tasa de éxito (porcentaje de ranked sobre el total subido)
        const successRate = totalUploaded > 0
            ? Math.round((rankedCount / totalUploaded) * 100)
            : 0;

        // 4. Métricas de seguimiento y suscriptores locales en Sengo
        let subscribersCount = 0;
        try {
            const subs = await MappingTrackerModel.getSubscriptionsForOsuId(userId);
            subscribersCount = Array.isArray(subs) ? subs.length : 0;
        } catch {}

        // 5. Métricas de habilidades y rangos (Amplitud, Ritmo, Alcance)
        let srAmplitude = 5.5;
        let rhythmPct = 23.5;
        let reachPct = 52.8;

        if (latestSet && Array.isArray(latestSet.beatmaps) && latestSet.beatmaps.length > 0) {
            const srs = latestSet.beatmaps.map(b => Number(b.difficulty_rating || 0)).filter(sr => sr > 0);
            if (srs.length > 0) {
                const maxSR = Math.max(...srs);
                srAmplitude = parseFloat(maxSR.toFixed(1));
            }
        }

        // Ritmo: basado en la complejidad de BPM o ratio de notas
        if (latestSet?.bpm) {
            rhythmPct = parseFloat(Math.min(99.9, Math.max(10.0, (latestSet.bpm / 240) * 50)).toFixed(1));
        }

        // Alcance: basado en reproducciones y favoritos
        if (latestSet) {
            const plays = Number(latestSet.play_count || 0);
            const favs = Number(latestSet.favourite_count || 0);
            if (plays > 0 || favs > 0) {
                reachPct = parseFloat(Math.min(99.9, Math.max(5.0, (favs * 20 + plays / 100) % 100)).toFixed(1));
            }
        }

        // Formatear números para display (ej: 180k, 2.230k)
        function formatCompact(num) {
            if (num == null || isNaN(num)) return "0";
            const n = Number(num);
            if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
            if (n >= 1000) {
                const kVal = n / 1000;
                return (kVal % 1 === 0 ? kVal.toFixed(0) : kVal.toFixed(1)) + "k";
            }
            return String(n);
        }

        return {
            user: {
                id: fullUser.id,
                username: fullUser.username,
                countryCode: countryCode,
                avatarUrl: fullUser.avatar_url || `https://a.ppy.sh/${fullUser.id}`,
                coverUrl: fullUser.cover_url || fullUser.cover?.url || fullUser.cover?.custom_url || null,
                followers: formatCompact(fullUser.follower_count || fullUser.mapping_follower_count || 0),
                rawFollowers: fullUser.follower_count || 0,
                subscribers: String(subscribersCount),
                kudosu: formatCompact(fullUser.kudosu?.total || 0),
                rawKudosu: fullUser.kudosu?.total || 0
            },
            ranks: {
                countryRank: ranksInfo?.nationalRank ? `#${ranksInfo.nationalRank}` : (ranksInfo?.oldNationalRank ? `#${ranksInfo.oldNationalRank}` : "-"),
                serverRank: ranksInfo?.serverRank ? `#${ranksInfo.serverRank}` : (ranksInfo?.oldServerRank ? `#${ranksInfo.oldServerRank}` : "-"),
                hasServerRank: Boolean(ranksInfo?.serverRank)
            },
            stats: {
                rankedCount: String(rankedCount),
                lovedCount: String(lovedCount),
                pendingCount: String(pendingCount),
                graveyardCount: String(graveyardCount),
                successRate: `${successRate}%`
            },
            metrics: {
                amplitudeSR: `${srAmplitude}*`,
                rhythmPct: `${rhythmPct}%`,
                reachPct: `${reachPct}%`,
                amplitudeBars: Math.min(6, Math.max(1, Math.round((srAmplitude / 8) * 6))),
                rhythmBars: Math.min(6, Math.max(1, Math.round((rhythmPct / 100) * 6))),
                reachBars: Math.min(6, Math.max(1, Math.round((reachPct / 100) * 6)))
            },
            latestMap: latestSet ? {
                id: latestSet.id,
                title: latestSet.title || "Unknown Title",
                artist: latestSet.artist || "Unknown Artist",
                status: (latestSet.status || "PENDING").toUpperCase(),
                playCount: formatCompact(latestSet.play_count || 0),
                favCount: formatCompact(latestSet.favourite_count || 0),
                coverUrl: latestSet.covers?.["cover@2x"] || latestSet.covers?.cover || latestSet.covers?.card || null
            } : null,
            prevMap: prevSet ? {
                id: prevSet.id,
                title: prevSet.title || "Mapa Previo subido",
                artist: prevSet.artist || "",
                status: (prevSet.status || "GRAVEYARD").toUpperCase(),
                coverUrl: prevSet.covers?.["cover@2x"] || prevSet.covers?.cover || prevSet.covers?.card || null
            } : null,
            title: options.customTitle || "Novato Ranked" // Título fijo por defecto
        };
    }
}

module.exports = MapperCardModel;
