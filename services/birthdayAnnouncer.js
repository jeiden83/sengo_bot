const BirthdayModel = require("../models/BirthdayModel.js");
const { doBirthdayAnnounceEmbed } = require("../views/birthdayViews.js");
const Logger = require("../utils/logger.js");
const { Events } = require('discord.js');
const { getGuildLanguage } = require("../models/GuildConfigModel.js");
const { t } = require("../utils/i18n.js");

async function checkGuildBirthdays(guild, client) {
    const channelId = BirthdayModel.getGuildChannel(guild.id);
    const roleId = BirthdayModel.getGuildRole(guild.id);
    if (!channelId && !roleId) return [];

    const bdayList = await BirthdayModel.getGuildBirthdays(guild);
    if (bdayList.length === 0) return [];

    let birthdayRoleObj = null;
    if (roleId) {
        birthdayRoleObj = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    }

    const now = new Date();
    let channel = null;
    const announcedTags = [];
    const guildLocale = await getGuildLanguage(guild.id);

    for (const bday of bdayList) {
        const userId = bday.userId;
        const countryCode = await BirthdayModel.getUserCountryCode(userId);
        const offset = BirthdayModel.getCountryUtcOffset(countryCode);

        // Calcular fecha local del usuario desplazando la marca de tiempo de Date.now()
        const localNow = new Date(now.getTime() + offset * 60 * 60 * 1000);
        const localDay = localNow.getUTCDate();
        const localMonth = localNow.getUTCMonth() + 1;
        const localYear = localNow.getUTCFullYear();

        const isBirthdayToday = (localDay === bday.day && localMonth === bday.month);

        if (isBirthdayToday) {
            // Asignar rol de cumpleaños si está configurado
            if (birthdayRoleObj && bday.member) {
                if (!bday.member.roles.cache.has(roleId)) {
                    await bday.member.roles.add(birthdayRoleObj)
                        .catch(err => console.error(`[BirthdayService] Error al asignar rol de cumpleaños a ${bday.member.user.tag}:`, err.message));
                }
            }

            // Anunciar cumpleaños si hay un canal configurado
            if (channelId) {
                const lastAnnouncedYear = BirthdayModel.getGuildUserAnnounced(guild.id, userId);
                if (lastAnnouncedYear !== localYear) {
                    // Carga perezosa del canal si tenemos un anuncio que hacer
                    if (!channel) {
                        channel = await client.channels.fetch(channelId).catch(() => null);
                    }
                    if (channel) {
                        Logger.system(`Anunciando cumpleaños de ${bday.member.user.tag} en el servidor ${guild.name} (#${channel.name})`);
                        
                        const age = bday.year ? localYear - bday.year : null;
                        const isLinked = !!countryCode;
                        const embed = doBirthdayAnnounceEmbed(client, bday.member, age, isLinked, guildLocale);

                        await channel.send({
                            content: t(guildLocale, 'cumple.announce_ping', { userId }),
                            embeds: [embed]
                        }).catch(err => {
                            console.error(`Error al enviar mensaje de cumpleaños a ${bday.member.user.tag}:`, err);
                        });

                        // Registrar como anunciado este año en este servidor
                        BirthdayModel.setGuildUserAnnounced(guild.id, userId, localYear);
                        announcedTags.push(bday.member.user.tag);
                    }
                }
            }
        } else {
            // Quitar rol de cumpleaños si está configurado y el usuario lo tiene
            if (birthdayRoleObj && bday.member) {
                if (bday.member.roles.cache.has(roleId)) {
                    await bday.member.roles.remove(birthdayRoleObj)
                        .catch(err => console.error(`[BirthdayService] Error al quitar rol de cumpleaños a ${bday.member.user.tag}:`, err.message));
                }
            }
        }
    }

    return announcedTags;
}

/**
 * Realiza la comprobación de cumpleaños para todos los servidores configurados.
 * @param {Client} client - Cliente de Discord.js.
 */
async function checkBirthdays(client) {
    try {
        if (!BirthdayModel.getIsInitialized()) {
            Logger.system("Evitando comprobación de cumpleaños: BirthdayModel aún no se ha sincronizado con Supabase.");
            return;
        }
        const guilds = client.guilds.cache;
        for (const [, guild] of guilds) {
            await checkGuildBirthdays(guild, client);
        }
    } catch (error) {
        console.error("Error en la tarea de verificación de cumpleaños:", error);
    }
}

/**
 * Inicializa el servicio de anuncios automáticos de cumpleaños.
 * @param {Client} client - Cliente de Discord.js.
 */
function initBirthdayAnnouncer(client) {
    Logger.system("Inicializando servicio de anuncios de cumpleaños...");
    
    // Comprobar al iniciar tras un breve delay para asegurar que los canales/guilds estén cargados
    client.once(Events.ClientReady, () => {
        setTimeout(() => {
            checkBirthdays(client);
        }, 10000); // 10 segundos después del ready
    });

    // Programar comprobación cada 1 hora
    setInterval(() => {
        checkBirthdays(client);
    }, 60 * 60 * 1000); // 1 hora
}

module.exports = {
    initBirthdayAnnouncer,
    checkGuildBirthdays
};
