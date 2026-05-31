const { PermissionFlagsBits } = require("discord.js");
const BirthdayModel = require("../../../models/BirthdayModel.js");
const { doBirthdayListEmbed, doBirthdayNextEmbed, doBirthdayPrevEmbed } = require("../../../views/birthdayViews.js");
const { t } = require("../../../utils/i18n.js");

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

function formatAgeInfo(day, month, year, isSelf, locale) {
    if (year === null) return "";
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const bdayThisYear = new Date(currentYear, month - 1, day);
    const todayMidnight = new Date(currentYear, now.getMonth(), now.getDate());
    const ageThisYear = currentYear - year;
    
    if (bdayThisYear < todayMidnight) {
        const ageNextYear = ageThisYear + 1;
        return isSelf 
            ? t(locale, 'cumple.age_this_year_self', { age: ageThisYear, nextAge: ageNextYear })
            : t(locale, 'cumple.age_this_year_other', { age: ageThisYear, nextAge: ageNextYear });
    } else if (bdayThisYear.getTime() === todayMidnight.getTime()) {
        return isSelf
            ? t(locale, 'cumple.age_today_self', { age: ageThisYear })
            : t(locale, 'cumple.age_today_other', { age: ageThisYear });
    } else {
        const currentAge = ageThisYear - 1;
        return isSelf
            ? t(locale, 'cumple.age_current_self', { age: currentAge, nextAge: ageThisYear })
            : t(locale, 'cumple.age_current_other', { age: currentAge, nextAge: ageThisYear });
    }
}

