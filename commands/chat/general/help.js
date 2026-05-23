const { EmbedBuilder } = require("discord.js");

async function doEmbed(message, title, description, fields = []){
    const roleColor = message.member?.roles?.highest?.color || 0xfe66aa;
    const icon_url = message.author.displayAvatarURL({ dynamic: true, size: 512 });

    const embed = new EmbedBuilder()
        .setAuthor({
            name: title,
            iconURL: icon_url
        })
        .setDescription(description)
        .setColor(roleColor)
        .setFooter({
            text: "SengoBot • s.help [comando]",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    if (fields && fields.length > 0) {
        embed.addFields(fields);
    }

    return { embeds: [embed] };
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
    if (args[0] == null) {
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
        return await doEmbed(message, 'Menú de Ayuda • SengoBot', description, fields);
    }

    // Buscar descripción de un comando específico
    const queryName = args[0].toLowerCase();

    if (commandsMap.has(queryName)) {
        const commandData = commandsMap.get(queryName);

        // Encontrar el nombre principal del comando si es que usaron un alias
        let mainName = queryName;
        if (!mainCommandsSet.has(queryName)) {
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

        const title = `Ayuda de Comando: s.${mainName}${mainName !== queryName ? ` (Alias: s.${queryName})` : ''}`;
        return await doEmbed(message, title, `*${headerText}*`, fields);
    }

    return await doEmbed(message, "Error • Ayuda", `El comando \`${queryName}\` no existe. Usa \`s.help\` para ver la lista de comandos.`);
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