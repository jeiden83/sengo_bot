const { PermissionsBitField, Collection } = require('discord.js');
const { t } = require('../../../utils/i18n.js');
const { 
    doRoleColorChangedEmbed, 
    doRoleGrantedEmbed, 
    doRoleMassiveProcessEmbed 
} = require('../../../views/roleViews.js');

async function cambiar_color(message, args, locale) {
    if (!args[1]) return t(locale, 'rol.error_need_id');

    const rol = message.guild.roles.cache.get(args[1]);

    if (!rol) {
        const error_msj = t(locale, 'rol.error_role_not_found');
        return t(locale, 'rol.error_generic', { error: error_msj, details: args[1] });
    }

    const colores = { "primaryColor": `#${args[2]}` };

    if (args[3]) colores["secondaryColor"] = `#${args[3]}`;
    if (args[4]) colores["tertiaryColor"] = `#${args[4]}`;

    try {
        await rol.setColors(colores);
    } catch (error) {
        let error_msj = 'Desconocido';
        if (error instanceof TypeError && error.code == 'ColorConvert') error_msj = t(locale, 'rol.error_invalid_hex');
        else if (error.code == 670006) error_msj = t(locale, 'rol.error_no_holographic');
        else error_msj = error.message || String(error);

        console.error(error);
        return t(locale, 'rol.error_generic', { error: error_msj, details: error });
    }

    const embed = doRoleColorChangedEmbed({
        rol,
        colorHex: `#${args[2]}` || message.member.roles.highest.color,
        locale
    });

    return {
        embeds: [embed]
    };
}

async function otorgar(message, args, locale) {
    const rol = message.guild.roles.cache.get(args[1]);

    if (!rol) {
        const error_msj = t(locale, 'rol.error_role_not_found');
        return t(locale, 'rol.error_generic', { error: error_msj, details: args[1] });
    }

    try {
        const miembro = await message.guild.members.fetch(args[2]);

        const hasRole = miembro.roles.cache.has(rol.id);
        if (!hasRole) {
            await miembro.roles.add(rol);
        } else {
            await miembro.roles.remove(rol);
        }

        const embed = doRoleGrantedEmbed({
            miembro,
            rol,
            isGranted: !hasRole,
            locale
        });

        return {
            embeds: [embed]
        };

    } catch (error) {
        let error_msj = error.message || String(error);
        if (error.code == 10013) error_msj = t(locale, 'rol.error_user_not_found');
        else if (error.code == 50001) error_msj = t(locale, 'rol.error_missing_permissions');
        return t(locale, 'rol.error_generic', { error: error_msj, details: error });
    }
}

async function otorgarTodos(message, args, locale) {
    const rol = message.guild.roles.cache.get(args[1]);

    if (!rol) {
        const error_msj = t(locale, 'rol.error_role_not_found');
        return t(locale, 'rol.error_generic', { error: error_msj, details: args[1] });
    }

    const miembros = await message.guild.members.fetch();
    
    let otorgados = 0;
    let removidos = 0;
    let errores = 0;

    for (const [id, miembro] of miembros) {
        if (miembro.user.bot) continue;

        try {
            const tieneRol = miembro.roles.cache.has(rol.id);

            if (!tieneRol) {
                if (args[2] == "otorgar" || args[2] == "ambos") {
                    await miembro.roles.add(rol);
                    otorgados++;
                }
            } else {
                if (args[2] == "remover" || args[2] == "ambos") {
                    await miembro.roles.remove(rol);
                    removidos++;
                }
            }
        } catch (error) {
            console.error(`Error procesando a ${miembro.user.tag}: ${error.message}`);
            errores++;
        }
    }

    const embed = doRoleMassiveProcessEmbed({
        rol,
        totalMiembros: miembros.size,
        otorgados,
        removidos,
        errores,
        locale
    });

    return {
        embeds: [embed]
    };
}

async function run(messages, args) {
    const { message } = messages;
    const locale = message.locale || 'es';

    if (!message.guild) {
        return t(locale, 'rol.only_guild');
    }

    const modulos_rol = new Collection([
        ["color", cambiar_color],
        ["otorgar", otorgar],
        ["otorgarTodos", otorgarTodos]
    ]);

    // Revisemos si quien lo ejecuta tiene permisos de admin
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return t(locale, 'rol.no_admin');
    }

    if (!modulos_rol.has(args[0])) {
        const cmdsList = modulos_rol.keys().reduce((acumulado, comando) => {
            acumulado += `\`${comando}\`, `;
            return acumulado;
        }, "").slice(0, -2);
        return t(locale, 'rol.available_commands', { commands: cmdsList });
    }

    return await modulos_rol.get(args[0])(message, args, locale);
}

run.description = {
    'header': "Gestión de roles y colores en el servidor",
    'body': 'Permite cambiar colores de roles, otorgar/remover roles de forma individual o masiva.',
    'usage': 's.rol color <rol_id> <hex> : Cambia color del rol.\ns.rol otorgar <rol_id> <user_id> : Otorga/remueve el rol a un usuario.\ns.rol otorgarTodos <rol_id> [otorgar|remover|ambos] : Otorga o remueve el rol a todo el servidor.'
};

module.exports = { run, description: run.description };