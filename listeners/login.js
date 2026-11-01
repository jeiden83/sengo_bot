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

const LOGIN_TIMEOUT_MS = 60000;

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
                if (info.timeToReset && typeof client._extendLoginTimeout === 'function') {
                    client._hadRateLimitOnLogin = true;
                    client._extendLoginTimeout(Number(info.timeToReset) + 60000);
                }
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
                    const retryMs = retryMatch ? Number(retryMatch[1]) : null;
                    const retrySec = retryMs !== null ? Math.round(retryMs / 1000) : null;
                    const targetUrl = urlMatch ? urlMatch[1].trim() : 'API de Discord';
                    Logger.system(`[Discord REST 429] Bloqueo 429 detectado en ${targetUrl}${retrySec !== null ? ` | Retry-After: ${retrySec}s (~${(retrySec / 60).toFixed(1)} min)` : ''}`);
                    if (retryMs && typeof client._extendLoginTimeout === 'function') {
                        client._hadRateLimitOnLogin = true;
                        client._extendLoginTimeout(retryMs + 60000);
                    }
                    try {
                        const { notifyExternalServiceIssue } = require('../services/errorNotifier.js');
                        notifyExternalServiceIssue(
                            'Discord / Cloudflare 429 (IP Compartida Render)',
                            `Discord o Cloudflare aplicaron un HTTP 429 sobre la IP compartida de Render en ${targetUrl}.${retrySec !== null ? ` Tiempo de espera exigido: ${retrySec}s (~${(retrySec / 60).toFixed(1)} min). El bot pausará los intentos hasta que expire.` : ''}`
                        );
                    } catch {}
                }
            });
        }

        client.on(Events.Debug, (info) => {
            if (typeof info !== 'string') return;
            if (info.toLowerCase().includes('heartbeat')) return;
            const isCriticalLoginStep = !client.isReady() && (
                info.includes('Fetched Gateway Information') ||
                info.includes('Session Limit Information') ||
                info.includes('Connecting to') ||
                info.includes('Identifying') ||
                info.includes('429')
            );
            if (process.env.DEBUG === 'true' || isCriticalLoginStep) {
                Logger.system(`[Discord WS] ${info.replace(/\n+/g, ' | ')}`);
            }
        });

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
        let rejectTimeout;
        const setLoginTimer = (ms) => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                if (rejectTimeout) {
                    rejectTimeout(new Error(`Tiempo de espera agotado (${Math.round(ms / 1000)}s) al conectar con el Gateway/API de Discord. Posible rate-limit o bloqueo de IP.`));
                }
            }, ms);
        };

        // ponytail: extender el timeout dinámicamente cuando Discord/Cloudflare devuelve Retry-After (429) para no abortar el sleep interno ni reiniciar el baneo
        client._extendLoginTimeout = (newMs) => {
            Logger.system(`[Discord Login] Respetando Retry-After de Discord/Cloudflare: esperando ${Math.round(newMs / 1000)}s (~${(newMs / 60000).toFixed(1)} min) sin enviar nuevas peticiones para no extender el bloqueo.`);
            setLoginTimer(newMs);
        };

        const timeoutPromise = new Promise((_, reject) => {
            rejectTimeout = reject;
            setLoginTimer(LOGIN_TIMEOUT_MS);
        });

        const loginResult = await Promise.race([
            client.login(config.TOKEN),
            timeoutPromise
        ]).finally(() => {
            if (timeoutId) clearTimeout(timeoutId);
            delete client._extendLoginTimeout;
        });

        Logger.system(`client.login completado. Resultado de la conexión: ${loginResult ? "Conexión exitosa" : "Sin resultado"}`);
        setBotPresence(client);
    } catch (err) {
        Logger.system(`Error al iniciar sesión en Discord: ${err.message}`);
        throw err;
    }
}

module.exports = { login, setBotPresence };
