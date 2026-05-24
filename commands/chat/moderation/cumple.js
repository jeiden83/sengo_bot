const { PermissionFlagsBits } = require("discord.js");
const BirthdayModel = require("../../../models/BirthdayModel.js");
const { doBirthdayListEmbed, doBirthdayNextEmbed, doBirthdayPrevEmbed } = require("../../../views/birthdayViews.js");

function parseBirthday(str) {
    if (!str) return null;
    const clean = str.trim().replace(/-/g, '/');
    const parts = clean.split('/');
    if (parts.length < 2 || parts.length > 3) return null;
    
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    let year = null;
    if (parts.length === 3) {
        year = parseInt(parts[2], 10);
    }
    
    if (isNaN(day) || isNaN(month)) return null;
    if (month < 1 || month > 12) return null;
    
    // Validar días según mes (máximos estándar)
    const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day < 1 || day > daysInMonth[month - 1]) return null;
    
    // Año bisiesto específico para el 29 de febrero si se ingresa el año
    if (month === 2 && day === 29 && year !== null) {
        const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
        if (!isLeap) return null;
    }
    
    if (year !== null) {
        const currentYear = new Date().getFullYear();
        if (year < 1900 || year > currentYear) return null;
    }
    
    return { day, month, year };
}

async function run(messages, args) {
    const { message } = messages;
    const authorId = message.author.id;
    const guild = message.guild;

    // Filtrar argumentos nulos, indefinidos o vacíos (p. ej. causados por alias_args)
    const cleanArgs = (args || []).filter(arg => arg !== null && arg !== undefined && arg !== '');

    if (cleanArgs.length === 0) {
        return helpMessage();
    }

    const sub = cleanArgs[0].toLowerCase();

    // 1. Caso de configurar canal
    if (sub === "canal" || sub === "channel") {
        if (!guild) return "❌ Este subcomando solo puede ejecutarse en un servidor.";
        
        const member = message.member || await guild.members.fetch(authorId).catch(() => null);
        if (!member) return "❌ No se pudo validar tu membresía en el servidor.";
        
        const hasPermission = member.permissions.has(PermissionFlagsBits.ManageGuild) || 
                              member.permissions.has(PermissionFlagsBits.Administrator);
        if (!hasPermission) {
            return "❌ No tienes permisos para configurar el canal de cumpleaños (se requiere *Gestionar Servidor* o *Administrador*).";
        }

        if (!cleanArgs[1]) {
            const currentChannelId = BirthdayModel.getGuildChannel(guild.id);
            if (currentChannelId) {
                return `📢 El canal de anuncios de cumpleaños actual es <#${currentChannelId}>. Puedes cambiarlo con \`s.cumple canal #canal\` o desactivarlo con \`s.cumple canal desactivar\`.`;
            }
            return "📢 No hay ningún canal de cumpleaños configurado actualmente. Usa \`s.cumple canal #canal\` para establecer uno.";
        }

        const channelArg = cleanArgs[1].toLowerCase();
        if (channelArg === "quitar" || channelArg === "desactivar" || channelArg === "none") {
            BirthdayModel.setGuildChannel(guild.id, null);
            return "✅ Se ha desactivado el canal de anuncios de cumpleaños. Sengo ya no anunciará los cumpleaños en este servidor.";
        }

        let channelId = null;
        const match = cleanArgs[1].match(/^<#(\d+)>$/) || cleanArgs[1].match(/^(\d+)$/);
        if (match) {
            channelId = match[1];
        }

        if (!channelId) {
            return "❌ Debes mencionar un canal válido (ej: `#cumpleaños`) o proveer su ID.";
        }

        const targetChannel = guild.channels.cache.get(channelId);
        if (!targetChannel) {
            return "❌ No se encontró ese canal en este servidor. Asegúrate de que Sengo tenga acceso al mismo.";
        }

        BirthdayModel.setGuildChannel(guild.id, channelId);
        return `✅ Se ha configurado el canal de anuncios de cumpleaños en <#${channelId}> de forma exitosa.`;
    }

    // 2. Caso de eliminar cumpleaños
    if (sub === "quitar" || sub === "remove" || sub === "borrar" || sub === "delete") {
        const removed = BirthdayModel.removeUserBirthday(authorId);
        if (removed) {
            return "✅ Tu cumpleaños ha sido eliminado de mi base de datos de forma exitosa.";
        }
        return "❌ No tenías ningún cumpleaños registrado en mi sistema.";
    }

    // 3. Caso de ver lista de cumpleaños
    if (sub === "lista" || sub === "list") {
        if (!guild) return "❌ Este subcomando solo puede ejecutarse en un servidor.";
        const bdayList = await BirthdayModel.getGuildBirthdays(guild);
        const embed = doBirthdayListEmbed(message, guild, bdayList);
        return { embeds: [embed] };
    }

    // 4. Caso de ver siguiente cumpleaños
    if (sub === "siguiente" || sub === "next" || sub === "proximo" || sub === "próximo") {
        if (!guild) return "❌ Este subcomando solo puede ejecutarse en un servidor.";
        const nextData = await BirthdayModel.getNextBirthdays(guild, new Date());
        const embed = doBirthdayNextEmbed(message, guild, nextData);
        return { embeds: [embed] };
    }

    // 5. Caso de ver cumpleaños anterior
    if (sub === "anterior" || sub === "prev" || sub === "pasado") {
        if (!guild) return "❌ Este subcomando solo puede ejecutarse en un servidor.";
        const prevData = await BirthdayModel.getPrevBirthdays(guild, new Date());
        const embed = doBirthdayPrevEmbed(message, guild, prevData);
        return { embeds: [embed] };
    }

    // 6. Caso de establecer cumpleaños (por comando explícito o atajo)
    let dateStr = cleanArgs[1];
    let isSetSubcommand = sub === "set" || sub === "agregar" || sub === "establecer";
    
    // Si no es un subcomando set explícito, el primer argumento podría ser la fecha directamente (atajo)
    if (!isSetSubcommand) {
        dateStr = cleanArgs[0];
    }

    const parsedDate = parseBirthday(dateStr);
    if (parsedDate) {
        const { day, month, year } = parsedDate;
        BirthdayModel.setUserBirthday(authorId, day, month, year);
        const yearStr = year ? `/${year}` : '';
        return `✅ Cumpleaños guardado con éxito: **${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}${yearStr}**. Sengo te felicitará en tu día. 🎉`;
    }

    // Si falló el parsing y usó el subcomando set
    if (isSetSubcommand) {
        return "❌ Formato de fecha inválido. Por favor usa `DD/MM` (ej: `15/08`) o `DD/MM/YYYY` (ej: `15/08/2000`).";
    }

    // Caso de comando no reconocido
    return `❌ Subcomando o fecha no reconocido. Usa \`s.cumple ayuda\` para ver las opciones disponibles.`;
}

function helpMessage() {
    return "🎂 **Guía del Comando de Cumpleaños (`s.cumple`)** 🎂\n\n" +
           "**Comandos de Usuario:**\n" +
           "• `s.cumple [DD/MM]` o `s.cumple [DD/MM/YYYY]` : Guarda o edita tu fecha de cumpleaños.\n" +
           "• `s.cumple set [fecha]` : Alternativa para guardar tu cumpleaños.\n" +
           "• `s.cumple quitar` : Elimina tu cumpleaños de mi base de datos.\n" +
           "• `s.cumple lista` : Muestra todos los cumpleaños del servidor agrupados por mes.\n" +
           "• `s.cumple proximo` (o `siguiente`) : Muestra el cumpleaños más cercano en el futuro.\n" +
           "• `s.cumple anterior` (o `pasado`) : Muestra el cumpleaños más reciente en el pasado.\n\n" +
           "**Comandos de Moderación (Admin/Gestionar Servidor):**\n" +
           "• `s.cumple canal [#canal]` : Elige en qué canal se enviarán las felicitaciones diarias.\n" +
           "• `s.cumple canal desactivar` : Desactiva los anuncios de cumpleaños en el servidor.";
}

run.description = {
    header: 'Gestión de cumpleaños del servidor',
    body: 'Permite registrar cumpleaños y programar felicitaciones automáticas en un canal configurado por administradores.',
    usage: 's.cumple [fecha/lista/proximo/anterior/quitar/canal]'
};

module.exports = { run };
