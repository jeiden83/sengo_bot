const BirthdayModel = require("../models/BirthdayModel.js");
const { doBirthdayAnnounceEmbed } = require("../views/birthdayViews.js");
const Logger = require("../utils/logger.js");

async function checkGuildBirthdays(guild, client) {
    const channelId = BirthdayModel.getGuildChannel(guild.id);
    if (!channelId) return [];

    const bdayList = await BirthdayModel.getGuildBirthdays(guild);
    if (bdayList.length === 0) return [];

    const now = new Date();
    let channel = null;
    const announcedTags = [];

    for (const bday of bdayList) {
        const userId = bday.userId;
        const countryCode = await BirthdayModel.getUserCountryCode(userId);
        const offset = BirthdayModel.getCountryUtcOffset(countryCode);

        // Calcular fecha local del usuario desplazando la marca de tiempo de Date.now()
        const localNow = new Date(now.getTime() + offset * 60 * 60 * 1000);
        const localDay = localNow.getUTCDate();
        const localMonth = localNow.getUTCMonth() + 1;
        const localYear = localNow.getUTCFullYear();

        // Verificar si hoy es el cumpleaños del usuario en su zona horaria
        if (localDay === bday.day && localMonth === bday.month) {
            const lastAnnouncedYear = BirthdayModel.getGuildUserAnnounced(guild.id, userId);
            if (lastAnnouncedYear === localYear) continue; // Ya felicitado este año

            // Carga perezosa del canal si tenemos un anuncio que hacer
            if (!channel) {
                channel = await client.channels.fetch(channelId).catch(() => null);
            }
            if (!channel) break; // Si el canal no es válido, salir

            Logger.system(`Anunciando cumpleaños de ${bday.member.user.tag} en el servidor ${guild.name} (#${channel.name})`);
            
            const age = bday.year ? localYear - bday.year : null;
            const isLinked = !!countryCode;
            const embed = doBirthdayAnnounceEmbed(client, bday.member, age, isLinked);

            await channel.send({
                content: `🎉 ¡Feliz cumpleaños, <@${userId}>! 🎂`,
                embeds: [embed]
            }).catch(err => {
                console.error(`Error al enviar mensaje de cumpleaños a ${bday.member.user.tag}:`, err);
            });

            // Registrar como anunciado este año en este servidor
            BirthdayModel.setGuildUserAnnounced(guild.id, userId, localYear);
            announcedTags.push(bday.member.user.tag);
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
        const guilds = client.guilds.cache;
        for (const [guildId, guild] of guilds) {
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
    client.once('ready', () => {
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
