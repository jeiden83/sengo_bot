const { getOsuUser } = require("../../utils/osu.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const country_codes = require("../../../src/country_codes.json");
const { t } = require("../../../utils/i18n.js");

const CONFIG = require("../../../config.js");

async function run(messages, args) {
    const { message, res } = messages;
    const locale = message.locale || 'es';

    if (!message.guild) {
        return t(locale, 'pais.err_guild_only');
    }

    if (message.guild.id !== "1422374224403890268" && message.author.id !== CONFIG.OWNER_ID) {
        return t(locale, 'pais.err_wrong_guild');
    }

    // Obtenemos el discord id del usuario que dio el comando
    const discord_id = message.author.id;

    // Buscar el usuario linkeado con el bot 
    const user_found = await OsuUserModel.getLinkedUser(res.User, discord_id);

    // Si no está linkeado al bot
    if (!user_found) return t(locale, 'pais.err_not_linked');

    // Verificar si está vinculado por OAuth
    const oauth_record = await OsuUserModel.getOAuthTokenRecord(discord_id);
    if (!oauth_record) return t(locale, 'pais.err_not_oauth');

    // Obtener el usuario de osu
    const osu_user = await getOsuUser({ "username": [user_found.osu_id], "gamemode": user_found.main_gamemode == "std" ? "osu" : user_found.main_gamemode });

    // Obtener los roles del servidor
    const role = message.guild.roles.cache.find(r => r.name.includes(`[ ${osu_user.country_code} ]`));

    // Revisar si el usuario ya tiene un rol de país
    const countryRoleNames = Object.keys(country_codes).map(code => `[ ${code} ] ${country_codes[code].country}`);
    const userHasCountryRole = message.member.roles.cache.some(r => countryRoleNames.includes(r.name));

    if (userHasCountryRole) {
        return t(locale, 'pais.err_already_has_role');
    }

    // Revisar si el rol de país ya está en el servidor
    if (role) {
        try {
            await message.member.roles.add(role);
            return t(locale, 'pais.success_assign');
        } catch (error) {
            console.error(error);
            return t(locale, 'pais.err_assign');
        }
    } else {
        // Si el rol no existe, crearlo
        // Obtener la información del país desde country_codes usando el código del país
        const country_info = country_codes[osu_user.country_code];

        // Crear el nombre del rol con el formato adecuado, y si no esta en el JSON pues tomarlo de los datos del usuario
        const role_name = `[ ${osu_user.country_code} ] ${country_info ? country_info.country : osu_user.country.name}`;

        try {
            let role_position = 0; // Posición por defecto

            const reference_role = message.guild.roles.cache.find(r => r.name.includes("Modo de juego")); // ROL DE REFERENCIA
            if (reference_role) {
                role_position = reference_role.position; // Poner el nuevo rol justo debajo
            }

            // Crear el rol con el color adecuado
            const created_role = await message.guild.roles.create({
                name: role_name,
                color: country_info ? country_info.color : "#FFFF00",
                mentionable: false,
                reason: t(locale, 'pais.reason_create', { code: osu_user.country_code }),
            });

            // Si se encontró un rol de referencia, mover el nuevo rol a la posición adecuada
            if (role_position > 0) {
                await created_role.setPosition(role_position);
            }

            // Asignar el rol al usuario
            await message.member.roles.add(created_role);

            return t(locale, 'pais.success_create_assign');
        } catch (error) {
            console.error(error);
            return t(locale, 'pais.err_create_assign');
        }
    }
}

run.description = {
    'header': t('es', 'commands.pais.header'),
    'body': t('es', 'commands.pais.body'),
    'usage': t('es', 'commands.pais.usage')
};

module.exports = { run, description: run.description };