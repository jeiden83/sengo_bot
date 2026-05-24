const { EmbedBuilder } = require("discord.js");
const { getEmbedColor } = require("./osuViewHelpers.js");

const MONTHS_ES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

/**
 * Genera el embed con la lista de todos los cumpleaños del servidor agrupados por mes.
 */
function doBirthdayListEmbed(message, guild, bdayList, pageArg = 1) {
    const embedColor = getEmbedColor(message);
    const guildIcon = guild.iconURL({ dynamic: true }) || "";

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Cumpleaños en ${guild.name}`,
            iconURL: guildIcon || undefined
        })
        .setColor(embedColor)
        .setTimestamp();

    if (bdayList.length === 0) {
        embed.setDescription("✨ No hay cumpleaños registrados en este servidor. ¡Sé el primero usando `.cumple set`!");
        embed.setFooter({
            text: "Sengo • s.cumple",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        });
        return embed;
    }

    // Agrupar por mes
    const grouped = {};
    for (let i = 0; i < 12; i++) {
        grouped[i] = [];
    }

    bdayList.forEach(item => {
        grouped[item.month - 1].push(item);
    });

    // Quedarse solo con los meses que tienen cumpleaños
    const monthsWithBdays = [];
    for (let i = 0; i < 12; i++) {
        if (grouped[i].length > 0) {
            monthsWithBdays.push({
                monthIndex: i,
                monthName: MONTHS_ES[i],
                list: grouped[i]
            });
        }
    }

    // Paginación: 4 meses por página
    const pageSize = 4;
    const totalPages = Math.ceil(monthsWithBdays.length / pageSize) || 1;
    
    let page = parseInt(pageArg) || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;

    const startIndex = (page - 1) * pageSize;
    const pageMonths = monthsWithBdays.slice(startIndex, startIndex + pageSize);

    pageMonths.forEach(m => {
        const content = m.list.map(item => {
            let ageStr = '';
            if (item.year) {
                const currentYear = new Date().getFullYear();
                const age = currentYear - item.year;
                ageStr = ` (cumple ${age} años)`;
            }
            return `• <@${item.userId}> - **${item.day} de ${m.monthName}**${ageStr}`;
        }).join('\n');

        embed.addFields({ name: `📅 ${m.monthName}`, value: content, inline: false });
    });

    embed.setFooter({
        text: `Página ${page}/${totalPages} • Sengo • s.cumple`,
        iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
    });

    return embed;
}

/**
 * Genera el embed para mostrar el siguiente cumpleaños.
 */
function doBirthdayNextEmbed(message, guild, nextData) {
    const embedColor = getEmbedColor(message);
    const guildIcon = guild.iconURL({ dynamic: true }) || "";

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setFooter({
            text: "Sengo • s.cumple",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();

    if (!nextData || nextData.birthdays.length === 0) {
        embed.setTitle("🎂 Próximo Cumpleaños")
             .setDescription("No hay cumpleaños registrados en el servidor.");
        return embed;
    }

    const { daysLeft, birthdays } = nextData;
    const userMentions = birthdays.map(b => `<@${b.userId}>`).join(", ");
    const dateStr = `${birthdays[0].day} de ${MONTHS_ES[birthdays[0].month - 1]}`;

    if (daysLeft === 0) {
        embed.setTitle("🎉 ¡HOY ES EL CUMPLEAÑOS! 🎉")
             .setDescription(`🎂 ¡Hoy es el cumpleaños de **${userMentions}** (${dateStr})! Deseémosles un día fantástico. ✨🎁`)
             .setThumbnail("https://jeiden.s-ul.eu/3ssHl9Gd"); // Reemplazar con avatar si es solo uno
        if (birthdays.length === 1 && birthdays[0].member) {
            const avatar = birthdays[0].member.user.displayAvatarURL({ dynamic: true, size: 256 });
            embed.setThumbnail(avatar);
        }
    } else {
        const textPlural = birthdays.length === 1 ? "El próximo cumpleaños es de" : "Los próximos cumpleaños son de";
        const daysStr = daysLeft === 1 ? "mañana" : `en **${daysLeft}** días`;
        
        embed.setTitle("🎂 Próximo Cumpleaños")
             .setDescription(`✨ ${textPlural} **${userMentions}** ${daysStr} (**${dateStr}**).`);
             
        if (birthdays.length === 1 && birthdays[0].member) {
            const avatar = birthdays[0].member.user.displayAvatarURL({ dynamic: true, size: 256 });
            embed.setThumbnail(avatar);
        }
    }

    return embed;
}

/**
 * Genera el embed para mostrar el cumpleaños anterior.
 */
function doBirthdayPrevEmbed(message, guild, prevData) {
    const embedColor = getEmbedColor(message);

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setFooter({
            text: "Sengo • s.cumple",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();

    if (!prevData || prevData.birthdays.length === 0) {
        embed.setTitle("🎂 Cumpleaños Anterior")
             .setDescription("No hay cumpleaños registrados en el servidor.");
        return embed;
    }

    const { daysAgo, birthdays } = prevData;
    const userMentions = birthdays.map(b => `<@${b.userId}>`).join(", ");
    const dateStr = `${birthdays[0].day} de ${MONTHS_ES[birthdays[0].month - 1]}`;

    const textPlural = birthdays.length === 1 ? "El último cumpleaños fue de" : "Los últimos cumpleaños fueron de";
    const daysStr = daysAgo === 0 ? "hoy" : daysAgo === 1 ? "ayer" : `hace **${daysAgo}** días`;

    embed.setTitle("🎂 Cumpleaños Anterior")
         .setDescription(`✨ ${textPlural} **${userMentions}** ${daysStr} (**${dateStr}**).`);

    if (birthdays.length === 1 && birthdays[0].member) {
        const avatar = birthdays[0].member.user.displayAvatarURL({ dynamic: true, size: 256 });
        embed.setThumbnail(avatar);
    }

    return embed;
}

/**
 * Genera el embed para el anuncio automático diario.
 */
function doBirthdayAnnounceEmbed(client, member, age = null, isLinked = true) {
    // Usar el color rosa por defecto para celebraciones de cumpleaños
    const embedColor = "#FF69B4";
    const userAvatar = member.user.displayAvatarURL({ dynamic: true, size: 512 });

    const titleText = age ? `🎉 ¡Felices ${age} años! 🎉` : "🎉 ¡Feliz Cumpleaños! 🎉";

    const embed = new EmbedBuilder()
        .setTitle(titleText)
        .setDescription(`✨ Hoy es el cumpleaños de ${member}! Deseémosle un excelente día lleno de alegrías y regalos. 🎂🎁🎈`)
        .setColor(embedColor)
        .setThumbnail(userAvatar)
        .setTimestamp();

    if (!isLinked) {
        embed.setFooter({
            text: "Sengo • Tip: ¡Vincula tu cuenta de osu! (.link o /vincular) para que te felicite exactamente a tu hora local! ⏰",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        });
    } else {
        embed.setFooter({
            text: "Sengo • Anuncios de Cumpleaños",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        });
    }

    return embed;
}

module.exports = {
    doBirthdayListEmbed,
    doBirthdayNextEmbed,
    doBirthdayPrevEmbed,
    doBirthdayAnnounceEmbed
};
