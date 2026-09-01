const { doInviteEmbed, buildInviteRow } = require("../../../views/generalViews.js");
const { t } = require("../../../utils/i18n.js");
const config = require("../../../config.js");

function getInviteUrl(client) {
    const clientId = (client && client.user ? client.user.id : null) || config.CLIENT_ID || process.env.CLIENT_ID || "1064201701210468454";
    return `https://discord.com/oauth2/authorize?client_id=${clientId}`;
}

async function run(messages, args) {
    const { message, reply } = messages;
    const locale = message.locale || 'es';
    const client = message.client;
    const inviteUrl = getInviteUrl(client);

    const embed = doInviteEmbed(message, locale, inviteUrl);
    const row = buildInviteRow(locale, inviteUrl);

    const sendOptions = {
        embeds: [embed],
        components: [row]
    };

    if (reply) {
        return await reply.reply(sendOptions);
    } else {
        return await message.channel.send(sendOptions);
    }
}

run.alias = {
    "invitar": {
        "args": null
    },
    "botinvite": {
        "args": null
    }
};

run.description = {
    'header': t('es', 'commands.invite.header'),
    'body': t('es', 'commands.invite.body'),
    'usage': t('es', 'commands.invite.usage')
};

module.exports = { run, getInviteUrl };
