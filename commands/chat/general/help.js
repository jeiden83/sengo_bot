const { doHelpListEmbed, doHelpCommandEmbed, buildHelpNavigationRow } = require("../../../views/generalViews.js");
const { t } = require("../../../utils/i18n.js");

function formatUsage(usageText, mainName, aliases = [], locale = 'es') {
    if (!usageText) return `.${mainName}`;
    
    // Normalizar a usar prefijo de punto "."
    const cleanUsageText = usageText.replace(/\bs\./g, '.');
    
    const lines = cleanUsageText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length <= 1) {
        return cleanUsageText;
    }

    const prefixes = [`.${mainName}`, ...aliases.map(a => `.${a}`)];
    
    const allStartWithPrefix = lines.every(line => {
        return prefixes.some(p => line.startsWith(p));
    });

    if (!allStartWithPrefix) {
        return cleanUsageText;
    }

    let formatted = `.${mainName}\n`;
    const parsedLines = [];
    for (const line of lines) {
        const matchedPrefix = prefixes.find(p => line.startsWith(p));
        let remaining = line.slice(matchedPrefix.length).trim();
        
        let args = "";
        let desc = "";
        
        if (remaining.startsWith(':')) {
            args = t(locale, 'help.no_arguments');
            desc = remaining.slice(1).trim();
        } else {
            const colonIdx = remaining.indexOf(':');
            if (colonIdx !== -1) {
                args = remaining.slice(0, colonIdx).trim();
                desc = remaining.slice(colonIdx + 1).trim();
            } else {
                args = remaining;
                desc = "";
            }
        }
        
        parsedLines.push({ args, desc });
    }

    const maxArgsLen = Math.max(...parsedLines.map(p => p.args.length));
    
    for (const { args, desc } of parsedLines) {
        const paddedArgs = args.padEnd(maxArgsLen, ' ');
        if (desc) {
            formatted += `  ▸ ${paddedArgs} : ${desc}\n`;
        } else {
            formatted += `  ▸ ${args}\n`;
        }
    }

    return formatted.trimEnd();
}

function getCommandHelpData(cmdName, commandsMap, mainCommandsSet, locale = 'es') {
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

    let headerText = t(locale, `commands.${mainName}.header`);
    if (headerText === `commands.${mainName}.header`) {
        const embedMsj_description = commandData.description || commandData.run?.description || {};
        headerText = embedMsj_description.header || (typeof embedMsj_description === 'string' ? embedMsj_description : "Auto explicable.");
    }

    let bodyText = t(locale, `commands.${mainName}.body`);
    if (bodyText === `commands.${mainName}.body`) {
        const embedMsj_description = commandData.description || commandData.run?.description || {};
        bodyText = embedMsj_description.body || "No hay detalles adicionales.";
    }

    const aliases = [];
    if (commandData.run?.alias) {
        aliases.push(...Object.keys(commandData.run.alias));
    }

    let rawUsage = t(locale, `commands.${mainName}.usage`);
    if (rawUsage === `commands.${mainName}.usage`) {
        const embedMsj_description = commandData.description || commandData.run?.description || {};
        rawUsage = embedMsj_description.usage || `s.${mainName}`;
    }
    const usageText = formatUsage(rawUsage, mainName, aliases, locale);

    const fields = [
        {
            name: t(locale, 'help.fields.description'),
            value: bodyText,
            inline: false
        },
        {
            name: t(locale, 'help.fields.usage'),
            value: `\`\`\`\n${usageText}\n\`\`\``,
            inline: false
        }
    ];

    if (aliases.length > 0) {
        fields.push({
            name: t(locale, 'help.fields.aliases'),
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
    const locale = message.locale || 'es';
    const rawContent = message.content || "";
    const prefix = rawContent.toLowerCase().startsWith("sd.")
        ? rawContent.slice(0, 3)
        : (rawContent.toLowerCase().startsWith("s.") ? rawContent.slice(0, 2) : "s.");

    // Orden y etiquetas de los tipos de comandos
    const type_order = ["osu", "utils", "meme", "general", "about", "moderation"];
    const categoryInfo = {
        osu: { name: t(locale, 'help.categories.osu'), emoji: "🎮" },
        utils: { name: t(locale, 'help.categories.utils'), emoji: "🛠️" },
        meme: { name: t(locale, 'help.categories.meme'), emoji: "🌸" },
        general: { name: t(locale, 'help.categories.general'), emoji: "ℹ️" },
        about: { name: name => name, emoji: "🛡️" }, // Se resolverá dinámicamente o tendrá su emoji/traducción
        moderation: { name: t(locale, 'help.categories.moderation'), emoji: "👮" }
    };
    categoryInfo.about.name = t(locale, 'help.categories.about');

    const commandsMap = intialized_data.get('chat_commands_map');
    const mainCommandsSet = intialized_data.get('chat_main_commands_set');

    // Si no hay argumentos, listar comandos
    if (args[0] == null || args[0].trim() === "") {
        const excludeTypes = new Set(['admin', 'meme']);

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

        const description = t(locale, 'help.description', { prefix });
        const embed = doHelpListEmbed(message, fields, description, locale);
        
        await message.channel.send({ embeds: [embed] });
        return;
    }

    // Buscar descripción de un comando específico
    const queryName = args[0].toLowerCase();

    if (commandsMap.has(queryName)) {
        const helpData = getCommandHelpData(queryName, commandsMap, mainCommandsSet, locale);
        if (!helpData) return;

        const embed = doHelpCommandEmbed(message, helpData.mainName, queryName, helpData, locale, prefix);

        const categoryCmds = getCategoryCommands(helpData.category, commandsMap, mainCommandsSet);
        const row = buildHelpNavigationRow(helpData.mainName, categoryCmds, locale, prefix);

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

                const nextHelpData = getCommandHelpData(targetCmd, commandsMap, mainCommandsSet, locale);
                if (!nextHelpData) return;

                const nextEmbed = doHelpCommandEmbed(message, nextHelpData.mainName, targetCmd, nextHelpData, locale, prefix);
                const nextRow = buildHelpNavigationRow(nextHelpData.mainName, categoryCmds, locale, prefix);

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
            } catch {
                // Mensaje eliminado
            }
        });

        return;
    }

    const notFoundText = t(locale, 'help.not_found', { queryName, prefix });
    const errEmbed = doHelpListEmbed(message, [], notFoundText, locale);
    await message.channel.send({ embeds: [errEmbed] });
}

run.alias = {
    "ayuda": {
        "args" : ""
    }
}

run.description = {
    'header': t('es', 'commands.help.header'),
    'body': t('es', 'commands.help.body'),
    'usage': t('es', 'commands.help.usage')
}

module.exports = { run }