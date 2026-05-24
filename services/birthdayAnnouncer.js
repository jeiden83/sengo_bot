const BirthdayModel = require("../models/BirthdayModel.js");
const { doBirthdayAnnounceEmbed } = require("../views/birthdayViews.js");
const Logger = require("../utils/logger.js");

/**
 * Realiza la comprobación de cumpleaños para todos los servidores configurados.
 * @param {Client} client - Cliente de Discord.js.
 */
async function checkBirthdays(client) {
    try {
        const now = new Date();
        const day = now.getDate();
        const month = now.getMonth() + 1; // 1-indexed
        const currentDateStr = `${now.getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        const todayBirthdays = BirthdayModel.getBirthdaysToday(day, month);
        if (todayBirthdays.length === 0) {
            return;
        }

        // Obtener todos los servidores en los que está el bot
        const guilds = client.guilds.cache;
        for (const [guildId, guild] of guilds) {
            const channelId = BirthdayModel.getGuildChannel(guildId);
            if (!channelId) continue;

            const lastAnnounced = BirthdayModel.getGuildLastAnnounced(guildId);
            if (lastAnnounced === currentDateStr) continue;

            // Encontrar qué cumpleañeros están en este servidor
            const birthdaysInGuild = [];
            for (const item of todayBirthdays) {
                const member = await guild.members.fetch(item.userId).catch(() => null);
                if (member) {
                    birthdaysInGuild.push({ member, ...item });
                }
            }

            if (birthdaysInGuild.length > 0) {
                const channel = await client.channels.fetch(channelId).catch(() => null);
                if (channel) {
                    Logger.system(`Anunciando cumpleaños en el servidor ${guild.name} (#${channel.name})`);
                    for (const { member, year } of birthdaysInGuild) {
                        const age = year ? now.getFullYear() - year : null;
                        const embed = doBirthdayAnnounceEmbed(client, member, age);
                        
                        await channel.send({
                            content: `🎉 ¡Feliz cumpleaños, <@${member.id}>! 🎂`,
                            embeds: [embed]
                        }).catch(err => {
                            console.error(`Error al enviar mensaje de cumpleaños a ${member.user.tag}:`, err);
                        });
                    }
                }
            }

            // Marcar como anunciado hoy para este servidor para evitar duplicados
            BirthdayModel.setGuildLastAnnounced(guildId, currentDateStr);
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
    initBirthdayAnnouncer
};
