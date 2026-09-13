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

        // 1. Consultar usuario completo y beatmapsets en paralelo (incluyendo guest diffs)
        const [fullUser, rankedSets, pendingSets, graveyardSets, lovedSets, guestSets] = await Promise.all([
            osuClient.users.getUser(userId, { urlObject: { key: 'id' } }).catch(() => osuUser),
            osuClient.users.getUserBeatmaps(userId, 'ranked', { query: { limit: 50 } }).catch(() => []),
            osuClient.users.getUserBeatmaps(userId, 'pending', { query: { limit: 50 } }).catch(() => []),
            osuClient.users.getUserBeatmaps(userId, 'graveyard', { query: { limit: 50 } }).catch(() => []),
            osuClient.users.getUserBeatmaps(userId, 'loved', { query: { limit: 50 } }).catch(() => []),
            osuClient.users.getUserBeatmaps(userId, 'guest', { query: { limit: 50 } }).catch(() => [])
        ]);

        const gamemode = (options.gamemode || fullUser.playmode || "osu").toLowerCase();

        // 2. Unificar y ordenar mapsets por fecha para obtener el último y el previo
        const rankedOrLoved = [...(rankedSets || []), ...(lovedSets || [])];
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

        // 4. Asegurar registro del mapper en mapper_statistics para ranking actualizado
        let ranksInfo = { nationalRank: null, serverRank: null };
        try {
            const { getSupabaseClient } = require("../db/database.js");
            const supabase = getSupabaseClient();
            if (supabase) {
                await supabase.from('mapper_statistics').upsert({
                    osu_id: userId,
                    username: fullUser.username,
                    country_code: countryCode,
                    ranked_count: rankedCount,
                    loved_count: lovedCount,
                    pending_count: pendingCount,
                    graveyard_count: graveyardCount,
                    guest_count: fullUser.guest_beatmapset_count || 0,
                    kudosu_total: fullUser.kudosu?.total || 0,
                    followers: fullUser.follower_count || fullUser.mapping_follower_count || 0,
                    playmode: gamemode
                }, { onConflict: 'osu_id' });
            }
            ranksInfo = await MappingTrackerModel.getMapperRankings(userId, countryCode, guildId, false, gamemode);
        } catch {}

        // 5. Métricas de seguimiento y suscriptores locales en Sengo
        let subscribersCount = 0;
        try {
            const subs = await MappingTrackerModel.getSubscriptionsForOsuId(userId);
            subscribersCount = Array.isArray(subs) ? subs.length : 0;
        } catch {}

        // 6. Métricas de habilidades y atributos del mapper:
        // A) Amplitud de Rango: diferencia entre el mapa rankeado más bajo y más alto (minSR y maxSR)
        const targetForSR = rankedOrLoved.length > 0 ? rankedOrLoved : allSets;
        let allSRs = [];
        for (const s of targetForSR) {
            if (Array.isArray(s.beatmaps)) {
                for (const b of s.beatmaps) {
                    const sr = Number(b.difficulty_rating || 0);
                    if (sr > 0) allSRs.push(sr);
                }
            }
        }
        const minSR = allSRs.length > 0 ? Math.min(...allSRs) : 0;
        const maxSR = allSRs.length > 0 ? Math.max(...allSRs) : 0;
        const srAmplitude = parseFloat(Math.max(0, maxSR - minSR).toFixed(1));
        // ponytail: escala de barras 1 a 6 basada en amplitud típica de SR hasta ~10*
        const amplitudeBars = Math.min(6, Math.max(1, Math.round((srAmplitude / 10) * 6)));

        // B) Ritmo: frecuencia con la que produce contenido ranked/loved (últimos 12 meses y periodicidad)
        const now = Date.now();
        const oneYearMs = 365.25 * 24 * 60 * 60 * 1000;
        let rhythmPct = 0;
        if (rankedOrLoved.length > 0) {
            const recentRankeds = rankedOrLoved.filter(s => {
                const d = new Date(s.ranked_date || s.last_updated || 0).getTime();
                return (now - d) <= oneYearMs;
            }).length;
            const recentWeight = Math.min(60, recentRankeds * 12);

            let cadenceWeight = 20;
            if (rankedOrLoved.length >= 2) {
                const sortedDates = rankedOrLoved
                    .map(s => new Date(s.ranked_date || s.last_updated || 0).getTime())
                    .filter(d => d > 0)
                    .sort((a, b) => a - b);
                let totalGaps = 0;
                for (let i = 1; i < sortedDates.length; i++) {
                    totalGaps += (sortedDates[i] - sortedDates[i - 1]);
                }
                const avgGapDays = (totalGaps / (sortedDates.length - 1)) / (1000 * 60 * 60 * 24);
                // ponytail: decaimiento exponencial según el promedio de días entre rankeds (base 120 días)
                cadenceWeight = Math.min(40, Math.max(5, Math.round(40 * Math.exp(-avgGapDays / 120))));
            }
            rhythmPct = parseFloat(Math.min(99.9, Math.max(5.0, recentWeight + cadenceWeight)).toFixed(1));
        } else {
            // Mapper sin rankeds: medir actividad de subidas recientes
            const recentUploads = allSets.filter(s => {
                const d = new Date(s.submitted_date || s.last_updated || 0).getTime();
                return (now - d) <= oneYearMs;
            }).length;
            rhythmPct = parseFloat(Math.min(30.0, Math.max(2.0, recentUploads * 4)).toFixed(1));
        }
        const rhythmBars = Math.min(6, Math.max(1, Math.round((rhythmPct / 100) * 6)));

        // C) Alcance: mide el impacto total a partir de favoritos y reproducciones
        let totalPlays = 0;
        let totalFavs = 0;
        for (const s of allSets) {
            totalPlays += Number(s.play_count || 0);
            totalFavs += Number(s.favourite_count || 0);
        }
        const impactScore = totalFavs * 100 + totalPlays;
        let reachPct = 5.0;
        if (impactScore > 0) {
            // ponytail: escala logarítmica para normalizar impactos desde miles hasta cientos de millones
            reachPct = parseFloat(Math.min(99.9, Math.max(5.0, (Math.log10(impactScore + 1) / 8.5) * 100)).toFixed(1));
        }
        const reachBars = Math.min(6, Math.max(1, Math.round((reachPct / 100) * 6)));

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

        // 7. Calcular títulos desbloqueados y seleccionar el principal
        const titleInfo = this.calculateMapperTitles(
            fullUser,
            rankedSets,
            lovedSets,
            pendingSets,
            graveyardSets,
            guestSets,
            uniqueSets
        );

        return {
            mode: gamemode,
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
                amplitudeBars: amplitudeBars,
                rhythmBars: rhythmBars,
                reachBars: reachBars
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
            title: options.customTitle || titleInfo.primaryTitle || "Mapper Aprendiz",
            allTitles: titleInfo.allTitles
        };
    }

    /**
     * Calcula todos los títulos de mapper disponibles según estadísticas y mapsets.
     * Prioriza la rama Ranked si cumple los requisitos; de lo contrario, toma el título de mayor tier.
     */
    static calculateMapperTitles(fullUser, rankedSets = [], lovedSets = [], pendingSets = [], graveyardSets = [], guestSets = [], uniqueSets = []) {
        const rankedCount = fullUser.ranked_and_approved_beatmapset_count ?? rankedSets.length;
        const lovedCount = fullUser.loved_beatmapset_count ?? lovedSets.length;
        const pendingCount = fullUser.pending_beatmapset_count ?? pendingSets.length;
        const graveyardCount = fullUser.graveyard_beatmapset_count ?? graveyardSets.length;
        const totalUploaded = rankedCount + lovedCount + pendingCount + graveyardCount;

        const titles = [];

        // 1. Rama Ranked (Prioridad principal)
        if (rankedCount >= 75) {
            titles.push({ id: 'ranked_master', name: 'Maestro Ranked', category: 'ranked', tier: 3 });
        } else if (rankedCount >= 25) {
            titles.push({ id: 'ranked_inter', name: 'Intermedio Ranked', category: 'ranked', tier: 2 });
        } else if (rankedCount >= 5) {
            titles.push({ id: 'ranked_novice', name: 'Novato Ranked', category: 'ranked', tier: 1 });
        } else if (rankedCount >= 1) {
            titles.push({ id: 'ranked_aspirant', name: 'Aspirante Ranked', category: 'ranked', tier: 0 });
        }

        // 2. Rama SR (Top diff de cada mapset del mapper)
        let count6Plus = 0;
        let count7Plus = 0;
        let count8Plus = 0;
        for (const s of (uniqueSets || [])) {
            if (Array.isArray(s.beatmaps) && s.beatmaps.length > 0) {
                const diffsSR = s.beatmaps.map(b => Number(b.difficulty_rating || 0));
                const topSR = Math.max(...diffsSR);
                if (topSR >= 8.0) count8Plus++;
                if (topSR >= 7.0) count7Plus++;
                if (topSR >= 6.0) count6Plus++;
            }
        }

        if (count8Plus >= 3) {
            titles.push({ id: 'sr_demon', name: 'Demonio del SR', category: 'sr', tier: 3 });
        } else if (count7Plus >= 5) {
            titles.push({ id: 'sr_harasser', name: 'Hostigador de SR', category: 'sr', tier: 2 });
        } else if (count6Plus >= 6) {
            titles.push({ id: 'sr_challenger', name: 'Desafiador de SR', category: 'sr', tier: 1 });
        }

        // 3. Rama Alta Tasa de Éxito (Mapas 'resueltos' sin contar pendientes)
        const resolvedCount = rankedCount + lovedCount + graveyardCount;
        if (resolvedCount >= 10) {
            const graveyardRatio = graveyardCount / resolvedCount;
            if (graveyardRatio <= 0.20) {
                titles.push({ id: 'high_success_rate', name: 'Alta Tasa de Éxito', category: 'success_rate', tier: 2 });
            }
        }

        // 4. Rama Loved
        if (lovedCount >= 25) {
            titles.push({ id: 'loved_master', name: 'Maestro Loved', category: 'loved', tier: 3 });
        } else if (lovedCount >= 10) {
            titles.push({ id: 'loved_inter', name: 'Intermedio Loved', category: 'loved', tier: 2 });
        } else if (lovedCount >= 5) {
            titles.push({ id: 'loved_novice', name: 'Novato Lover', category: 'loved', tier: 1 });
        }

        // 5. Rama Guest Diffs (mapsets con GDs en estado ranked o loved)
        const rankedOrLovedGds = (guestSets || []).filter(s => 
            ['ranked', 'approved', 'loved'].includes(s.status?.toLowerCase())
        ).length;

        if (rankedOrLovedGds >= 30) {
            titles.push({ id: 'gd_master', name: 'Maestro de Guest Diff', category: 'guest_diff', tier: 3 });
        } else if (rankedOrLovedGds >= 15) {
            titles.push({ id: 'gd_inter', name: 'Intermedio de Guest Diff', category: 'guest_diff', tier: 2 });
        } else if (rankedOrLovedGds >= 3) {
            titles.push({ id: 'gd_novice', name: 'Novato de Guest Diff', category: 'guest_diff', tier: 1 });
        }

        // 6. Rama Mapper Prolífico (Volumen total subido)
        if (totalUploaded >= 250) {
            titles.push({ id: 'prolific_master', name: 'Maestro Prolífico', category: 'prolific', tier: 3 });
        } else if (totalUploaded >= 100) {
            titles.push({ id: 'prolific_inter', name: 'Intermedio Prolífico', category: 'prolific', tier: 2 });
        } else if (totalUploaded >= 50) {
            titles.push({ id: 'prolific_novice', name: 'Novato Prolífico', category: 'prolific', tier: 1 });
        }

        // Selección de título principal:
        // Prioridad: Rama Ranked si cumple requisitos; de lo contrario, el de mayor tier
        let primaryTitle = 'Mapper Aprendiz';

        const rankedTitle = titles.find(t => t.category === 'ranked');
        if (rankedTitle) {
            primaryTitle = rankedTitle.name;
        } else if (titles.length > 0) {
            const sorted = [...titles].sort((a, b) => b.tier - a.tier);
            primaryTitle = sorted[0].name;
        }

        return {
            primaryTitle,
            allTitles: titles
        };
    }
}

module.exports = MapperCardModel;
