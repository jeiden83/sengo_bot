const { getOsuUser } = require("../../utils/osu.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const { t } = require("../../../utils/i18n.js");
const CONFIG = require("../../../config.js");

async function run(messages, args) {
    const { message, res } = messages;
    const locale = message.locale || 'es';

    if (!message.guild) {
        return t(locale, 'digitos.err_guild_only');
    }

    if (message.guild.id !== "1422374224403890268" && message.author.id !== CONFIG.OWNER_ID) {
        return t(locale, 'digitos.err_wrong_guild');
    }

    // Obtenemos el discord id del usuario que dio el comando
    const discord_id = message.author.id;

    // Buscar el usuario linkeado con el bot 
    const user_found = await OsuUserModel.getLinkedUser(res.User, discord_id);

    // Si no está linkeado al bot
    if (!user_found) return t(locale, 'digitos.err_not_linked');

    // Obtener el usuario de osu
    const osu_user = await getOsuUser({ "username": [user_found.osu_id], "gamemode": user_found.main_gamemode });

    // String a comparar de los digitos
    const rankDigits = String(osu_user.statistics.global_rank).length;
    const digitsString = `${rankDigits} Digitos`;

    // Si el usuario ya tiene un rol de esos digitos, evitar asignar otro
    if (message.member.roles.cache.find(r => r.name.includes(digitsString))) {
        return t(locale, 'digitos.err_already_has_role', { digits: rankDigits });
    }

    // Si el usuario es 7 digitos.
    if (rankDigits === 7) {
        return t(locale, 'digitos.err_seven_digits');
    }
    if (rankDigits === 1) {
        return t(locale, 'digitos.one_digit');
    }

    // Si no tiene el rol, asignar el rol al usuario
    try {
        await message.member.roles.add(message.guild.roles.cache.find(r => r.name.includes(digitsString)));
        return t(locale, 'digitos.success', { digits: rankDigits });
    } catch (error) {
        console.error(error);
        return t(locale, 'digitos.err_assign');
    }
}

run.alias = {
    "digits": {
        "args": ""
    },
};

run.description = {
    'header': t('es', 'commands.digitos.header'),
    'body': t('es', 'commands.digitos.body'),
    'usage': t('es', 'commands.digitos.usage')
};

module.exports = { run, description: run.description };