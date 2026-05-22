const { PermissionsBitField, EmbedBuilder } = require('discord.js');
const { addWebhookChannel, deleteWebhookChannel, getWebhookChannels } = require('../../../db/database.js');

async function run(messages, args) {
    const { message, res, logger } = messages;
    const { Webhook } = res;

    // 1. Caso especial: Flag secreto -l para el Owner
    if (args.includes('-l')) {
        if (message.author.id !== process.env.OWNER_ID) {
            return "❌ No tienes permisos para usar este flag secreto.";
        }

        try {
            if (logger) logger.process("Listando canales de webhook registrados en la BD");
            const channels = await getWebhookChannels(Webhook);

            if (channels.length === 0) {
                return "ℹ️ SengoBot no está escuchando webhooks en ningún canal actualmente.";
            }

            const embed = new EmbedBuilder()
                .setTitle("📋 Canales Activos de GitHub Webhook")
                .setColor("#24292e")
                .setTimestamp()
                .setFooter({ text: "SengoBot Admin", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" });

            let description = "";
            channels.forEach((ch, index) => {
                description += `**${index + 1}.** Servidor: \`${ch.guild_name || 'Desconocido'}\` | Canal: <#${ch.channel_id}> (\`${ch.channel_id}\`)\n`;
            });
            embed.setDescription(description);

            return { embeds: [embed] };
        } catch (err) {
            console.error("Error al listar webhooks:", err);
            return `❌ Hubo un error al obtener la lista de webhooks: \`${err.message}\``;
        }
    }

    // El comando normal requiere estar en un servidor
    if (!message.guild) {
        return "❌ Este comando solo se puede usar dentro de un servidor.";
    }

    // 2. Comprobar permisos de administrador
    if (!message.member || !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return "❌ Solo los usuarios con permisos de **Administrador** pueden usar este comando.";
    }

    const action = args[0] ? args[0].toLowerCase() : null;

    if (!action || (action !== 'colocar' && action !== 'borrar')) {
        return `❌ Acción inválida. Uso correcto:\n> \`s.github colocar [canal]\` (registra el canal para recibir commits)\n> \`s.github borrar [canal]\` (elimina el canal de la lista)`;
    }

    // 3. Obtener el canal (por mención, ID, o por defecto el canal actual)
    let targetChannel = message.channel;
    if (args[1]) {
        const channelId = args[1].replace(/[<#>]/g, '');
        const guildChannel = message.guild.channels.cache.get(channelId);
        if (guildChannel) {
            targetChannel = guildChannel;
        } else {
            return `❌ No se pudo encontrar el canal especificado en este servidor.`;
        }
    }

    if (!targetChannel.isTextBased()) {
        return "❌ El canal seleccionado debe ser un canal de texto.";
    }

    if (action === 'colocar') {
        try {
            if (logger) logger.process(`Registrando canal ${targetChannel.id} para GitHub Webhook`);
            const dbResult = await addWebhookChannel(Webhook, targetChannel.id, message.guild.id, message.guild.name, targetChannel.name);
            
            if (dbResult.status === 1) {
                return `✅ **¡Éxito!** SengoBot ahora mandará las actualizaciones de commits de GitHub al canal <#${targetChannel.id}>.`;
            } else {
                return `❌ Hubo un error al registrar el canal en la base de datos.`;
            }
        } catch (err) {
            console.error("Error registrando canal de webhook:", err);
            return `❌ Error al colocar el webhook: \`${err.message}\``;
        }
    }

    if (action === 'borrar') {
        try {
            if (logger) logger.process(`Eliminando canal ${targetChannel.id} de GitHub Webhook`);
            const dbResult = await deleteWebhookChannel(Webhook, targetChannel.id);
            
            if (dbResult.status === 1) {
                return `✅ **¡Éxito!** SengoBot ha dejado de escuchar actualizaciones de GitHub en el canal <#${targetChannel.id}>.`;
            } else if (dbResult.status === 0) {
                return `ℹ️ El canal <#${targetChannel.id}> no estaba registrado para actualizaciones de GitHub.`;
            } else {
                return `❌ Hubo un error al eliminar el canal de la base de datos.`;
            }
        } catch (err) {
            console.error("Error eliminando canal de webhook:", err);
            return `❌ Error al borrar el webhook: \`${err.message}\``;
        }
    }
}

run.description = {
    'header': "Configura las notificaciones de GitHub mediante webhooks",
    'body': 'Permite a los administradores registrar, borrar y listar canales para recibir las notificaciones de commits en GitHub.',
    'usage': 's.github colocar [canal] : Registra un canal para recibir actualizaciones (por defecto el actual).\ns.github borrar [canal] : Deja de escuchar commits en el canal especificado.'
};

module.exports = { run, description: run.description };
