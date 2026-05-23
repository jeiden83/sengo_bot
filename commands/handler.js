const { SlashCommandBuilder, REST, Routes, Collection, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const fs = require('fs');
const path = require('path');

// Maneja el fallo de verificación de OAuth enviando un DM instructivo con un botón de enlace directo
async function handleOAuthFailure(author, logger) {
    if (logger) logger.failed("OAuth requerido.");
    try {
        const { getRedirectUri, getAuthUrl } = require("../utils/osuAuth.js");
        const { doOsuOAuthEmbed } = require("../views/osuUserViews.js");
        
        const redirectUri = getRedirectUri();
        const authUrl = getAuthUrl(author.id, redirectUri);
        const embed = doOsuOAuthEmbed(authUrl);
        
        const button = new ButtonBuilder()
            .setLabel("Vincular Cuenta (OAuth)")
            .setStyle(ButtonStyle.Link)
            .setURL(authUrl);
        const row = new ActionRowBuilder().addComponents(button);
        
        await author.send({ embeds: [embed], components: [row] });
        return `❌ Para utilizar este comando, necesitas vincular tu cuenta de osu! de forma segura con OAuth. **Te he enviado un mensaje privado con el enlace de vinculación.** 🔒`;
    } catch (dmError) {
        console.error("Error al enviar DM de vinculación segura:", dmError);
        return `❌ Para utilizar este comando, necesitas vincular tu cuenta de osu! con OAuth de forma segura.\n**No he podido enviarte un mensaje privado.** Por favor, activa la opción de recibir mensajes directos en este servidor e inténtalo de nuevo con \`s.link -oauth\`.`;
    }
}

// Hacer comando de chat
async function chatCommand(intialized_data, command_data) {
	const {args, command, message, res, reply, logger} = command_data;

    const chat_commands_set = intialized_data.get('chat_commands_set');
    const chat_commands_map = intialized_data.get('chat_commands_map');

	if (chat_commands_set.has(command)) {
		const found_command = chat_commands_map.get(command);
	
		// Revisamos si hay un alias en el comando y si el comando ejecutado es un alias de ese comando
		const alias_args =
			found_command.run.alias && found_command.run.alias[command]
				? found_command.run.alias[command].args
				: null;
	
        if (logger) logger.trigger(`Ejecutando s.${command}`);

        // Verificar requerimiento de OAuth antes de ejecutar
        if (found_command.requireOAuth || (found_command.run && found_command.run.requireOAuth)) {
            const { getValidTokenForUser } = require("../utils/osuAuth.js");
            const token = await getValidTokenForUser(message.author.id);
            if (!token) {
                return await handleOAuthFailure(message.author, logger);
            }
        }

        // Detección automática de sugerencias de optimización para el usuario
        if (found_command && found_command.type === "osu") {
            try {
                const { argsParserNoCommand } = require("./utils/argsParser.js");
                const OsuUserModel = require("../models/OsuUserModel.js");
                
                const parsed_args = argsParserNoCommand(args);
                const discordId = message.author.id;
                
                let suggestion = null;
                let userToken = null;
                let user_found = null;
                const countryFilter = parsed_args.country;
                const originalArgsStr = Array.isArray(args) ? args.join(' ') : String(args);
                const argsLower = originalArgsStr.toLowerCase();

                // 1. Sugerencia de País Redundante
                if (countryFilter && countryFilter !== "SELF") {
                    userToken = await OsuUserModel.getOAuthTokenRecord(discordId);
                    if (userToken && userToken.country_code && countryFilter.toUpperCase() === userToken.country_code.toUpperCase()) {
                        suggestion = `💡 *Tip: Como tu país ya es **${userToken.country_code.toUpperCase()}**, puedes usar simplemente \`-pais\` sin especificar el código y Sengo lo autodetectará.*`;
                    }
                }

                // 2. Sugerencia de Nombre de Usuario Redundante
                if (!suggestion && parsed_args.username && parsed_args.username.length > 0 && parsed_args.username[0] !== "") {
                    const inputName = String(parsed_args.username[0]);
                    const cleanInput = inputName.replace(/<@!?(\d+)>/, '$1').toLowerCase();
                    
                    user_found = await OsuUserModel.getLinkedUser(res.User, discordId);
                    
                    let isSelf = false;
                    if (cleanInput === discordId) {
                        isSelf = true;
                    } else if (user_found && cleanInput === user_found.osu_id.toString()) {
                        isSelf = true;
                    } else {
                        if (!userToken) {
                            try {
                                userToken = await OsuUserModel.getOAuthTokenRecord(discordId);
                            } catch {}
                        }
                        if (userToken && userToken.username && cleanInput === userToken.username.toLowerCase()) {
                            isSelf = true;
                        }
                    }

                    if (isSelf) {
                        suggestion = `💡 *Tip: Como ya estás vinculado al bot, no necesitas escribir tu nombre en el comando; puedes usarlo directamente.*`;
                    }
                }

                // 3. Sugerencia de Servidor Redundante
                if (!suggestion && (argsLower.includes('-bancho') || argsLower.includes('-server bancho'))) {
                    suggestion = `💡 *Tip: El servidor por defecto es Bancho, por lo que no es necesario agregar \`-bancho\` o \`-server bancho\`.*`;
                }

                // 4. Sugerencia de Modo de Juego Redundante
                if (!suggestion && (argsLower.includes('-osu') || argsLower.includes('-std'))) {
                    if (!user_found) {
                        user_found = await OsuUserModel.getLinkedUser(res.User, discordId);
                    }
                    const currentMode = (user_found && user_found.main_gamemode) ? user_found.main_gamemode : 'osu';
                    if (currentMode === 'osu') {
                        suggestion = `💡 *Tip: Como tu modo de juego por defecto es standard, no necesitas agregar \`-osu\` o \`-std\` al comando.*`;
                    }
                }

                if (suggestion) {
                    message.optimizationSuggestion = suggestion;
                }
            } catch (err) {
                console.error("Error al procesar sugerencia de optimización:", err);
            }
        }

        // Decorador para adjuntar la sugerencia de optimización si existe
        const originalChannelSend = message.channel.send;
        const originalMessageReply = message.reply;
        
        function decorateSend(originalSend, msgObj) {
            if (!originalSend) return originalSend;
            return async function(options) {
                if (msgObj.optimizationSuggestion) {
                    const suggestion = msgObj.optimizationSuggestion;
                    delete msgObj.optimizationSuggestion;
                    
                    if (typeof options === 'string') {
                        options = options + "\n" + suggestion;
                    } else if (options && typeof options === 'object') {
                        if (options.content) {
                            options.content = options.content + "\n" + suggestion;
                        } else {
                            options.content = suggestion;
                        }
                    } else if (!options) {
                        options = { content: suggestion };
                    }
                }
                return await originalSend.apply(this, arguments);
            };
        }

        message.channel.send = decorateSend(originalChannelSend, message);
        message.reply = decorateSend(originalMessageReply, message);
        
        let originalReplyReply = null;
        if (reply) {
            originalReplyReply = reply.reply;
            reply.reply = decorateSend(originalReplyReply, message);
        }

        try {
            let result = await found_command.run(
                { message, res, reply, logger },
                [...args, alias_args],
                intialized_data
            );

            if (message.optimizationSuggestion) {
                const suggestion = message.optimizationSuggestion;
                delete message.optimizationSuggestion;
                if (typeof result === 'string') {
                    result = result + "\n" + suggestion;
                }
            }

            if (logger) {
                // Si el comando devuelve un string con advertencia/error (ej. no vinculado) lo registramos como fallo controlado
                if (typeof result === 'string' && (result.includes('❌') || result.toLowerCase().includes('error') || result.toLowerCase().includes('no vinculo') || result.toLowerCase().includes('no se encontró') || result.toLowerCase().includes('invalido'))) {
                    logger.failed(result.replace(/❌\s*/g, '').slice(0, 100));
                } else {
                    logger.success(`s.${command} completado con éxito.`);
                }
            }
            return result;
        } catch (error) {
            if (logger) logger.failed(error.message);
            throw error; // Re-lanzar para el try/catch del despachador
        } finally {
            message.channel.send = originalChannelSend;
            message.reply = originalMessageReply;
            if (reply && originalReplyReply) {
                reply.reply = originalReplyReply;
            }
        }
	}
		
	const not_found_responses = [
		"Comando invalido", 
		"No se ha encontrado el comando", 
		"No se encontro el comando. Intentalo de nuevo", 
		"No hay un comando con ese nombre, seguro que lo escribiste bien?",
		`Y ese ${command} se encuentra entre nosotros?`,
		"Eso no existe, vuelve a intentar"
	]

	return not_found_responses[Math.floor(Math.random() * not_found_responses.length)];
}
async function slashCommand(chat_commands, slash_commands, interaction, res) {
	const slash_commands_set = slash_commands.get('slash_commands_set');
	const slash_commands_map = slash_commands.get('slash_commands_map');
	const chat_commands_map = chat_commands.get('chat_commands_map');

	const { commandName } = interaction;

	if (slash_commands_set.has(commandName)) {
        const found_command = slash_commands_map.get(commandName);
        const corresponding_chat = chat_commands_map.get(commandName);
        const requiresOAuth = found_command.requireOAuth || 
                              (found_command.run && found_command.run.requireOAuth) ||
                              (corresponding_chat && (corresponding_chat.requireOAuth || (corresponding_chat.run && corresponding_chat.run.requireOAuth)));
                              
        if (requiresOAuth) {
            const { getValidTokenForUser } = require("../utils/osuAuth.js");
            const token = await getValidTokenForUser(interaction.user.id);
            if (!token) {
                const failureMsg = await handleOAuthFailure(interaction.user, interaction.logger);
                await interaction.editReply(failureMsg);
                return true;
            }
        }
		return await slash_commands_map.get(commandName).run(interaction, res, chat_commands);
    }
	
	if (chat_commands_map.has(commandName)) {
        const found_command = chat_commands_map.get(commandName);
        if (found_command.requireOAuth || (found_command.run && found_command.run.requireOAuth)) {
            const { getValidTokenForUser } = require("../utils/osuAuth.js");
            const token = await getValidTokenForUser(interaction.user.id);
            if (!token) {
                const failureMsg = await handleOAuthFailure(interaction.user, interaction.logger);
                await interaction.editReply(failureMsg);
                return true;
            }
        }
		let interactionUsed = false;
		const messages = {
			message: {
				author: interaction.user,
				member: interaction.member || (interaction.guild ? interaction.guild.members.cache.get(interaction.user.id) : null),
				guild: interaction.guild,
				channel: {
					send: async (options) => {
						if (!interaction.replied && !interaction.deferred) {
							interactionUsed = true;
							return await interaction.reply(options);
						}
						if (interaction.deferred && !interactionUsed) {
							interactionUsed = true;
							return await interaction.editReply(options);
						}
						return await interaction.channel.send(options);
					},
					sendTyping: async () => {
						try {
							await interaction.channel.sendTyping();
						} catch {}
					}
				}
			},
			res: res,
			reply: {
				reply: async (options) => {
					if (!interaction.replied && !interaction.deferred) {
						interactionUsed = true;
						return await interaction.reply(options);
					}
					if (interaction.deferred && !interactionUsed) {
						interactionUsed = true;
						return await interaction.editReply(options);
					}
					return await interaction.channel.send(options);
				}
			},
			logger: interaction.logger
		};
		// Decorar funciones de messages para sugerencias de optimización
		const originalSend = messages.message.channel.send;
		const originalReply = messages.reply.reply;
		
		function decorateSend(originalSend, msgObj) {
			if (!originalSend) return originalSend;
			return async function(options) {
				if (msgObj.optimizationSuggestion) {
					const suggestion = msgObj.optimizationSuggestion;
					delete msgObj.optimizationSuggestion;
					
					if (typeof options === 'string') {
						options = options + "\n" + suggestion;
					} else if (options && typeof options === 'object') {
						if (options.content) {
							options.content = options.content + "\n" + suggestion;
						} else {
							options.content = suggestion;
						}
					} else if (!options) {
						options = { content: suggestion };
					}
				}
				return await originalSend.apply(this, arguments);
			};
		}
		
		messages.message.channel.send = decorateSend(originalSend, messages.message);
		messages.reply.reply = decorateSend(originalReply, messages.message);

		let result = await chat_commands_map.get(commandName).run(messages, [], chat_commands);

		if (messages.message.optimizationSuggestion) {
			const suggestion = messages.message.optimizationSuggestion;
			delete messages.message.optimizationSuggestion;
			if (typeof result === 'string') {
				result = result + "\n" + suggestion;
			}
		}

		if (interactionUsed || result === undefined) {
			if (result !== undefined && result !== null) {
				await interaction.editReply(result);
			}
			return true;
		}
		return result;
	}
}
// Cargar slash commands
async function loadSlashCommands(chat_commands, config) {
    const chat_main_commands_set = chat_commands.get('chat_main_commands_set') || chat_commands.get('chat_commands_set');
    const chat_commands_map = chat_commands.get('chat_commands_map');

	const slash_commands_set = new Set();
	const slash_commands_map = new Collection();

	// Leer los slashs commands a sobreescribir
	const files = fs.readdirSync(path.join(process.cwd(), './commands/slash'));
	for (const file of files) {
		if (file.endsWith('.js')) {
			const commandName = path.basename(file, '.js');
			slash_commands_set.add(commandName);

			delete require.cache[require.resolve(`./slash/${file}`)];
			const command_module = await require(`./slash/${file}`);

			try {
				slash_commands_map.set(commandName, command_module);
			} catch (error) {
				console.error(`El comando slash ${commandName} no tiene una función 'run'.`);
			}
		}
	}

	// Listar los slashs
	const commands = Array.from(chat_main_commands_set).map(command_name => {
		if (slash_commands_map.has(command_name)) {
			const custom_command = slash_commands_map.get(command_name);
			if (custom_command.data) {
				const data = custom_command.data.setName(command_name);
				if (typeof data.setIntegrationTypes === 'function') {
					data.setIntegrationTypes([0, 1]);
				}
				if (typeof data.setContexts === 'function') {
					data.setContexts([0, 1, 2]);
				}
				return data.toJSON();
			}
		}

		let commandDescription = "No description available";
		if (slash_commands_map.has(command_name)) {
			const cmd = slash_commands_map.get(command_name);
			if (typeof cmd.description === "string") commandDescription = cmd.description;
			else if (cmd.description?.header) commandDescription = cmd.description.header;
			else if (cmd.run?.description?.header) commandDescription = cmd.run.description.header;
			else if (typeof cmd.run?.description === "string") commandDescription = cmd.run.description;
		} else if (chat_commands_map.has(command_name)) {
			const cmd = chat_commands_map.get(command_name);
			if (typeof cmd.description === "string") commandDescription = cmd.description;
			else if (cmd.description?.header) commandDescription = cmd.description.header;
			else if (cmd.run?.description?.header) commandDescription = cmd.run.description.header;
			else if (typeof cmd.run?.description === "string") commandDescription = cmd.run.description;
		}

		if (commandDescription.length > 100) {
			commandDescription = commandDescription.slice(0, 97) + "...";
		}

		const default_command = new SlashCommandBuilder()
			.setName(command_name)
			.setDescription(commandDescription);

		if (typeof default_command.setIntegrationTypes === 'function') {
			default_command.setIntegrationTypes([0, 1]);
		}
		if (typeof default_command.setContexts === 'function') {
			default_command.setContexts([0, 1, 2]);
		}

		return default_command.toJSON();
	});

	// Registrar los comandos con la API de Discord
	const rest = new REST({ version: '10' }).setToken(config.TOKEN);
	(async () => {
		try {
			await rest.put(
				Routes.applicationCommands(config.CLIENT_ID),
				{ body: commands }
			);

			console.log('# Slashs cargados a discord.');
		} catch (error) {
			console.error(error);
		}
	})();

	console.log(`# Cargados ${slash_commands_map.size} comandos slash`)
	return new Collection()
		.set('slash_commands_set', slash_commands_set)
		.set('slash_commands_map', slash_commands_map);
}

// Cargar chat commands
async function loadCommands() {
    const chat_commands_dir = path.join(process.cwd(), './commands/chat');
    const chat_commands_set = new Set();
    const chat_main_commands_set = new Set();
    const chat_commands_map = new Collection();

    function loadFromDirectory(directory, parentFolder = "") {
        const files = fs.readdirSync(directory);

        for (const file of files) {
            const filePath = path.join(directory, file);
            const stat = fs.statSync(filePath);

			// Omitir las carpetas con # adelante 
            if (stat.isDirectory() && file.startsWith("#")) {
                continue;
            }

            if (stat.isDirectory()) {

                loadFromDirectory(filePath, path.basename(filePath)); // Llamada recursiva con el nombre de la carpeta
            
			} else if (file.endsWith('.js')) {
                const commandName = path.basename(file, '.js');
                delete require.cache[require.resolve(filePath)];
                const commandModule = require(filePath);

				try {
                    commandModule.type = parentFolder || "default";

                    // Agregar el comando principal
                    chat_commands_set.add(commandName);
                    chat_main_commands_set.add(commandName);
                    chat_commands_map.set(commandName, commandModule);

                    // Si el módulo tiene alias
                    if (commandModule.run?.alias) {
                        for (const alias in commandModule.run.alias) {
                            chat_commands_set.add(alias);
                            chat_commands_map.set(alias, commandModule);
                        }
                    }
                } catch (error) {
                    console.error(`El comando ${commandName} no tiene una función 'run'.`);
                }
            }
        }
    }

    loadFromDirectory(chat_commands_dir);

    console.log(`# Cargados ${chat_commands_set.size} comandos de chat`);
    return new Collection()
        .set('chat_commands_set', chat_commands_set)
        .set('chat_main_commands_set', chat_main_commands_set)
        .set('chat_commands_map', chat_commands_map);
}


module.exports = { chatCommand, slashCommand, loadSlashCommands, loadCommands }
// por ahora los slashs estan rotos; a revisar