const Logger = require('../utils/logger.js');
const BotSettingsModel = require('../models/BotSettingsModel.js');
const OsuWebSessionModel = require('../models/OsuWebSessionModel.js');
const { doOsuFriendsTrackerEmbed } = require('../views/osuUserViews.js');

const CHECK_INTERVAL = 8 * 60 * 60 * 1000; // 8 horas en milisegundos

/**
 * Ejecuta una comprobación del estado de seguidores y amigos mutuales del creador.
 * 
 * @param {import('discord.js').Client} client - Cliente de Discord
 * @param {Object} [options={}]
 * @param {boolean} [options.force=false] - Si es true, ignora el chequeo previo de followers y fuerza la comparación.
 * @param {string} [options.targetChannelId=null] - Canal de destino opcional (para pruebas inmediatas).
 * @returns {Promise<{ changed: boolean, followers?: number, error?: string }>}
 */
async function runOwnerFriendsCheck(client, { force = false, targetChannelId = null } = {}) {
    const channelId = targetChannelId || await BotSettingsModel.getSetting('owner_friends_tracker_channel');
    if (!channelId) {
        return { changed: false, reason: 'no_channel' };
    }

    const session = process.env.OSU_SESSION;
    if (!session) {
        Logger.system('[FRIENDS-TRACKER] Omitido: No hay OSU_SESSION en las variables de entorno.');
        return { changed: false, reason: 'no_session' };
    }

    try {
        const lastFollowersStr = await BotSettingsModel.getSetting('owner_friends_tracker_followers');
        const prevSnapshotStr = await BotSettingsModel.getSetting('owner_friends_tracker_snapshot');

        const OsuUserModel = require('../models/OsuUserModel.js');
        let ownerOsuId = await BotSettingsModel.getSetting('owner_friends_tracker_osu_id');
        let ownerProfile = null;
        if (ownerOsuId) {
            ownerProfile = await OsuUserModel.getOsuUser({ username: [ownerOsuId], gamemode: 'osu' }).catch(() => null);
        }

        const currentFollowers = ownerProfile?.follower_count ?? null;
        const oldFollowers = lastFollowersStr !== null ? Number(lastFollowersStr) : (currentFollowers ?? 0);

        // Si ya había registro previo y no es forzado, verificar si cambiaron los seguidores
        if (!force && lastFollowersStr !== null && currentFollowers !== null && currentFollowers === oldFollowers) {
            Logger.system(`[FRIENDS-TRACKER] Seguidores del creador sin cambios (${currentFollowers}). No se requiere scraping web.`);
            return { changed: false, followers: currentFollowers };
        }

        // Consultar lista web actual con sesión
        const webData = await OsuWebSessionModel.fetchWebFriends({ bypassCache: true });
        if (!webData || !webData.currentUser) {
            Logger.system('[FRIENDS-TRACKER] No se pudieron obtener los datos de /home/friends.');
            return { changed: false, error: 'fetch_failed' };
        }

        if (!ownerOsuId && webData.currentUser.id) {
            ownerOsuId = String(webData.currentUser.id);
            await BotSettingsModel.setSetting('owner_friends_tracker_osu_id', ownerOsuId);
        }

        const freshProfile = ownerProfile || await OsuUserModel.getOsuUser({ username: [String(webData.currentUser.id)], gamemode: 'osu' }).catch(() => null);
        const effectiveFollowers = freshProfile?.follower_count ?? oldFollowers;

        let newMutuals = [];
        let lostMutuals = [];
        let newFriends = [];
        let removedFriends = [];
        let hasChanges = false;

        if (prevSnapshotStr) {
            try {
                const prevFriends = JSON.parse(prevSnapshotStr);
                const prevMap = new Map(prevFriends.map(f => [f.id, f]));
                const currMap = new Map(webData.friends.map(f => [f.id, f]));

                // Detectar nuevos mutuals (antes no eran mutual y ahora sí)
                newMutuals = webData.friends.filter(c => {
                    const isNowMutual = c.mutual === 'yes' || c.is_mutual;
                    const wasPrevMutual = prevMap.has(c.id) && (prevMap.get(c.id).mutual === 'yes' || prevMap.get(c.id).is_mutual);
                    return isNowMutual && !wasPrevMutual;
                });

                // Detectar mutuals perdidos (antes eran mutual y ahora no o ya no están en amigos)
                lostMutuals = prevFriends.filter(p => {
                    const wasPrevMutual = p.mutual === 'yes' || p.is_mutual;
                    const isNowMutual = currMap.has(p.id) && (currMap.get(p.id).mutual === 'yes' || currMap.get(p.id).is_mutual);
                    return wasPrevMutual && !isNowMutual;
                });

                // Detectar amigos añadidos y eliminados
                newFriends = webData.friends.filter(c => !prevMap.has(c.id));
                removedFriends = prevFriends.filter(p => !currMap.has(p.id));

                hasChanges = (effectiveFollowers !== oldFollowers) ||
                    newMutuals.length > 0 ||
                    lostMutuals.length > 0 ||
                    newFriends.length > 0 ||
                    removedFriends.length > 0;
            } catch (err) {
                Logger.system(`[FRIENDS-TRACKER] Error al parsear snapshot previo: ${err.message}`);
                hasChanges = true;
            }
        }

        // Si hubo cambios o es forzado y hay variaciones, enviar alerta a Discord
        if (hasChanges && client) {
            try {
                const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
                if (channel && typeof channel.send === 'function') {
                    const embed = doOsuFriendsTrackerEmbed(channel, {
                        oldFollowers,
                        newFollowers: effectiveFollowers,
                        newMutuals,
                        lostMutuals,
                        newFriends,
                        removedFriends,
                        totalFriends: webData.totalFriends,
                        totalMutuals: webData.totalMutuals,
                        user: webData.currentUser
                    });

                    await channel.send({ embeds: [embed] });
                    Logger.system(`[FRIENDS-TRACKER] Alerta de cambios enviada al canal ${channelId}.`);
                } else {
                    Logger.system(`[FRIENDS-TRACKER] No se pudo encontrar el canal ${channelId} para enviar la alerta.`);
                }
            } catch (err) {
                Logger.system(`[FRIENDS-TRACKER] Error al enviar embed al canal ${channelId}: ${err.message}`);
            }
        }

        // Guardar snapshot actualizado en Supabase (bot_settings)
        await BotSettingsModel.setSetting('owner_friends_tracker_followers', effectiveFollowers.toString());
        await BotSettingsModel.setSetting('owner_friends_tracker_snapshot', JSON.stringify(webData.friends));
        await BotSettingsModel.setSetting('owner_friends_tracker_last_check', new Date().toISOString());

        return {
            changed: hasChanges,
            followers: effectiveFollowers,
            newMutuals: newMutuals.length,
            lostMutuals: lostMutuals.length
        };
    } catch (err) {
        Logger.system(`[FRIENDS-TRACKER] Error inesperado en runOwnerFriendsCheck: ${err.message}`);
        return { changed: false, error: err.message };
    }
}

/**
 * Inicializa el servicio en segundo plano que ejecuta el tracking de amigos cada 8 horas.
 * 
 * @param {import('discord.js').Client} client - Cliente de Discord
 */
function initOwnerFriendsTracker(client) {
    Logger.system('Inicializando servicio de Tracking de Amigos y Mutuales del Creador (cada 8h)...');

    // Primera verificación tras 3 minutos de encendido del bot
    setTimeout(() => {
        runOwnerFriendsCheck(client).catch(err => {
            Logger.system(`[FRIENDS-TRACKER] Error en la verificación inicial: ${err.message}`);
        });
    }, 3 * 60 * 1000);

    // Intervalo recurrente de 8 horas
    setInterval(() => {
        runOwnerFriendsCheck(client).catch(err => {
            Logger.system(`[FRIENDS-TRACKER] Error en la verificación periódica de 8h: ${err.message}`);
        });
    }, CHECK_INTERVAL);
}

module.exports = {
    initOwnerFriendsTracker,
    runOwnerFriendsCheck
};
