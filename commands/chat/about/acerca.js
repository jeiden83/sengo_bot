const { doAboutEmbed, buildAboutNavigationRows } = require("../../../views/generalViews.js");

async function run(messages, args) {
    const { message, reply } = messages;

    const initialEmbed = doAboutEmbed(message, 0);
    const initialRows = buildAboutNavigationRows(0);

    const sendOptions = {
        embeds: [initialEmbed],
        components: initialRows
    };

    let sentMessage;
    if (reply) {
        sentMessage = await reply.reply(sendOptions);
    } else {
        sentMessage = await message.channel.send(sendOptions);
    }

    if (!sentMessage) return;

    const collector = sentMessage.createMessageComponentCollector({
        idle: 60000 // 60 segundos de inactividad
    });

    collector.on('collect', async i => {
        if (i.user.id !== message.author.id) {
            return i.reply({
                content: "❌ Solo la persona que ejecutó el comando puede usar esta navegación.",
                ephemeral: true
            }).catch(() => {});
        }

        try {
            await i.deferUpdate();

            const pageIndex = parseInt(i.customId.replace("about_page_", ""), 10);
            if (isNaN(pageIndex)) return;

            const nextEmbed = doAboutEmbed(message, pageIndex);
            const nextRows = buildAboutNavigationRows(pageIndex);

            await i.editReply({
                embeds: [nextEmbed],
                components: nextRows
            });
        } catch (err) {
            console.error("Error al navegar páginas de acerca/about:", err);
        }
    });

    collector.on('end', async () => {
        try {
            await sentMessage.edit({ components: [] });
        } catch (e) {
            // Ignorar errores si el mensaje fue eliminado
        }
    });
}

run.alias = {
    "about": {
        "args": null
    }
}

run.description = {
    'header': 'Acerca de Sengo',
    'body': 'Muestra información sobre Sengo y las características que lo hacen único frente a otros bots.',
    'usage': undefined
}

module.exports = { run };
