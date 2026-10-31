const { ActivityType, Events } = require('discord.js');
const Logger = require("../utils/logger.js");

function setBotPresence(client) {
    if (!client || !client.user) return;
    try {
        const { version } = require('../package.json');
        const activityText = `v${version} - Activo`;
        client.user.setActivity(activityText, { type: ActivityType.Playing });
    } catch (e) {
        Logger.system(`Error al establecer presencia del bot: ${e.message}`);
    }
}

const LOGIN_TIMEOUT_MS = 20000;

async function login(client, config) {
    Logger.system("Intentando iniciar sesión en Discord...");
    
    // Registrar listeners de estado y eventos de red por cada instancia del cliente Discord
    if (!client._listenersRegistered) {
        client._listenersRegistered = true;

        client.on(Events.Error, (err) => {
            Logger.system(`[Discord Error] ${err.message}`);
        });

        client.on(Events.ShardError, (err, shardId) => {
            Logger.system(`[Discord Shard Error #${shardId}] ${err.message}`);
        });

        client.on(Events.ShardDisconnect, (event, shardId) => {
            Logger.system(`[Discord Shard Desconectado #${shardId}] Código de cierre: ${event.code}`);
        });

        client.on(Events.ShardReconnecting, (shardId) => {
            Logger.system(`[Discord Shard Reconectando #${shardId}]...`);
        });

        client.on(Events.ShardResume, (shardId) => {
            setBotPresence(client);
            Logger.system(`[Discord Shard #${shardId}] Sesión reanudada.`);
        });

        client.on(Events.Warn, (info) => {
            Logger.system(`[Discord Warn] ${info}`);
        });

        // Registrar eventos de REST para diagnosticar rate-limits o bloqueos de Cloudflare/Discord
        if (client.rest) {
            client.rest.on('rateLimited', (info) => {
                const routeName = info.route || info.url || 'Ruta desconocida';
                Logger.system(`[Discord REST RateLimit] Ruta: ${routeName} | Espera: ${info.timeToReset}ms | Global: ${info.global}`);
                if (info.global || info.timeToReset > 10000) {
                    try {
                        const { notifyExternalServiceIssue } = require('../services/errorNotifier.js');
                        notifyExternalServiceIssue(
                            'Discord REST API',
                            `Rate-limit impuesto por Discord/Cloudflare (${info.global ? 'Límite Global' : routeName}). Peticiones pausadas por ${Math.round(info.timeToReset / 1000)}s.`
                        );
                    } catch {}
                }
            });

            client.rest.on('invalidRequestWarning', (info) => {
                Logger.system(`[Discord REST Advertencia] Solicitudes inválidas consecutivas: ${info.count} (Tiempo restante: ${info.remainingTime}ms)`);
            });

            client.rest.on('restDebug', (info) => {
                if (typeof info === 'string' && info.includes('429')) {
                    const retryMatch = info.match(/Retry After\s*:\s*(\d+)ms/i);
                    const urlMatch = info.match(/URL\s*:\s*([^\n\r]+)/i);
                    const retrySec = retryMatch ? Math.round(Number(retryMatch[1]) / 1000) : null;
                    const targetUrl = urlMatch ? urlMatch[1].trim() : 'API de Discord';
                    Logger.system(`[Discord REST 429] Bloqueo 429 detectado en ${targetUrl}${retrySec !== null ? ` | Retry-After: ${retrySec}s` : ''}`);
                    try {
                        const { notifyExternalServiceIssue } = require('../services/errorNotifier.js');
                        notifyExternalServiceIssue(
                            'Discord / Cloudflare 429 (IP Compartida Render)',
                            `Discord o Cloudflare aplicaron un HTTP 429 sobre la IP compartida de Render en ${targetUrl}.${retrySec !== null ? ` Tiempo de espera exigido: ${retrySec}s (~${(retrySec / 60).toFixed(1)} min).` : ''}`
                        );
                    } catch {}
                }
            });
        }

        if (process.env.DEBUG === 'true') {
            client.on(Events.Debug, (info) => {
                // Ocultar heartbeats rutinarios de discord para evitar spam en los logs
                if (info.toLowerCase().includes('heartbeat')) return;
                Logger.system(`[Discord WS] ${info}`);
            });
        }

        client.on(Events.ClientReady, (c) => {
            setBotPresence(c);
            Logger.system(`Sengo iniciado y listo en Discord como ${c.user.tag}`);
            
            // Inicializar gestor de sorteos
            try {
                const { initGiveawayManager } = require('../models/GiveawayModel.js');
                initGiveawayManager(c);
                Logger.system("Gestor de sorteos (Giveaways) inicializado con éxito.");
            } catch (err) {
                Logger.system(`Error al inicializar gestor de sorteos: ${err.message}`);
            }
        });
    }

    try {
        if (!config.TOKEN) {
            throw new Error("El token de Discord no está configurado (TOKEN es undefined o nulo)");
        }
        Logger.system(`Ejecutando client.login con token prefijo: ${config.TOKEN.substring(0, 10)}...`);
        
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error("Tiempo de espera agotado (20s) al conectar con el Gateway/API de Discord. Posible rate-limit o bloqueo de IP."));
            }, LOGIN_TIMEOUT_MS);
        });

        const loginResult = await Promise.race([
            client.login(config.TOKEN),
            timeoutPromise
        ]).finally(() => {
            if (timeoutId) clearTimeout(timeoutId);
        });

        Logger.system(`client.login completado. Resultado de la conexión: ${loginResult ? "Conexión exitosa" : "Sin resultado"}`);
        setBotPresence(client);
    } catch (err) {
        Logger.system(`Error al iniciar sesión en Discord: ${err.message}`);
        throw err;
    }
}

module.exports = { login, setBotPresence };
