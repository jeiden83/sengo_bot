const { doAboutEmbed, buildAboutNavigationRows } = require("../../../views/generalViews.js");
const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message, reply } = messages;
    const locale = message.locale || 'es';
    const prefix = message.content && message.content.startsWith("sd.") ? "sd." : "s.";

    const initialEmbed = doAboutEmbed(message, 0, locale, prefix);
    const initialRows = buildAboutNavigationRows(0, locale);

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
                content: t(locale, 'about.only_author'),
                ephemeral: true
            }).catch(() => {});
        }

        try {
            await i.deferUpdate();

            const pageIndex = parseInt(i.customId.replace("about_page_", ""), 10);
            if (isNaN(pageIndex)) return;

            const nextEmbed = doAboutEmbed(message, pageIndex, locale, prefix);
            const nextRows = buildAboutNavigationRows(pageIndex, locale);

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
    'header': t('es', 'commands.acerca.header'),
    'body': t('es', 'commands.acerca.body'),
    'usage': t('es', 'commands.acerca.usage')
}

module.exports = { run };
