const { SlashCommandBuilder, REST, Routes, Collection } = require("discord.js");
const fs = require('fs');
const path = require('path');

// Hacer comando de chat
async function chatCommand(intialized_data, command_data) {
	const {args, command, message, res, reply} = command_data;

    const chat_commands_set = intialized_data.get('chat_commands_set');
    const chat_commands_map = intialized_data.get('chat_commands_map');


	if (chat_commands_set.has(command)){

		const found_command = chat_commands_map.get(command);

		return await found_command.run(
			{ message, res, reply },

			[...args, found_command.run.alias ? found_command.run.alias[command] ? found_command.run.alias[command].args : "" : ""],
			
			intialized_data
		);
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
// Hacer comando slash
async function slashCommand(chat_commands, slash_commands, interaction) {
	const slash_commands_set = slash_commands.get('slash_commands_set');
	const slash_commands_map = slash_commands.get('slash_commands_map');
	const chat_commands_map = chat_commands.get('chat_commands_map');

	const { commandName } = interaction;

	if (slash_commands_set.has(commandName))
		return await slash_commands_map.get(commandName).run(interaction);
	
	if (chat_commands_map.has(commandName))
		return await chat_commands_map.get(commandName).run(interaction);
}
// Cargar slash commands
async function loadSlashCommands(chat_commands, config) {
    const chat_commands_set = chat_commands.get('chat_commands_set');
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

				slash_commands_map[commandName] = command_module;
			} catch (error) {

				console.error(`El comando slash ${commandName} no tiene una función 'run'.`);
			}
		}
	}

	// Listar los slashs
	const commands = Array.from(chat_commands_set).map(command_name => 
		new SlashCommandBuilder()
			.setName(command_name)
			.setDescription(
				slash_commands_map.has(command_name) && typeof slash_commands_map.get(command_name).description === "string"
					? slash_commands_map.get(command_name).description
					: chat_commands_map.has(command_name) && typeof chat_commands_map.get(command_name).description === "string"
						? chat_commands_map.get(command_name).description
						: "No description available"
			)			
			.toJSON()
	);

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
    const chat_commands_map = new Collection();

    function loadFromDirectory(directory, parentFolder = "") {
        const files = fs.readdirSync(directory);

        for (const file of files) {
            const filePath = path.join(directory, file);
            const stat = fs.statSync(filePath);

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
        .set('chat_commands_map', chat_commands_map);
}


module.exports = { chatCommand, slashCommand, loadSlashCommands, loadCommands }
// por ahora los slashs estan rotos; a revisar