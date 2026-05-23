const { doHelpListEmbed, doHelpCommandEmbed, buildHelpNavigationRow } = require("../../../views/generalViews.js");

function getCommandHelpData(cmdName, commandsMap, mainCommandsSet) {
    const commandData = commandsMap.get(cmdName);
    if (!commandData) return null;

    // Encontrar el nombre principal del comando si es que usaron un alias
    let mainName = cmdName;
    if (!mainCommandsSet.has(cmdName)) {
        for (const name of mainCommandsSet) {
            if (commandsMap.get(name) === commandData) {
                mainName = name;
                break;
            }
        }
    }

    const embedMsj_description = commandData.description || commandData.run?.description || {};
    const headerText = embedMsj_description.header || (typeof embedMsj_description === 'string' ? embedMsj_description : "Auto explicable.");
    const bodyText = embedMsj_description.body || "No hay detalles adicionales.";
    const usageText = embedMsj_description.usage || `s.${mainName}`;

    const aliases = [];
    if (commandData.run?.alias) {
        aliases.push(...Object.keys(commandData.run.alias));
    }

    const fields = [
        {
            name: "📝 Descripción",
            value: bodyText,
            inline: false
        },
        {
            name: "❓ Cómo usarlo",
            value: `\`\`\`\n${usageText}\n\`\`\``,
            inline: false
        }
    ];

    if (aliases.length > 0) {
        fields.push({
            name: "🔗 Alias",
            value: aliases.map(a => `\`${a}\``).join(", "),
            inline: true
        });
    }

    const category = commandData.type || "default";

    return {
        mainName,
        headerText,
        fields,
        category
    };
}

function getCategoryCommands(category, commandsMap, mainCommandsSet) {
    const list = [];
    for (const [key, value] of commandsMap) {
        if (!mainCommandsSet.has(key)) continue;
        if ((value.type || "default") === category) {
            list.push(key);
        }
    }
    return list.sort();
}

async function run(messages, args, intialized_data) {
    const { message } = messages;

    // Orden y etiquetas de los tipos de comandos
    const type_order = ["osu", "utils", "meme", "general", "about", "moderation"];
    const categoryInfo = {
        osu: { name: "osu! 🎮", emoji: "🎮" },
        utils: { name: "Utilidades 🛠️", emoji: "🛠️" },
        meme: { name: "Diversión 🌸", emoji: "🌸" },
        general: { name: "General ℹ️", emoji: "ℹ️" },
        about: { name: "Acerca de 🛡️", emoji: "🛡️" },
        moderation: { name: "Moderación 👮", emoji: "👮" }
    };

    const commandsMap = intialized_data.get('chat_commands_map');
    const mainCommandsSet = intialized_data.get('chat_main_commands_set');

    // Si no hay argumentos, listar comandos
    if (args[0] == null || args[0].trim() === "") {
        const excludeTypes = new Set(['admin']);

        // Agrupar por tipo
        const groupedCommands = {};
        for (const [key, value] of commandsMap) {
            // Evitar listar alias en el menú principal
            if (!mainCommandsSet.has(key)) continue;
            
            const type = value.type;
            if (excludeTypes.has(type)) continue;

            if (!groupedCommands[type]) {
                groupedCommands[type] = [];
            }
            groupedCommands[type].push(`\`${key}\``);
        }

        const fields = [];
        for (const type of type_order) {
            if (groupedCommands[type] && groupedCommands[type].length > 0) {
                const info = categoryInfo[type] || { name: type.charAt(0).toUpperCase() + type.slice(1), emoji: "📁" };
                fields.push({
                    name: `${info.emoji} ${info.name}`,
                    value: groupedCommands[type].join(" "),
                    inline: false
                });
            }
        }

        const description = "**¡Hola! Soy Sengo**, un bot de Discord especializado en osu! y utilidades locales.\n\n> Usa `s.help [comando]` para ver la descripción detallada y los parámetros de un comando específico.";
        const embed = doHelpListEmbed(message, fields, description);
        
        await message.channel.send({ embeds: [embed] });
        return;
    }

    // Buscar descripción de un comando específico
    const queryName = args[0].toLowerCase();

    if (commandsMap.has(queryName)) {
        const helpData = getCommandHelpData(queryName, commandsMap, mainCommandsSet);
        if (!helpData) return;

        const embed = doHelpCommandEmbed(message, helpData.mainName, queryName, helpData);

        const categoryCmds = getCategoryCommands(helpData.category, commandsMap, mainCommandsSet);
        const row = buildHelpNavigationRow(helpData.mainName, categoryCmds);

        const sentMessage = await message.channel.send({
            embeds: [embed],
            components: row ? [row] : []
        });

        if (!row) return;

        const filter = btnInt => btnInt.user.id === message.author.id;
        const collector = sentMessage.createMessageComponentCollector({
            filter,
            idle: 60000 // 60 segundos
        });

        collector.on('collect', async i => {
            try {
                await i.deferUpdate();

                const parts = i.customId.split("_");
                const targetCmd = parts[2];

                const nextHelpData = getCommandHelpData(targetCmd, commandsMap, mainCommandsSet);
                if (!nextHelpData) return;

                const nextEmbed = doHelpCommandEmbed(message, nextHelpData.mainName, targetCmd, nextHelpData);
                const nextRow = buildHelpNavigationRow(nextHelpData.mainName, categoryCmds);

                await i.editReply({
                    embeds: [nextEmbed],
                    components: nextRow ? [nextRow] : []
                });
            } catch (err) {
                console.error("Error al rotar ayuda de comandos:", err);
            }
        });

        collector.on('end', async () => {
            try {
                await sentMessage.edit({ components: [] });
            } catch (e) {
                // Mensaje eliminado
            }
        });

        return;
    }

    const errEmbed = doHelpListEmbed(message, [], `El comando \`${queryName}\` no existe. Usa \`s.help\` para ver la lista de comandos.`);
    await message.channel.send({ embeds: [errEmbed] });
}

run.alias = {
    "ayuda": {
        "args" : ""
    }
}

run.description = {
    'header' : 'Los comandos de Sengo, explicados paso a paso.',
    'body' : 'Muestra la lista completa de comandos o el detalle y uso de un comando específico.',
    'usage' : `s.help           : Lista todos los comandos disponibles\ns.help [comando] : Muestra la ayuda detallada para un comando`
}

module.exports = { run }