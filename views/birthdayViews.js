const { EmbedBuilder } = require("discord.js");
const { getEmbedColor } = require("./osuViewHelpers.js");
const { t } = require("../utils/i18n.js");

const MONTHS = {
    es: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"],
    en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
};

function getFormattedDate(day, monthIndex, locale) {
    const monthNames = MONTHS[locale] || MONTHS['es'];
    const monthName = monthNames[monthIndex];
    if (locale === 'en') {
        return `${monthName} ${day}`;
    }
    return `${day} de ${monthName}`;
}

/**
 * Genera el embed con la lista de todos los cumpleaños del servidor agrupados por mes.
 */
function doBirthdayListEmbed(message, guild, bdayList, pageArg = 1, locale = 'es') {
    const embedColor = getEmbedColor(message);
    const isGlobal = !guild || guild.isGlobal;
    const guildIcon = (!isGlobal && typeof guild.iconURL === 'function') ? guild.iconURL({ dynamic: true }) : "";
    const authorName = isGlobal 
        ? t(locale, 'cumple.list_title_global') 
        : t(locale, 'cumple.list_title_guild', { guildName: guild.name });

    const embed = new EmbedBuilder()
        .setAuthor({
            name: authorName,
            iconURL: guildIcon || undefined
        })
        .setColor(embedColor)
        .setTimestamp();

    if (bdayList.length === 0) {
        embed.setDescription(t(locale, 'cumple.list_no_birthdays'));
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
    const monthNames = MONTHS[locale] || MONTHS['es'];
    for (let i = 0; i < 12; i++) {
        if (grouped[i].length > 0) {
            monthsWithBdays.push({
                monthIndex: i,
                monthName: monthNames[i],
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
                const now = new Date();
                const currentYear = now.getFullYear();
                const bdayThisYear = new Date(currentYear, item.month - 1, item.day);
                const todayMidnight = new Date(currentYear, now.getMonth(), now.getDate());
                const ageThisYear = currentYear - item.year;
                
                if (bdayThisYear < todayMidnight) {
                    ageStr = t(locale, 'cumple.list_age_past', { age: ageThisYear });
                } else if (bdayThisYear.getTime() === todayMidnight.getTime()) {
                    ageStr = t(locale, 'cumple.list_age_today', { age: ageThisYear });
                } else {
                    ageStr = t(locale, 'cumple.list_age_future', { age: ageThisYear });
                }
            }
            const formattedDate = getFormattedDate(item.day, item.month - 1, locale);
            return `• <@${item.userId}> - **${formattedDate}**${ageStr}`;
        }).join('\n');

        embed.addFields({ name: `📅 ${m.monthName}`, value: content, inline: false });
    });

    embed.setFooter({
        text: t(locale, 'cumple.list_footer', { page, total: totalPages }),
        iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
    });

    return embed;
}

/**
 * Genera el embed para mostrar el siguiente cumpleaños.
 */
function doBirthdayNextEmbed(message, guild, nextData, locale = 'es') {
    const embedColor = getEmbedColor(message);

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setFooter({
            text: "Sengo • s.cumple",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();

    if (!nextData || nextData.birthdays.length === 0) {
        embed.setTitle(t(locale, 'cumple.next_title'))
             .setDescription(t(locale, 'cumple.next_none'));
        return embed;
    }

    const { daysLeft, birthdays } = nextData;
    const userMentions = birthdays.map(b => `<@${b.userId}>`).join(", ");
    const dateStr = getFormattedDate(birthdays[0].day, birthdays[0].month - 1, locale);

    if (daysLeft === 0) {
        embed.setTitle(t(locale, 'cumple.next_today_title'))
             .setDescription(t(locale, 'cumple.next_today_desc', { users: userMentions, date: dateStr }))
             .setThumbnail("https://jeiden.s-ul.eu/3ssHl9Gd");
        if (birthdays.length === 1 && birthdays[0].member) {
            const avatar = birthdays[0].member.user.displayAvatarURL({ dynamic: true, size: 256 });
            embed.setThumbnail(avatar);
        }
    } else {
        const textPluralKey = birthdays.length === 1 ? 'cumple.next_singular_desc' : 'cumple.next_plural_desc';
        const daysStr = daysLeft === 1 
            ? t(locale, 'cumple.days_tomorrow') 
            : t(locale, 'cumple.days_future', { days: daysLeft });
        
        embed.setTitle(t(locale, 'cumple.next_title'))
             .setDescription(t(locale, textPluralKey, { users: userMentions, days: daysStr, date: dateStr }));
             
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
function doBirthdayPrevEmbed(message, guild, prevData, locale = 'es') {
    const embedColor = getEmbedColor(message);

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setFooter({
            text: "Sengo • s.cumple",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();

    if (!prevData || prevData.birthdays.length === 0) {
        embed.setTitle(t(locale, 'cumple.prev_title'))
             .setDescription(t(locale, 'cumple.prev_none'));
        return embed;
    }

    const { daysAgo, birthdays } = prevData;
    const userMentions = birthdays.map(b => `<@${b.userId}>`).join(", ");
    const dateStr = getFormattedDate(birthdays[0].day, birthdays[0].month - 1, locale);

    const textPluralKey = birthdays.length === 1 ? 'cumple.prev_singular_desc' : 'cumple.prev_plural_desc';
    const daysStr = daysAgo === 0 
        ? t(locale, 'cumple.days_today') 
        : daysAgo === 1 
            ? t(locale, 'cumple.days_yesterday') 
            : t(locale, 'cumple.days_ago', { days: daysAgo });

    embed.setTitle(t(locale, 'cumple.prev_title'))
         .setDescription(t(locale, textPluralKey, { users: userMentions, days: daysStr, date: dateStr }));

    if (birthdays.length === 1 && birthdays[0].member) {
        const avatar = birthdays[0].member.user.displayAvatarURL({ dynamic: true, size: 256 });
        embed.setThumbnail(avatar);
    }

    return embed;
}

/**
 * Genera el embed para el anuncio automático diario.
 */
function doBirthdayAnnounceEmbed(client, member, age = null, isLinked = true, locale = 'es') {
    const embedColor = "#FF69B4";
    const userAvatar = member.user.displayAvatarURL({ dynamic: true, size: 512 });

    const titleText = age 
        ? t(locale, 'cumple.announce_title_age', { age }) 
        : t(locale, 'cumple.announce_title');

    const embed = new EmbedBuilder()
        .setTitle(titleText)
        .setDescription(t(locale, 'cumple.announce_desc', { member: member.toString() }))
        .setColor(embedColor)
        .setThumbnail(userAvatar)
        .setTimestamp();

    if (!isLinked) {
        embed.setFooter({
            text: t(locale, 'cumple.announce_footer_unlinked'),
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        });
    } else {
        embed.setFooter({
            text: t(locale, 'cumple.announce_footer'),
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
