const Logger = require("../utils/logger.js");
const BotSettingsModel = require("../models/BotSettingsModel.js");

let discordClient = null;
let supabase = null;

const SYNC_SETTING_KEY = "last_guilds_sync_time";
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 horas

/**
 * Sincroniza los servidores (guilds) en los que se encuentra un usuario específico.
 * @param {string} discordId
 */
async function syncUserGuilds(discordId) {
    if (!discordClient || !supabase) return;

    try {
        // 1. Obtener el registro del usuario de Supabase
        const { data: user, error } = await supabase
            .from('users')
            .select('discord_id, guilds')
            .eq('discord_id', discordId)
            .maybeSingle();

        if (error) throw error;
        if (!user) return; // Si no está vinculado, no hacemos nada

        // 2. Determinar en qué servidores activos del bot está presente este usuario
        const currentGuilds = [];
        for (const [guildId, guild] of discordClient.guilds.cache) {
            let isMember = guild.members.cache.has(discordId);
            if (!isMember) {
                try {
                    const member = await guild.members.fetch(discordId);
                    if (member) isMember = true;
                } catch {
                    // No está en este servidor
                }
            }
            if (isMember) {
                currentGuilds.push(guildId);
            }
        }

        // 3. Actualizar la base de datos
        const { error: updateError } = await supabase
            .from('users')
            .update({ guilds: currentGuilds })
            .eq('discord_id', discordId);

        if (updateError) throw updateError;

        Logger.system(`[guildsSync] Servidores sincronizados para usuario ${discordId}: [${currentGuilds.join(', ')}]`);
    } catch (err) {
        console.error(`[guildsSync] Error al sincronizar servidores para el usuario ${discordId}:`, err);
    }
}

/**
 * Realiza una sincronización completa para todos los usuarios vinculados si ha pasado suficiente tiempo.
 * @param {boolean} force - Si es true, ignora el tiempo transcurrido y sincroniza de inmediato.
 */
async function syncAllGuilds(force = false) {
    if (!discordClient || !supabase) return;

    try {
        if (!force) {
            const lastSyncStr = await BotSettingsModel.getSetting(SYNC_SETTING_KEY);
            if (lastSyncStr) {
                const lastSync = new Date(lastSyncStr);
                const timePassed = Date.now() - lastSync.getTime();
                if (timePassed < SYNC_INTERVAL_MS) {
                    const minutesPassed = Math.round(timePassed / 1000 / 60);
                    Logger.system(`[guildsSync] Sincronización completa omitida. Última realizada hace ${minutesPassed} minutos.`);
                    return;
                }
            }
        }

        Logger.system("[guildsSync] Iniciando sincronización completa de servidores para todos los usuarios vinculados...");

        // 1. Obtener todos los usuarios vinculados de Supabase
        const { data: allUsers, error } = await supabase
            .from('users')
            .select('discord_id, guilds')
            .not('osu_id', 'is', null);

        if (error) throw error;
        if (!allUsers || allUsers.length === 0) return;

        Logger.system(`[guildsSync] Procesando ${allUsers.length} usuarios vinculados...`);

        // 2. Construir mapa de membresía para todos los servidores
        const discordIds = allUsers.map(u => u.discord_id);
        const userGuildsMap = {};
        for (const id of discordIds) {
            userGuildsMap[id] = new Set();
        }

        for (const [guildId, guild] of discordClient.guilds.cache) {
            const presentInGuild = new Set();
            const chunkSize = 100;
            for (let i = 0; i < discordIds.length; i += chunkSize) {
                const chunk = discordIds.slice(i, i + chunkSize);
                try {
                    const fetched = await guild.members.fetch({ user: chunk }).catch(async () => {
                        const map = new Map();
                        for (const id of chunk) {
                            try {
                                const member = await guild.members.fetch(id);
                                if (member) map.set(id, member);
                            } catch {}
                        }
                        return map;
                    });
                    for (const id of fetched.keys()) {
                        presentInGuild.add(id);
                    }
                } catch (err) {
                    console.error(`[guildsSync] Error al verificar lote en guild ${guild.name} (${guildId}):`, err);
                }
            }

            for (const id of presentInGuild) {
                if (userGuildsMap[id]) {
                    userGuildsMap[id].add(guildId);
                }
            }
        }

        // 3. Actualizar base de datos de aquellos que difieran
        let updatedCount = 0;
        for (const user of allUsers) {
            const currentSet = userGuildsMap[user.discord_id] || new Set();
            const currentArray = Array.from(currentSet);

            const dbArray = user.guilds || [];
            const isSame = dbArray.length === currentArray.length && 
                           dbArray.every(g => currentArray.includes(g));

            if (!isSame) {
                try {
                    const { error: updateError } = await supabase
                        .from('users')
                        .update({ guilds: currentArray })
                        .eq('discord_id', user.discord_id);
                    if (updateError) throw updateError;
                    updatedCount++;
                } catch (e) {
                    console.error(`[guildsSync] Error al actualizar guilds para ${user.discord_id}:`, e);
                }
            }
        }

        // Guardar la marca de tiempo de sincronización exitosa de forma persistente
        await BotSettingsModel.setSetting(SYNC_SETTING_KEY, new Date().toISOString());
        Logger.system(`[guildsSync] Sincronización completa terminada. Se actualizaron ${updatedCount} usuarios.`);
    } catch (err) {
        console.error('[guildsSync] Error en la sincronización completa:', err);
    }
}

