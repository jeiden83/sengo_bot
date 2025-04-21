const { getOsuUser, argsParser } = require("../../utils/osu.js");
const { EmbedBuilder } = require("discord.js");

async function doEmbed(message, nombre_comando, descripcion){
    
    const roleColor = message.member.roles.highest.color || '#ffffff';
    const icon_url = message.author.displayAvatarURL({ dynamic: true, size: 512 });

    const embed = new EmbedBuilder()
    .setAuthor({
        name: `Comando: ${nombre_comando}`,
        iconURL: icon_url
    })
    .setDescription(descripcion)
    .setColor(roleColor)
    .setFooter({
        text: "SengoBot",
        iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
    })
    .setTimestamp();

    return { embeds: [embed] };
}

async function run(messages, args, intialized_data) {
    const { message, res } = messages;

    // Orden de los tipos de comandos
    const type_order = ["general", "osu", "utils", "meme", "about"];

    // Si no hay argumentos, listar comandos
    if (args.length == 0 || args[0] == "") {
        // Categorías a excluir
        const excludeTypes = new Set(['admin', 'meme']);

        // Agrupar por tipo, excluyendo ciertas categorías
        const groupedCommands = {};
        for (const [key, value] of intialized_data.get('chat_commands_map')) {
            const type = value.type;
            if (excludeTypes.has(type)) continue; // Saltar los tipos no deseados

            if (!groupedCommands[type]) {
                groupedCommands[type] = [];
            }
            groupedCommands[type].push(`\`${key}\``);
        }

        // Formatear el mensaje respetando el orden de type_order
        let msj = '';
        for (const type of type_order) {
            if (groupedCommands[type]) {
                msj += `** < ${type.charAt(0).toUpperCase() + type.slice(1)} > **\n${groupedCommands[type].join(` `)}\n\n`;
            }
        }

        return await doEmbed(message, 'help > Comandos', msj);
    }

    // Hay un argumento, asi que busca la descripción del comando
    const commandName = args[0];
    const commandsMap = intialized_data.get('chat_commands_map');

    if (commandsMap.has(commandName)) {
        const commandData = commandsMap.get(commandName);

        const embedMsj_description = commandData.run.description;
        const embedMsj_header = `:arrow_forward: ${embedMsj_description.header}` || "Auto explicable.";
        const embedMsj_body = embedMsj_description.body || "No hay nada que explicar.";
        const embedMsj_usage = embedMsj_description.usage || `s.${commandName}`;
        const embed_msj = `**${embedMsj_header}**\n\n${embedMsj_body}\n\n:grey_question: **Como usarlo:** \n\`${embedMsj_usage}\``

        return await doEmbed(message, `help > ${commandName}`, `${embed_msj}`);
    }

    return await doEmbed(message, "help > Error", `El comando \`${commandName}\` no existe.`);
}

run.alias = {
    "ayuda": {
        "args" : ""
    }
}

run.description = 
{
    'header' : 'Los comandos del Sengo. O al menos la mayoria :shh:',
    'body' : 'Minimo que lo tenga. Con un argumento revisa la descripcion de dicho comando.',
    'usage' : `s.help : Lista los comandos \ns.help 'comando' : Describe el 'comando'`
}

module.exports = { run }