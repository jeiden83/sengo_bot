const { chatCommand, slashCommand, loadCommands, loadSlashCommands } = require("../commands/handler.js");
const { PermissionsBitField } = require('discord.js');
const { reportErrorToWebhook } = require("../services/errorNotifier.js");
const { getGuildLanguage } = require("../models/GuildConfigModel.js");

const Logger = require("../utils/logger.js");

const MAX_MESSAGE_LENGTH = 2000;

function getFriendlyErrorMessage(error) {
    const errorStr = (error.message || String(error)).toLowerCase();
    const status = error.status || error.statusCode || error.response?.status || error.response?.statusCode;

    const is522 = status === 522 || errorStr.includes('522') || errorStr.includes('cloudflare');
    const is5xx = (status >= 500 && status < 600) || errorStr.includes('502') || errorStr.includes('503') || errorStr.includes('504') || errorStr.includes('500') || errorStr.includes('bad gateway') || errorStr.includes('service unavailable') || errorStr.includes('gateway timeout');
    const isTimeoutOrConn = errorStr.includes('timeout') || 
                            errorStr.includes('etimedout') || 
                            errorStr.includes('econnreset') || 
                            errorStr.includes('econnrefused') || 
                            errorStr.includes('socket hang up') || 
                            errorStr.includes('fetch failed') ||
                            errorStr.includes('network error');

    if (is522) {
        return `⚠️ **Error de Conexión (Cloudflare/API de osu!)**: Parece que los servidores de osu! o los servicios de Cloudflare están experimentando problemas (Error 522 - Conexión agotada). Por favor, intenta de nuevo en unos minutos.`;
    }
    if (is5xx) {
        const errorDetail = status ? ` (Error ${status})` : '';
        return `⚠️ **Servidores de osu! caídos o inestables**: Los servidores de la API de osu! o Bancho no están respondiendo correctamente${errorDetail}. Por favor, intenta de nuevo en unos minutos.`;
    }
    if (isTimeoutOrConn) {
        return `⚠️ **Tiempo de espera agotado**: Hubo problemas de conexión al intentar comunicarse con la API de osu! o los servidores del mirror. Intenta de nuevo más tarde.`;
    }
    return null;
}

const userGuildCache = new Set(); // Guarda "userId:guildId"

async function trackUserGuild(userId, guildId, res) {
    if (!userId || !guildId || !res?.supabaseClient) return;

    const cacheKey = `${userId}:${guildId}`;
    if (userGuildCache.has(cacheKey)) return;

    userGuildCache.add(cacheKey);

    try {
        const supabase = res.supabaseClient;

        // 1. Obtener registro del usuario para ver si está vinculado
        const { data: user, error: fetchError } = await supabase
            .from('users')
            .select('guilds')
            .eq('discord_id', userId)
            .maybeSingle();

        if (fetchError || !user) {
            return;
        }

        let guilds = user.guilds || [];
        if (!guilds.includes(guildId)) {
            guilds.push(guildId);
            await supabase
                .from('users')
                .update({ guilds })
                .eq('discord_id', userId);
        }
    } catch (err) {
        console.error('[TRACKER] Error al registrar guild de usuario:', err);
    }
}

const latencyCache = new Map();

function setLatencyCache(messageId, latencyText) {
    if (!messageId) return;
    if (latencyCache.size > 1000) {
        const firstKey = latencyCache.keys().next().value;
        latencyCache.delete(firstKey);
    }
    latencyCache.set(messageId, latencyText);
}

function injectLatencyToEmbeds(options, timeOrText, isDirectText = false) {
    if (!options || typeof options !== 'object') return options;

    let latencyText;
    if (isDirectText) {
        latencyText = timeOrText;
    } else {
        const duration = Date.now() - timeOrText;
        latencyText = `Latencia: ${duration}ms`;
    }

    const getCleanFooterText = (originalText) => {
        if (!originalText) return latencyText;
        const cleanText = originalText.replace(/\s*•?\s*Latencia:\s*\d+ms/gi, '').trim();
        return cleanText ? `${cleanText} • ${latencyText}` : latencyText;
    };

    // Si es un EmbedBuilder
    if (options.setFooter && typeof options.setFooter === 'function') {
        options.setFooter({ text: getCleanFooterText(options.data?.footer?.text), iconURL: options.data?.footer?.icon_url });
        return options;
    }

    // Si es un array de embeds o similar
    if (Array.isArray(options)) {
        return options.map(item => {
            if (!item) return item;
            if (typeof item.setFooter === 'function') {
                item.setFooter({ text: getCleanFooterText(item.data?.footer?.text), iconURL: item.data?.footer?.icon_url });
            } else if (typeof item === 'object') {
                item.footer = { text: getCleanFooterText(item.footer?.text), icon_url: item.footer?.icon_url };
            }
            return item;
        });
    }

    // Si tiene la propiedad embeds
    if (options.embeds && Array.isArray(options.embeds)) {
        options.embeds = options.embeds.map(embed => {
            if (!embed) return embed;
            if (typeof embed.setFooter === 'function') {
                embed.setFooter({ text: getCleanFooterText(embed.data?.footer?.text), iconURL: embed.data?.footer?.icon_url });
            } else if (typeof embed === 'object') {
                embed.footer = { text: getCleanFooterText(embed.footer?.text), icon_url: embed.footer?.icon_url };
            }
            return embed;
        });
    }
    return options;
}