/**
 * Inicializa el servicio de sincronización de servidores y eventos en tiempo real.
 */
function initGuildsSync(client, supabaseClient) {
    discordClient = client;
    supabase = supabaseClient;

    Logger.system("[guildsSync] Sincronización completa persistente y asíncrona iniciada.");

    // Evento: Miembro se une a un servidor
    client.on('guildMemberAdd', async (member) => {
        try {
            const { data: user, error } = await supabase
                .from('users')
                .select('discord_id, guilds')
                .eq('discord_id', member.id)
                .maybeSingle();

            if (error) throw error;
            if (user) {
                let currentGuilds = user.guilds || [];
                if (!currentGuilds.includes(member.guild.id)) {
                    currentGuilds.push(member.guild.id);
                    await supabase
                        .from('users')
                        .update({ guilds: currentGuilds })
                        .eq('discord_id', member.id);
                    Logger.system(`[guildsSync] Agregado servidor ${member.guild.name} a usuario vinculado ${member.id}`);
                }
            }
        } catch (err) {
            console.error(`[guildsSync] Error en guildMemberAdd para ${member.id}:`, err);
        }
    });

    // Evento: Miembro sale de un servidor
    client.on('guildMemberRemove', async (member) => {
        try {
            const { data: user, error } = await supabase
                .from('users')
                .select('discord_id, guilds')
                .eq('discord_id', member.id)
                .maybeSingle();

            if (error) throw error;
            if (user && user.guilds && user.guilds.includes(member.guild.id)) {
                let currentGuilds = user.guilds.filter(id => id !== member.guild.id);
                await supabase
                    .from('users')
                    .update({ guilds: currentGuilds })
                    .eq('discord_id', member.id);
                Logger.system(`[guildsSync] Removido servidor ${member.guild.name} de usuario vinculado ${member.id}`);
            }
        } catch (err) {
            console.error(`[guildsSync] Error en guildMemberRemove para ${member.id}:`, err);
        }
    });

    // Programar comprobación inicial asíncrona a los 15 segundos del encendido
    setTimeout(() => {
        syncAllGuilds(false).catch(err => {
            console.error('[guildsSync] Error en syncAllGuilds al arranque:', err);
        });
    }, 15000);

    // Comprobar cada hora si corresponde hacer la sincronización completa (según la marca persistente de la DB)
    setInterval(() => {
        syncAllGuilds(false).catch(err => {
            console.error('[guildsSync] Error en syncAllGuilds periódico:', err);
        });
    }, 60 * 60 * 1000); // Cada 1 hora
}

module.exports = {
    initGuildsSync,
    syncUserGuilds,
    syncAllGuilds
};
