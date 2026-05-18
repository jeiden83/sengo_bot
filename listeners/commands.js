const { chatCommand, slashCommand, loadCommands, loadSlashCommands } = require("../commands/handler.js");
const { PermissionsBitField } = require('discord.js');

const Logger = require("../utils/logger.js");

const MAX_MESSAGE_LENGTH = 2000;

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

function injectLatencyToEmbeds(options, startTime) {
    if (!options || typeof options !== 'object') return options;

    const duration = Date.now() - startTime;
    const latencyText = `Latencia: ${duration}ms`;

    // Si es un EmbedBuilder
    if (options.setFooter && typeof options.setFooter === 'function') {
        const footerText = options.data?.footer?.text ? `${options.data.footer.text} • ${latencyText}` : latencyText;
        options.setFooter({ text: footerText, iconURL: options.data?.footer?.icon_url });
        return options;
    }

    // Si es un array de embeds o similar
    if (Array.isArray(options)) {
        return options.map(item => {
            if (!item) return item;
            if (typeof item.setFooter === 'function') {
                const footerText = item.data?.footer?.text ? `${item.data.footer.text} • ${latencyText}` : latencyText;
                item.setFooter({ text: footerText, iconURL: item.data?.footer?.icon_url });
            } else if (typeof item === 'object') {
                const footerText = item.footer?.text ? `${item.footer.text} • ${latencyText}` : latencyText;
                item.footer = { text: footerText, icon_url: item.footer?.icon_url };
            }
            return item;
        });
    }

    // Si tiene la propiedad embeds
    if (options.embeds && Array.isArray(options.embeds)) {
        options.embeds = options.embeds.map(embed => {
            if (!embed) return embed;
            if (typeof embed.setFooter === 'function') {
                const footerText = embed.data?.footer?.text ? `${embed.data.footer.text} • ${latencyText}` : latencyText;
                embed.setFooter({ text: footerText, iconURL: embed.data?.footer?.icon_url });
            } else if (typeof embed === 'object') {
                const footerText = embed.footer?.text ? `${embed.footer.text} • ${latencyText}` : latencyText;
                embed.footer = { text: footerText, icon_url: embed.footer?.icon_url };
            }
            return embed;
        });
    }
    return options;
}

//---

async function chat_command_listener(chat_commands, client, config, res) {
    
    const chatMessageListener = async (message) => {
        if (!message.content.toLowerCase().startsWith(config.BOT_PREFIX)) {
            return;
        }    

        if (message.author.bot) {
            await message.channel.send("No me uses con un Bot. Te lo agradezco");
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

        await message.channel.sendTyping();

        const message_args = message.content.slice(config.BOT_PREFIX.length).trim().split(/ +/);
        const message_command = message_args.shift().toLowerCase();
        
        const logger = new Logger(message, message_command, message_args);
        const startTime = logger.startTime;

        // Wrap message.channel.send
        const originalSend = message.channel.send.bind(message.channel);
        message.channel.send = (options) => {
            return originalSend(injectLatencyToEmbeds(options, startTime));
        };

        // Wrap message.reply
        const originalReply = message.reply.bind(message);
        message.reply = (options) => {
            return originalReply(injectLatencyToEmbeds(options, startTime));
        };

        let message_reply = null;
        if (message.reference) {
            try {
                message_reply = await message.channel.messages.fetch(message.reference.messageId);
                if (message_reply) {
                    const originalReplyReply = message_reply.reply.bind(message_reply);
                    message_reply.reply = (options) => {
                        return originalReplyReply(injectLatencyToEmbeds(options, startTime));
                    };
                }
            } catch (err) {
                console.warn("[LISTENER] No se pudo obtener el mensaje referenciado:", err.message);
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
            await message.channel.send("Hubo un error al ejecutar el comando. Ahora <@395623267530047489> lo sabrá.");
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

        const simulatedMessage = {
            author: interaction.user,
            guild: interaction.guild
        };

        if (interaction.guild) {
            trackUserGuild(interaction.user.id, interaction.guild.id, res);
        }

        const logger = new Logger(simulatedMessage, message_command, args);
        interaction.logger = logger;

        const startTime = logger.startTime;

        // Wrap interaction.reply
        const originalIReply = interaction.reply.bind(interaction);
        interaction.reply = (options) => {
            return originalIReply(injectLatencyToEmbeds(options, startTime));
        };

        // Wrap interaction.editReply
        const originalIEditReply = interaction.editReply.bind(interaction);
        interaction.editReply = (options) => {
            return originalIEditReply(injectLatencyToEmbeds(options, startTime));
        };

        // Wrap interaction.followUp
        const originalIFollowUp = interaction.followUp.bind(interaction);
        interaction.followUp = (options) => {
            return originalIFollowUp(injectLatencyToEmbeds(options, startTime));
        };

        try {
            logger.trigger(`Ejecutando /${message_command}`);
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
            await interaction.editReply(
                "Hubo un error al ejecutar el comando. Ahora <@395623267530047489> lo sabrá."
            );
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
}

module.exports = { load_listeners };