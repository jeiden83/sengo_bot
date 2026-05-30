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

// Analiza un fallo o error en la ejecución de un comando de chat para sugerir alternativas inteligentes
async function smartErrorSuggester(command, args, message, res, errorTextOrResult) {
    if (!args || args.length === 0) return null;

    // Caso 0: Sintaxis de mods inválida o incorrecta
    try {
        const { argsParserNoCommand } = require("./utils/argsParser.js");
        const parsed_args = argsParserNoCommand(args);
        if (parsed_args.invalidModsWarning) {
            return `❌ Sintaxis de mods incorrecta. Para filtrar por mods, debes usar **-mods HDDT** o **+HDDT** (ej: \`s.${command} -mods hddt\` o \`s.${command} +hddt\`).`;
        }
    } catch (err) {
        console.error("Error al verificar sintaxis de mods en smartErrorSuggester:", err);
    }

    const commandLower = command.toLowerCase();

    // Caso 0.1: El usuario busca ayuda del comando
    const hasHelpWord = args.some(arg => {
        if (typeof arg !== 'string') return false;
        const lowerArg = arg.toLowerCase().trim();
        return lowerArg === 'ayuda' || lowerArg === 'help' || lowerArg === '?';
    });
    if (hasHelpWord) {
        return `❌ ¿Habrás querido ver la ayuda de este comando? Usa **s.help ${command}** para ver todos los parámetros y opciones disponibles.`;
    }

    // Caso 0.5: Parámetros del comando ranked sin guion
    if (commandLower === 'ranked') {
        const hasServerWord = args.some(arg => {
            if (typeof arg !== 'string') return false;
            const lowerArg = arg.toLowerCase().trim();
            return lowerArg === 'server' || lowerArg === 'srv';
        });
        if (hasServerWord) {
            return `❌ **El parámetro** \`server\` debe llevar un guion: \`-server\` (ej: \`s.ranked -server\` o \`s.ranked -server ALL\`).`;
        }

        const hasTopWord = args.some(arg => {
            if (typeof arg !== 'string') return false;
            const lowerArg = arg.toLowerCase().trim();
            return lowerArg === 'top';
        });
        if (hasTopWord) {
            return `❌ **El parámetro** \`top\` debe llevar un guion: \`-top\` (ej: \`s.ranked -top\`).`;
        }

        const hasWinsWord = args.some(arg => {
            if (typeof arg !== 'string') return false;
            const lowerArg = arg.toLowerCase().trim();
            return lowerArg === 'wins';
        });
        if (hasWinsWord) {
            return `❌ **El parámetro** \`wins\` debe llevar un guion: \`-wins\` (ej: \`s.ranked -top -wins\`).`;
        }
    }

    // Caso 1 & 2: El comando es de comparación u otros que no admiten -lb o -pais
    const isCompare = ['c', 'compare', 'comparar', 'compara', 'cm', 'cc', 'ct'].includes(commandLower);
    const isOtherNonLb = ['top', 't', 'rs', 'recent', 'r', 'rm', 'rc', 'rt', 'osu', 'o', 'perfil'].includes(commandLower);

    if (isCompare || isOtherNonLb) {
        const hasLb = args.some(arg => {
            const lowerArg = arg.toLowerCase();
            return lowerArg === 'lb' || lowerArg === '-lb' || lowerArg === '--lb';
        });
        const hasPais = args.some(arg => {
            const lowerArg = arg.toLowerCase();
            return lowerArg === 'pais' || lowerArg === '-pais' || lowerArg === '--pais' ||
                   lowerArg === 'country' || lowerArg === '-country' || lowerArg === '--country';
        });

        if (hasLb || hasPais) {
            // Intentar detectar si pasaron un código de país en los argumentos
            const countryCodes = require("../src/country_codes.json");
            let countryCode = null;
            
            for (const arg of args) {
                const cleanArg = arg.toUpperCase().replace(/^-+/, '').trim();
                if (countryCodes[cleanArg]) {
                    countryCode = cleanArg;
                    break;
                }
            }

            // Si no se detectó en los argumentos, buscar el país de su vinculación OAuth
            if (!countryCode) {
                try {
                    const OsuUserModel = require("../models/OsuUserModel.js");
                    const userToken = await OsuUserModel.getOAuthTokenRecord(message.author.id);
                    if (userToken && userToken.country_code) {
                        countryCode = userToken.country_code.toUpperCase();
                    }
                } catch (err) {
                    console.error("Error al obtener token para sugerencia inteligente de país:", err);
                }
            }

            let countryName = "tu país";
            if (countryCode) {
                const countryInfo = countryCodes[countryCode];
                if (countryInfo && countryInfo.country) {
                    countryName = countryInfo.country.toUpperCase();
                }
            }

            const displayCountry = countryCode ? `${countryName} (${countryCode})` : "tu país";
            if (isCompare) {
                return `❌ **El comando** \`.c\` no tiene un parámetro \`-lb\` o \`-pais\`. ¿Habrás querido hacer \`.lb -pais\` para revisar la tabla de clasificación de **${displayCountry}**?`;
            } else {
                return `❌ **El comando** \`.${command}\` no admite parámetros de tabla de clasificación (\`-lb\` o \`-pais\`). ¿Habrás querido hacer \`.lb -pais\` para revisar la tabla de clasificación de **${displayCountry}**?`;
            }
        }
    }

    // Caso 3: El comando es .lb pero usaron parámetros de comparación como -c o compare
    if (['lb', 'leaderboard'].includes(commandLower)) {
        const hasCompare = args.some(arg => {
            const lowerArg = arg.toLowerCase();
            return lowerArg === 'c' || lowerArg === '-c' || lowerArg === '--c' ||
                   lowerArg === 'compare' || lowerArg === '-compare' || lowerArg === '--compare' ||
                   lowerArg === 'comparar' || lowerArg === '-comparar' || lowerArg === '--comparar';
        });
        if (hasCompare) {
            return `❌ El comando \`.lb\` (leaderboard) no tiene un parámetro de comparación \`-c\`. ¿Habrás querido usar \`.c\` para comparar tu puntuación en este beatmap?`;
        }
    }

    // Caso 4: El usuario intenta usar -oauth en un comando que no es link/vincular
    if (!['link', 'vincular'].includes(commandLower)) {
        const hasOAuth = args.some(arg => {
            const lowerArg = arg.toLowerCase();
            return lowerArg === 'oauth' || lowerArg === '-oauth' || lowerArg === '--oauth';
        });
        if (hasOAuth) {
            return `❌ **El parámetro** \`-oauth\` solo es válido en el comando \`.link -oauth\` para vincular tu cuenta de osu! de forma privada y segura.`;
        }
    }

    // Caso 5: El usuario intenta pasar un enlace de beatmap a comandos de perfil o jugadas recientes/top
    if (['osu', 'o', 'perfil', 'rs', 'recent', 'r', 'rm', 'rc', 'rt', 'top', 't'].includes(commandLower)) {
        const hasBeatmapUrl = args.some(arg => {
            if (typeof arg !== 'string') return false;
            return arg.includes('osu.ppy.sh/b') || arg.includes('osu.ppy.sh/beatmaps') || arg.includes('osu.ppy.sh/beatmapsets');
        });
        if (hasBeatmapUrl) {
            return `❌ **El comando** \`.${command}\` no admite enlaces de beatmaps (se utiliza para consultar el perfil o jugadas de un usuario). ¿Habrás querido usar \`.c\` (para comparar) o \`.lb\` (para ver la tabla de clasificación) con este beatmap?`;
        }
    }

    // Caso 6: El usuario ingresa un país (ej. "mx" o "venezuela") en lugar de un nombre de usuario en comandos de perfil/recientes/top
    // Esto se activa únicamente cuando el comando falló debido a que el usuario no fue encontrado (errorTextOrResult contiene "no se encuentra", "no existe", etc.)
    if (errorTextOrResult && typeof errorTextOrResult === 'string') {
        const errLower = errorTextOrResult.toLowerCase();
        const isNotFoundError = errLower.includes('no se encuentra') || errLower.includes('no existe') || errLower.includes('no se encontró') || errLower.includes('no encontró') || errLower.includes('not found') || errLower.includes("couldn't be found");
        
        if (isNotFoundError && ['c', 'compare', 'comparar', 'compara', 'cm', 'cc', 'ct', 'top', 't', 'rs', 'recent', 'r', 'rm', 'rc', 'rt', 'osu', 'o', 'perfil'].includes(commandLower)) {
            const countryCodes = require("../src/country_codes.json");
            let detectedCountryCode = null;
            let detectedCountryName = null;

            // 1. Verificar si algún argumento es un código de país directamente (ej. "MX", "VE")
            for (const arg of args) {
                if (typeof arg !== 'string') continue;
                const cleanArg = arg.toUpperCase().replace(/^-+/, '').trim();
                if (countryCodes[cleanArg]) {
                    detectedCountryCode = cleanArg;
                    detectedCountryName = countryCodes[cleanArg].country;
                    break;
                }
            }

            // 2. Si no, verificar si coincide con el nombre de un país (ej. "mexico", "venezuela")
            if (!detectedCountryCode) {
                const removeAccents = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                for (const arg of args) {
                    if (typeof arg !== 'string') continue;
                    const cleanArg = removeAccents(arg.toLowerCase().trim());
                    for (const code of Object.keys(countryCodes)) {
                        const countryName = removeAccents(countryCodes[code].country.toLowerCase());
                        if (countryName === cleanArg || (cleanArg.length > 3 && countryName.includes(cleanArg))) {
                            detectedCountryCode = code;
                            detectedCountryName = countryCodes[code].country;
                            break;
                        }
                    }
                    if (detectedCountryCode) break;
                }
            }

            if (detectedCountryCode) {
                return `❌ **El comando** \`.${command}\` no admite nombres o códigos de país como parámetro de usuario. ¿Habrás querido hacer \`.lb -pais ${detectedCountryCode}\` para revisar la tabla de clasificación de **${detectedCountryName.toUpperCase()} (${detectedCountryCode})**?`;
            }
        }
    }

    return null;
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
            const OsuUserModel = require("../models/OsuUserModel.js");
            const hasTokenRecord = await OsuUserModel.getOAuthTokenRecord(message.author.id);
            if (!hasTokenRecord) {
                return await handleOAuthFailure(message.author, logger);
            }
            
            const token = await OsuUserModel.getValidTokenForUser(message.author.id);
            if (!token) {
                return `❌ Hubo un error al validar tu sesión de osu! debido a un problema de conexión temporal. Por favor, intenta ejecutar el comando nuevamente en unos instantes.`;
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

        const preSmartSuggestion = await smartErrorSuggester(command, args, message, res);
        if (preSmartSuggestion) {
            if (logger) logger.failed(`Sugerencia inteligente activa: ${preSmartSuggestion.replace(/❌\s*/g, '').slice(0, 100)}`);
            return preSmartSuggestion;
        }

        try {
            let result = await found_command.run(
                { message, res, reply, logger },
                alias_args ? [alias_args, ...args] : args,
                intialized_data
            );

            if (typeof result === 'string') {
                const smartSuggestion = await smartErrorSuggester(command, args, message, res, result);
                if (smartSuggestion) {
                    result = smartSuggestion;
                }
            }

            if (message.optimizationSuggestion) {
                const suggestion = message.optimizationSuggestion;
                delete message.optimizationSuggestion;
                if (typeof result === 'string') {
                    result = result + "\n" + suggestion;
                } else if (result && typeof result === 'object') {
                    if (result.content) {
                        result.content = result.content + "\n" + suggestion;
                    } else {
                        result.content = suggestion;
                    }
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
            const smartSuggestion = await smartErrorSuggester(command, args, message, res, error.message);
            if (smartSuggestion) {
                return smartSuggestion;
            }
            throw error; // Re-lanzar para el try/catch del despachador
        } finally {
            message.channel.send = originalChannelSend;
            message.reply = originalMessageReply;
            if (reply && originalReplyReply) {
                reply.reply = originalReplyReply;
            }
        }
	}
	
	const commandLower = command.toLowerCase();
	if (['oauth', 'auth', 'vincular', 'linkear', 'linkeo', 'conectar', 'oauth2'].includes(commandLower)) {
		return `❌ El comando \`s.${command}\` no existe. Si deseas vincular tu cuenta de osu! de forma segura mediante OAuth, por favor utiliza **\`s.link -oauth\`** o el comando slash **\`/link\`**. 🔒`;
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
            const OsuUserModel = require("../models/OsuUserModel.js");
            const hasTokenRecord = await OsuUserModel.getOAuthTokenRecord(interaction.user.id);
            if (!hasTokenRecord) {
                const failureMsg = await handleOAuthFailure(interaction.user, interaction.logger);
                await interaction.editReply(failureMsg);
                return true;
            }
            
            const token = await OsuUserModel.getValidTokenForUser(interaction.user.id);
            if (!token) {
                await interaction.editReply(`❌ Hubo un error al validar tu sesión de osu! debido a un problema de conexión temporal. Por favor, intenta ejecutar el comando nuevamente en unos instantes.`);
                return true;
            }
        }
		return await slash_commands_map.get(commandName).run(interaction, res, chat_commands);
    }
	
	if (chat_commands_map.has(commandName)) {
        const found_command = chat_commands_map.get(commandName);
        if (found_command.requireOAuth || (found_command.run && found_command.run.requireOAuth)) {
            const OsuUserModel = require("../models/OsuUserModel.js");
            const hasTokenRecord = await OsuUserModel.getOAuthTokenRecord(interaction.user.id);
            if (!hasTokenRecord) {
                const failureMsg = await handleOAuthFailure(interaction.user, interaction.logger);
                await interaction.editReply(failureMsg);
                return true;
            }
            
            const token = await OsuUserModel.getValidTokenForUser(interaction.user.id);
            if (!token) {
                await interaction.editReply(`❌ Hubo un error al validar tu sesión de osu! debido a un problema de conexión temporal. Por favor, intenta ejecutar el comando nuevamente en unos instantes.`);
                return true;
            }
        }
		let interactionUsed = false;
		const messages = {
			message: {
				author: interaction.user,
				member: interaction.member || (interaction.guild ? interaction.guild.members.cache.get(interaction.user.id) : null),
				guild: interaction.guild,
				locale: interaction.resolvedLocale,
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


module.exports = { chatCommand, slashCommand, loadSlashCommands, loadCommands, smartErrorSuggester }
// por ahora los slashs estan rotos; a revisar