//---

async function chat_command_listener(chat_commands, client, config, res) {
    
    const chatMessageListener = async (message) => {
        if (message.author.bot) {
            // No responder ni procesar mensajes de otros bots
            if (message.content.toLowerCase().startsWith(config.BOT_PREFIX)) {
                await message.channel.send("No me uses con un Bot. Te lo agradezco");
            }
            return;
        }

        if (!message.content.toLowerCase().startsWith(config.BOT_PREFIX)) {
            // Detección pasiva de enlaces de osu! para precarga
            const containsOsuLink = /osu\.ppy\.sh\/b(?:eatmaps)?\/(\d+)/i.test(message.content) || /#(?:osu|taiko|fruits|mania)\/(\d+)/i.test(message.content);
            if (containsOsuLink) {
                try {
                    const { handlePredictivePreload } = require("../commands/utils/osu.js");
                    const regex = /#(?:osu|taiko|fruits|mania)\/(\d+)|osu\.ppy\.sh\/b(?:eatmaps)?\/(\d+)/gi;
                    let match;
                    while ((match = regex.exec(message.content)) !== null) {
                        const id = match[1] || match[2];
                        if (id) {
                            console.log(`[PRELOAD-PASIVO] Detección de link de osu! en chat para precarga: ${id}`);
                            handlePredictivePreload(message.author.id, id, 'osu', message);
                        }
                    }
                } catch (err) {
                    console.error("[PRELOAD-PASIVO] Error en detección pasiva de links de osu!:", err);
                }
            }
            return;
        } 

        if (message.guild) {
            trackUserGuild(message.author.id, message.guild.id, res);
            const botMember = message.guild.members.cache.get(client.user.id);
            const botPermissions = message.channel.permissionsFor(botMember);
            if (!botPermissions || !botPermissions.has(PermissionsBitField.Flags.SendMessages)) {
                console.error("El bot no tiene permisos para enviar mensajes en este canal.");
                return;
            }
        }

        let resolvedLocale = 'es';
        if (message.guild) {
            resolvedLocale = await getGuildLanguage(message.guild.id);
        }
        message.locale = resolvedLocale;

        await message.channel.sendTyping();

        const message_args = message.content.slice(config.BOT_PREFIX.length).trim().split(/ +/);
        const message_command = message_args.shift().toLowerCase();
        
        const logger = new Logger(message, message_command, message_args);
        const startTime = logger.startTime;
        let cachedLatencyText = null;

        const originalSend = message.channel.send;
        const originalReply = message.reply;

        // Crear proxy basado en prototipo para message.channel para evitar mutar el canal global compartido
        const originalChannel = message.channel;
        const customChannel = Object.create(originalChannel);
        customChannel.send = async (options) => {
            if (!cachedLatencyText) {
                const duration = Date.now() - startTime;
                cachedLatencyText = `Latencia: ${duration}ms`;
            }
            const result = await originalSend.call(originalChannel, injectLatencyToEmbeds(options, cachedLatencyText, true));
            if (result && result.id) {
                setLatencyCache(result.id, cachedLatencyText);
            }
            return result;
        };

        Object.defineProperty(message, 'channel', {
            get: () => customChannel,
            configurable: true
        });

        // Envolver message.reply (es seguro mutarlo directamente porque message es una instancia única por comando)
        message.reply = async (options) => {
            if (!cachedLatencyText) {
                const duration = Date.now() - startTime;
                cachedLatencyText = `Latencia: ${duration}ms`;
            }
            const result = await originalReply.call(message, injectLatencyToEmbeds(options, cachedLatencyText, true));
            if (result && result.id) {
                setLatencyCache(result.id, cachedLatencyText);
            }
            return result;
        };

        let message_reply = null;
        if (message.reference) {
            try {
                const fetchedReply = await message.channel.messages.fetch(message.reference.messageId);
                if (fetchedReply) {
                    // Crear proxy basado en prototipo para el mensaje referenciado para evitar contaminar la cache
                    message_reply = Object.create(fetchedReply);
                    message_reply.reply = async (options) => {
                        if (!cachedLatencyText) {
                            const duration = Date.now() - startTime;
                            cachedLatencyText = `Latencia: ${duration}ms`;
                        }
                        const result = await fetchedReply.reply(injectLatencyToEmbeds(options, cachedLatencyText, true));
                        if (result && result.id) {
                            setLatencyCache(result.id, cachedLatencyText);
                        }
                        return result;
                    };
                }
            } catch (err) {
                console.warn("[LISTENER] No se pudo obtener el mensaje referenciado:", err.message);
            }
        }

        // Precarga predictiva en segundo plano según la actividad del usuario
        const OSU_COMMANDS = new Set([
            'rs', 'recent', 'c', 'compare', 'lb', 'leaderboard', 
            'm', 'map', 'subir', 'gap', 'bg', 'top', 't'
        ]);
        if (OSU_COMMANDS.has(message_command)) {
            try {
                const { handlePredictivePreload, findBeatmapInChannel } = require("../commands/utils/osu.js");
                
                // Primero disparamos la precarga del usuario y sus top scores predictivos
                handlePredictivePreload(message.author.id, null, 'osu', message);
                
                const isReply = !!message.reference;
                const targetMessage = message_reply || message;
                findBeatmapInChannel(targetMessage, isReply)
                    .then(result => {
                        if (result && result.beatmap_url) {
                            // Si se encuentra un mapa, lo añadimos a la sesión predictiva para precargar su metadata y gap
                            handlePredictivePreload(message.author.id, result.beatmap_url, 'osu', message);
                        }
                    })
                    .catch(() => {});
            } catch (err) {
                console.error("[PRELOAD] Error al disparar el flujo predictivo de precarga:", err);
            }
        }

        try {
            const command_result = await chatCommand(
                chat_commands, 
                {
                    'command' : message_command,
                    'args' : message_args,
                    'message' : message, 
                    'res': res,
                    'reply' : message_reply,
                    'logger': logger
                }
            );

            if (!command_result) return;
            
            // Comprobar la longitud del mensaje y enviar un error si es muy largo
            if (command_result.length > MAX_MESSAGE_LENGTH) {
                await message.channel.send(`❌ El resultado es demasiado largo para ser enviado. (Más de ${MAX_MESSAGE_LENGTH} caracteres)`);
                logger.failed("El resultado superó los 2000 caracteres.");
                return;
            }

            // Enviar el mensaje si no supera el límite
            await message.channel.send(command_result);

        } catch (error) {
            logger.failed(error.message);
            console.error("Error ejecutando el comando:", error);
            const friendlyMsg = getFriendlyErrorMessage(error);
            if (friendlyMsg) {
                await message.channel.send(friendlyMsg);
            } else {
                const ownerMention = process.env.OWNER_ID ? `<@${process.env.OWNER_ID}>` : "el creador";
                await message.channel.send(`Hubo un error al ejecutar el comando. Ahora ${ownerMention} lo sabrá.`);
            }
            
            // Notificar al Webhook de errores de forma asíncrona
            reportErrorToWebhook(error, {
                commandName: message_command,
                args: message_args,
                user: message.author,
                guild: message.guild,
                channel: message.channel,
                message: message
            });
        }
    };

    client.on("messageCreate", chatMessageListener);

    return client;
}

