const { getOsuUser } = require("../../utils/osu.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const country_codes = require("../../../src/country_codes.json");
const { t } = require("../../../utils/i18n.js");
const { doOsuIdentityEmbed } = require("../../../views/osuUserViews.js");
const CONFIG = require("../../../config.js");

async function run(messages, args) {
    const { message, res } = messages;
    const locale = message.locale || 'es';

    if (!message.guild) {
        return t(locale, 'identidad.err_guild_only');
    }

    if (message.guild.id !== "1422374224403890268" && message.author.id !== CONFIG.OWNER_ID) {
        return t(locale, 'identidad.err_wrong_guild');
    }

    const discord_id = message.author.id;

    // Buscar el usuario linkeado con el bot
    const user_found = await OsuUserModel.getLinkedUser(res.User, discord_id);
    if (!user_found) return t(locale, 'identidad.err_not_linked');

    // Verificar vinculación OAuth
    const oauth_record = await OsuUserModel.getOAuthTokenRecord(discord_id);
    if (!oauth_record) return t(locale, 'identidad.err_not_oauth');

    // Obtener datos del usuario de osu!
    const osu_user = await getOsuUser({
        "username": [user_found.osu_id],
        "gamemode": user_found.main_gamemode == "std" ? "osu" : user_found.main_gamemode
    });

    const results = {
        countryStatus: "",
        digitsStatus: ""
    };

    // --- PARTE 1: Asignación del rol de PAÍS ---
    const countryCode = osu_user.country_code;
    const countryRoleNames = Object.keys(country_codes).map(code => `[ ${code} ] ${country_codes[code].country}`);
    const userHasCountryRole = message.member.roles.cache.some(r => countryRoleNames.includes(r.name));

    if (userHasCountryRole) {
        const existingRole = message.member.roles.cache.find(r => countryRoleNames.includes(r.name));
        results.countryStatus = t(locale, 'identidad.country_already_has', { roleName: existingRole.name });
    } else {
        // Buscar si el rol de país ya existe en el servidor
        const existingCountryRole = message.guild.roles.cache.find(r => r.name.includes(`[ ${countryCode} ]`));

        if (existingCountryRole) {
            try {
                await message.member.roles.add(existingCountryRole);
                results.countryStatus = t(locale, 'identidad.country_assigned', { roleName: existingCountryRole.name });
            } catch (error) {
                console.error("[IDENTIDAD] Error al asignar rol de país existente:", error);
                results.countryStatus = t(locale, 'identidad.country_err_assign', { roleName: existingCountryRole.name });
            }
        } else {
            // Crear el rol de país
            const country_info = country_codes[countryCode];
            const role_name = `[ ${countryCode} ] ${country_info ? country_info.country : osu_user.country.name}`;

            try {
                let role_position = 0;
                const reference_role = message.guild.roles.cache.find(r => r.name.includes("Modo de juego"));
                if (reference_role) {
                    role_position = reference_role.position;
                }

                const created_role = await message.guild.roles.create({
                    name: role_name,
                    color: country_info ? country_info.color : "#FFFF00",
                    mentionable: false,
                    reason: t(locale, 'pais.reason_create', { code: countryCode }),
                });

                if (role_position > 0) {
                    await created_role.setPosition(role_position);
                }

                await message.member.roles.add(created_role);
                results.countryStatus = t(locale, 'identidad.country_created', { roleName: role_name });
            } catch (error) {
                console.error("[IDENTIDAD] Error al crear rol de país:", error);
                results.countryStatus = t(locale, 'identidad.country_err_create', { country: countryCode });
            }
        }
    }

    // --- PARTE 2: Asignación del rol de DÍGITOS ---
    const globalRank = osu_user.statistics.global_rank;
    const rankDigits = String(globalRank).length;
    const digitsNormalized = `${rankDigits} digito`;

    // Verificar si ya tiene un rol de dígitos
    const hasDigitsRole = message.member.roles.cache.some(r => {
        const nameNorm = r.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return nameNorm.includes(digitsNormalized);
    });

    if (hasDigitsRole) {
        results.digitsStatus = t(locale, 'identidad.digits_already_has', { digits: rankDigits });
    } else if (rankDigits === 7) {
        results.digitsStatus = t(locale, 'identidad.digits_err_seven');
    } else if (rankDigits === 1) {
        results.digitsStatus = t(locale, 'identidad.digits_one_digit');
    } else {
        // Buscar el rol de dígitos en el servidor
        const roleToAssign = message.guild.roles.cache.find(r => {
            const nameNorm = r.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            return nameNorm.includes(digitsNormalized);
        });

        if (!roleToAssign) {
            results.digitsStatus = t(locale, 'identidad.digits_err_not_found', { digits: rankDigits });
        } else {
            try {
                await message.member.roles.add(roleToAssign);
                results.digitsStatus = t(locale, 'identidad.digits_assigned', { digits: rankDigits, roleName: roleToAssign.name });
            } catch (error) {
                console.error("[IDENTIDAD] Error al asignar rol de dígitos:", error);
                results.digitsStatus = t(locale, 'identidad.digits_err_assign', { digits: rankDigits });
            }
        }
    }

    // Construir el embed con los resultados
    const embed = doOsuIdentityEmbed(message, osu_user, results, locale);

    await message.channel.send({ embeds: [embed] });
}

run.description = {
    'header': t('es', 'commands.identidad.header'),
    'body': t('es', 'commands.identidad.body'),
    'usage': t('es', 'commands.identidad.usage')
};

run.requireOAuth = true;

module.exports = { run, description: run.description };