async function run(messages, args) {
    const { message, reply } = messages;
    const locale = message.locale || 'es';
    
    if (!BirthdayModel.getIsInitialized()) {
        return t(locale, 'cumple.loading');
    }

    const authorId = message.author.id;
    const guild = message.guild;

    // Filtrar argumentos nulos, indefinidos o vacíos (p. ej. causados por alias_args)
    const cleanArgs = (args || []).filter(arg => arg !== null && arg !== undefined && arg !== '');

    if (cleanArgs.length === 0) {
        return t(locale, 'cumple.help_msg');
    }

    const sub = cleanArgs[0].toLowerCase();

    // Error predictivo para cuando intentan usar comandos de ayuda
    if (sub === "ayuda" || sub === "help" || sub === "guia" || sub === "guía" || sub === "?") {
        return t(locale, 'cumple.err_sub_help');
    }

    // 1. Caso de configurar canal
    if (sub === "canal" || sub === "channel") {
        if (!guild) return t(locale, 'cumple.only_guild');
        
        const member = message.member || await guild.members.fetch(authorId).catch(() => null);
        if (!member) return t(locale, 'cumple.err_validate_member');
        
        const hasPermission = member.permissions.has(PermissionFlagsBits.ManageGuild) || 
                              member.permissions.has(PermissionFlagsBits.Administrator);
        if (!hasPermission) {
            return t(locale, 'cumple.err_no_permission');
        }

        if (!cleanArgs[1]) {
            const currentChannelId = BirthdayModel.getGuildChannel(guild.id);
            if (currentChannelId) {
                return t(locale, 'cumple.channel_current', { channelId: currentChannelId });
            }
            return t(locale, 'cumple.channel_none');
        }

        const channelArg = cleanArgs[1].toLowerCase();
        if (channelArg === "quitar" || channelArg === "desactivar" || channelArg === "none") {
            BirthdayModel.setGuildChannel(guild.id, null);
            return t(locale, 'cumple.channel_disabled');
        }

        let channelId = null;
        const match = cleanArgs[1].match(/^<#(\d+)>$/) || cleanArgs[1].match(/^(\d+)$/);
        if (match) {
            channelId = match[1];
        }

        if (!channelId) {
            return t(locale, 'cumple.channel_invalid');
        }

        const targetChannel = guild.channels.cache.get(channelId);
        if (!targetChannel) {
            return t(locale, 'cumple.channel_not_found');
        }

        BirthdayModel.setGuildChannel(guild.id, channelId);
        return t(locale, 'cumple.channel_success', { channelId });
    }

    // 2. Caso de eliminar cumpleaños
    if (sub === "quitar" || sub === "remove" || sub === "borrar" || sub === "delete") {
        const removed = BirthdayModel.removeUserBirthday(authorId);
        if (removed) {
            return t(locale, 'cumple.removed_success');
        }
        return t(locale, 'cumple.removed_none');
    }

    // 3. Caso de ver lista de cumpleaños
    if (sub === "lista" || sub === "list") {
        let isGlobalList = false;
        let pageArg = cleanArgs[1];
        
        // Comprobar si se pasa la flag -todos
        const hasTodosFlag = cleanArgs.some(arg => arg.toLowerCase() === "-todos");
        if (hasTodosFlag) {
            const ownerId = process.env.OWNER_ID;
            if (authorId !== ownerId) {
                return t(locale, 'cumple.err_todos_owner');
            }
            isGlobalList = true;
            // Filtrar la flag de los argumentos para extraer la página si existe
            const remainingArgs = cleanArgs.slice(1).filter(arg => arg.toLowerCase() !== "-todos");
            pageArg = remainingArgs[0];
        }

        if (!guild && !isGlobalList) return t(locale, 'cumple.only_guild');

        let bdayList = [];
        let listGuild = guild;
        
        if (isGlobalList) {
            listGuild = { isGlobal: true };
            const allUsers = BirthdayModel.getAllUsers();
            for (const [userId, info] of Object.entries(allUsers)) {
                bdayList.push({ userId, ...info });
            }
            // Ordenar de forma cronológica por mes, luego día
            bdayList.sort((a, b) => {
                if (a.month !== b.month) return a.month - b.month;
                if (a.day !== b.day) return a.day - b.day;
                return a.userId.localeCompare(b.userId);
            });
        } else {
            bdayList = await BirthdayModel.getGuildBirthdays(guild);
        }
        
        if (bdayList.length === 0) {
            const embed = doBirthdayListEmbed(message, listGuild, bdayList, 1, locale);
            return { embeds: [embed] };
        }

        // Agrupar por mes para calcular total de páginas
        const grouped = {};
        for (let i = 0; i < 12; i++) {
            grouped[i] = [];
        }
        bdayList.forEach(item => {
            grouped[item.month - 1].push(item);
        });
        const monthsWithBdays = [];
        for (let i = 0; i < 12; i++) {
            if (grouped[i].length > 0) {
                monthsWithBdays.push(i);
            }
        }
        const pageSize = 4;
        const totalPages = Math.ceil(monthsWithBdays.length / pageSize) || 1;

        let pageNum = parseInt(pageArg) || 1;
        if (pageNum < 1) pageNum = 1;
        if (pageNum > totalPages) pageNum = totalPages;

        const initialEmbed = doBirthdayListEmbed(message, listGuild, bdayList, pageNum, locale);

        const { buildPaginationRow } = require("../../../views/osuViewHelpers.js");
        const getButtonsRow = (current) => {
            return buildPaginationRow({
                prefix: 'cumple',
                current: current,
                total: totalPages,
                oneIndexed: true,
                customSuffixes: { first: 'first', prev: 'prev', next: 'next', last: 'last' }
            });
        };

        const sendOptions = {
            embeds: [initialEmbed]
        };

        if (totalPages > 1) {
            sendOptions.components = [getButtonsRow(pageNum)];
        }

        let sent_message;
        if (reply) {
            sent_message = await reply.reply(sendOptions);
        } else {
            sent_message = await message.channel.send(sendOptions);
        }

        if (totalPages <= 1) return;

        const btnFilter = btnInt => btnInt.user.id === message.author.id;
        const collector = sent_message.createMessageComponentCollector({
            filter: btnFilter,
            idle: 45000
        });

        collector.on('collect', async i => {
            try {
                await i.deferUpdate();

                if (i.customId === 'cumple_first') {
                    pageNum = 1;
                } else if (i.customId === 'cumple_prev') {
                    pageNum = Math.max(1, pageNum - 1);
                } else if (i.customId === 'cumple_next') {
                    pageNum = Math.min(totalPages, pageNum + 1);
                } else if (i.customId === 'cumple_last') {
                    pageNum = totalPages;
                }

                const updatedEmbed = doBirthdayListEmbed(message, listGuild, bdayList, pageNum, locale);

                await i.editReply({
                    embeds: [updatedEmbed],
                    components: [getButtonsRow(pageNum)]
                });
            } catch (err) {
                console.error("Error al navegar la lista de cumpleaños:", err);
            }
        });

        collector.on('end', async () => {
            try {
                await sent_message.edit({ components: [] });
            } catch {}
        });

        return;
    }

    // 3.5 Caso de actualizar/chequear cumpleaños (Moderación/Admin)
    if (sub === "actualizar" || sub === "update" || sub === "check" || sub === "revisar") {
        if (!guild) return t(locale, 'cumple.only_guild');

        const member = message.member || await guild.members.fetch(authorId).catch(() => null);
        if (!member) return t(locale, 'cumple.err_validate_member');
        
        const hasPermission = member.permissions.has(PermissionFlagsBits.ManageGuild) || 
                              member.permissions.has(PermissionFlagsBits.Administrator);
        if (!hasPermission) {
            return t(locale, 'cumple.err_force_permission');
        }

        const channelId = BirthdayModel.getGuildChannel(guild.id);
        if (!channelId) {
            return t(locale, 'cumple.err_force_no_channel');
        }

        const { checkGuildBirthdays } = require("../../../services/birthdayAnnouncer.js");
        const announcedTags = await checkGuildBirthdays(guild, message.client);

        if (announcedTags.length > 0) {
            return t(locale, 'cumple.force_announced', { names: announcedTags.join(", ") });
        }

        return t(locale, 'cumple.force_none');
    }

    // 4. Caso de ver siguiente cumpleaños
    if (sub === "siguiente" || sub === "next" || sub === "proximo" || sub === "próximo") {
        if (!guild) return t(locale, 'cumple.only_guild');
        const nextData = await BirthdayModel.getNextBirthdays(guild, new Date());
        const embed = doBirthdayNextEmbed(message, guild, nextData, locale);
        return { embeds: [embed] };
    }

    // 5. Caso de ver cumpleaños anterior
    if (sub === "anterior" || sub === "prev" || sub === "pasado") {
        if (!guild) return t(locale, 'cumple.only_guild');
        const prevData = await BirthdayModel.getPrevBirthdays(guild, new Date());
        const embed = doBirthdayPrevEmbed(message, guild, prevData, locale);
        return { embeds: [embed] };
    }

    // 6. Caso de añadir cumpleaños de otro usuario (Solo Owner)
    if (sub === "añadir" || sub === "add") {
        const ownerId = process.env.OWNER_ID;
        if (authorId !== ownerId) {
            return t(locale, 'cumple.err_owner_only');
        }

        const targetArg = cleanArgs[1];
        const dateArg = cleanArgs[2];

        if (!targetArg || !dateArg) {
            return t(locale, 'cumple.add_usage');
        }

        // Extraer ID de usuario (mención o ID numérica)
        const match = targetArg.match(/^<@!?(\d+)>$/) || targetArg.match(/^(\d+)$/);
        if (!match) {
            return t(locale, 'cumple.add_invalid_user');
        }
        const targetUserId = match[1];

        // Validar que el usuario exista
        let targetUser = null;
        if (guild) {
            const member = await guild.members.fetch(targetUserId).catch(() => null);
            if (member) {
                targetUser = member.user;
            }
        }
        if (!targetUser) {
            targetUser = await message.client.users.fetch(targetUserId).catch(() => null);
        }
        if (!targetUser) {
            return t(locale, 'cumple.add_user_not_found');
        }

        const parsedDate = parseBirthday(dateArg);
        if (!parsedDate) {
            return t(locale, 'cumple.add_invalid_date');
        }

        const { day, month, year } = parsedDate;
        BirthdayModel.setUserBirthday(targetUserId, day, month, year);
        const yearStr = year ? `/${year}` : '';
        const ageInfo = formatAgeInfo(day, month, year, false, locale);
        return {
            content: t(locale, 'cumple.add_success', { userId: targetUserId, date: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}${yearStr}`, ageInfo }),
            allowedMentions: { users: [] }
        };
    }

    // 7. Caso de establecer cumpleaños (por comando explícito o atajo)
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
        const ageInfo = formatAgeInfo(day, month, year, true, locale);
        return t(locale, 'cumple.set_success', { date: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}${yearStr}`, ageInfo });
    }

    // Si falló el parsing y usó el subcomando set
    if (isSetSubcommand) {
        return t(locale, 'cumple.set_invalid_date');
    }

    // Caso de comando no reconocido
    return t(locale, 'cumple.err_unrecognized');
}

run.description = {
    header: t('es', 'commands.cumple.header'),
    body: t('es', 'commands.cumple.body'),
    usage: t('es', 'commands.cumple.usage')
};

module.exports = { run, description: run.description };