//---

async function slash_command_listener(chat_commands, slash_commands, client, res) {
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isCommand()) return;

        const message_command = interaction.commandName;
        const args = [];
        interaction.options.data.forEach(opt => {
            if (opt.value !== undefined) {
                args.push(`${opt.name}:${opt.value}`);
            }
        });

        let resolvedLocale = interaction.locale;
        if (resolvedLocale) {
            resolvedLocale = resolvedLocale.split('-')[0].toLowerCase();
        }
        if (resolvedLocale !== 'es' && resolvedLocale !== 'en') {
            resolvedLocale = null;
        }
        if (!resolvedLocale && interaction.guild) {
            resolvedLocale = await getGuildLanguage(interaction.guild.id);
        }
        if (!resolvedLocale) {
            resolvedLocale = 'es';
        }
        interaction.resolvedLocale = resolvedLocale;

        const simulatedMessage = {
            author: interaction.user,
            guild: interaction.guild,
            locale: resolvedLocale
        };

        if (interaction.guild) {
            trackUserGuild(interaction.user.id, interaction.guild.id, res);
        }

        const logger = new Logger(simulatedMessage, message_command, args);
        interaction.logger = logger;

        const startTime = logger.startTime;
        let cachedLatencyText = null;

        // Wrap interaction.reply
        const originalIReply = interaction.reply.bind(interaction);
        interaction.reply = async (options) => {
            if (!cachedLatencyText) {
                const duration = Date.now() - startTime;
                cachedLatencyText = `Latencia: ${duration}ms`;
            }
            const result = await originalIReply(injectLatencyToEmbeds(options, cachedLatencyText, true));
            try {
                const msg = await interaction.fetchReply();
                if (msg && msg.id) {
                    setLatencyCache(msg.id, cachedLatencyText);
                }
            } catch {}
            return result;
        };

        // Wrap interaction.editReply
        const originalIEditReply = interaction.editReply.bind(interaction);
        interaction.editReply = async (options) => {
            if (!cachedLatencyText) {
                const duration = Date.now() - startTime;
                cachedLatencyText = `Latencia: ${duration}ms`;
            }
            const result = await originalIEditReply(injectLatencyToEmbeds(options, cachedLatencyText, true));
            if (result && result.id) {
                setLatencyCache(result.id, cachedLatencyText);
            }
            return result;
        };

        // Wrap interaction.followUp
        const originalIFollowUp = interaction.followUp.bind(interaction);
        interaction.followUp = async (options) => {
            if (!cachedLatencyText) {
                const duration = Date.now() - startTime;
                cachedLatencyText = `Latencia: ${duration}ms`;
            }
            const result = await originalIFollowUp(injectLatencyToEmbeds(options, cachedLatencyText, true));
            if (result && result.id) {
                setLatencyCache(result.id, cachedLatencyText);
            }
            return result;
        };

        try {
            logger.trigger(`Ejecutando /${message_command}`);
            // Precarga en segundo plano de perfiles de osu! al detectar actividad en comandos slash
            const OSU_COMMANDS = new Set([
                'rs', 'recent', 'c', 'compare', 'lb', 'leaderboard', 
                'm', 'map', 'subir', 'gap', 'bg', 'top', 't'
            ]);
            if (OSU_COMMANDS.has(message_command)) {
                try {
                    const { triggerBackgroundOsuPreload } = require("../commands/utils/osu.js");
                    triggerBackgroundOsuPreload(interaction.user.id, null, null);
                } catch (err) {
                    console.error("[PRELOAD] Error al disparar la precarga en segundo plano para slash:", err);
                }
            }

            // Para avisar que se mandara un slash
            await interaction.deferReply();

            const slash_result = await slashCommand(chat_commands, slash_commands, interaction, res);

            if (slash_result === true) {
                logger.success(`/${message_command} completado con éxito.`);
                return;
            }

            if (!slash_result) {
                await interaction.editReply("El comando no devolvió ningún resultado.");
                logger.failed("El comando no devolvió ningún resultado.");
                return;
            }

            // Comprobar la longitud del resultado del slash si es un string y enviar un error si es muy largo
            if (typeof slash_result === 'string' && slash_result.length > MAX_MESSAGE_LENGTH) {
                await interaction.editReply(`❌ El resultado es demasiado largo para ser enviado. (Más de ${MAX_MESSAGE_LENGTH} caracteres)`);
                logger.failed("El resultado superó los 2000 caracteres.");
                return;
            }

            await interaction.editReply(slash_result);
            logger.success(`/${message_command} completado con éxito.`);

        } catch (error) {
            logger.failed(error.message);
            console.error("Error ejecutando el comando:", error);
            const friendlyMsg = getFriendlyErrorMessage(error);
            const ownerMention = process.env.OWNER_ID ? `<@${process.env.OWNER_ID}>` : "el creador";
            await interaction.editReply(
                friendlyMsg || `Hubo un error al ejecutar el comando. Ahora ${ownerMention} lo sabrá.`
            );
            
            // Notificar al Webhook de errores de forma asíncrona
            reportErrorToWebhook(error, {
                commandName: message_command,
                args,
                user: interaction.user,
                guild: interaction.guild,
                channel: interaction.channel,
                interaction: interaction
            });
        }
    });
}

//---

async function load_listeners(res, client, config){
    client.removeAllListeners();

    const chat_commands = await loadCommands();
    const slash_commands = await loadSlashCommands(chat_commands, config);

    slash_command_listener(chat_commands, slash_commands, client, res); 
    chat_command_listener(chat_commands, client, config, res);

    // Intercept component interactions (buttons, select menus) to inject the cached latency
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isMessageComponent()) return;

        const messageId = interaction.message.id;
        const cachedLatency = latencyCache.get(messageId);
        if (cachedLatency) {
            // Wrap interaction.update
            const originalUpdate = interaction.update.bind(interaction);
            interaction.update = (options) => {
                return originalUpdate(injectLatencyToEmbeds(options, cachedLatency, true));
            };

            // Wrap interaction.editReply
            const originalEditReply = interaction.editReply.bind(interaction);
            interaction.editReply = (options) => {
                return originalEditReply(injectLatencyToEmbeds(options, cachedLatency, true));
            };
        }
    });
}

module.exports = { load_listeners };