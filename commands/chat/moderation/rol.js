const { PermissionsBitField, Collection, EmbedBuilder, DiscordAPIError } = require('discord.js');
const embed = new EmbedBuilder().setFooter({text: "SengoBot", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"}).setTimestamp();

let error_msj = 'Desconocido';

async function cambiar_color(message, args){
    // Funcion para cambiar el color
    // s.color [id del rol a cambiar el color] [color1] (color2) (color3)

    // Si solo hay un argumento
    if(!args[1]) return "Se necesita el ID del rol a cambiar el color." 

    // Obtenemos el rol con el ID dado

    const rol = message.guild.roles.cache.get(args[1]);

    // Si no existe el rol por X razon
    if(!rol) {
        error_msj = 'Rol no encontrado';
        return `Hubo un error al ejecutar el comando **(${error_msj})**: \n> \`${rol}\``;
    }

    const colores = {"primaryColor" : `#${args[2]}`}

    if(args[3]) colores["secondaryColor"] = `#${args[3]}`;
    if(args[4]) colores["tertiaryColor"] = `#${args[4]}`;

    try{

        await rol.setColors(colores);

        // Para en caso que digite mal el color en hex
    } catch(error){

        let error_msj = 'Desconocido';
        if(error instanceof TypeError && error.code == 'ColorConvert') error_msj = "Codigo hex invalido";
        else if(error.code == 670006) error_msj = "Roles holograficos no activos";

        console.log(error);
        return `Hubo un error al ejecutar el comando **(${error_msj})**: \n> \`${error}\``;
    }

    embed.setAuthor({ name : "Se ha cambiado el color del rol"})
        .setDescription(`### Ahora el rol <@&${rol.id}> tiene nuevos colores.`)
        .setColor(`#${args[2]}` || message.member.roles.highest.color)

    return {
        embeds: [embed],
    };
}

async function otorgar(message, args){
    // Funcion para dar un rol a un usuario
    // s.rol otorgar <ID DEL ROL> <ID DEL USUARIO>

    // Obtenemos el rol con el ID dado
    const rol = await message.guild.roles.cache.get(args[1]);

    // Si no existe el rol por X razon
    if(!rol) {
        error_msj = 'Rol no encontrado';
        return `Hubo un error al ejecutar el comando **(${error_msj})**: \n> \`${rol}\``;
    }

    try{

        // Obtenemos el usuario con el ID dado
        const miembro = await message.guild.members.fetch(args[2]);

        // Si no tiene el rol se lo otorga
        if(!(await miembro.roles.cache.has(rol.id))){

            // Otorgamos el rol y cambiamos el mensaje del embed
            await miembro.roles.add(rol);
            embed.setAuthor({ name : "Se ha otorgado el rol"}).setDescription(`### Ahora el usuario <@${miembro.id}> tiene el rol <@&${rol.id}>.`)
        } else{
            // Tiene ya el rol entonces se lo quita
            await miembro.roles.remove(rol);
            embed.setAuthor({ name : "Se ha removido el rol"}).setDescription(`### Ahora el usuario <@${miembro.id}> no tiene el rol <@&${rol.id}>.`)
        }
            
        return {
            embeds: [embed.setColor(rol.color)],
        };

    } catch(error){

        if(error.code == 10013) error_msj = "Usuario no encontrado";
        else if(error.code == 50001) error_msj = "Le faltan permisos";
        return `Hubo un error al ejecutar el comando **(${error_msj})**: \n> \`${error}\``;
    }
}

async function otorgarTodos(message, args) {
    // Funcion para dar/quitar un rol a TODOS los usuarios del servidor
    // s.rol otorgar_masivo <ID DEL ROL>
    
    // Obtenemos el rol con el ID dado
    const rol = message.guild.roles.cache.get(args[1]);

    // Si no existe el rol
    if (!rol) {
        const error_msj = 'Rol no encontrado';
        return `Hubo un error al ejecutar el comando **(${error_msj})**: \n> \`${rol}\``;
    }

    // Obtenemos a todos los miembros del servidor
    // Usamos fetch() para asegurar que la colección esté completa
    const miembros = await message.guild.members.fetch();
    
    let otorgados = 0;
    let removidos = 0;
    let errores = 0;

    // Iteramos sobre todos los miembros del servidor
    for (const [id, miembro] of miembros) {

        // Opcional: Ignorar bots
        if (miembro.user.bot) continue;

        try {
            // Revisamos si el miembro ya tiene el rol
            const tieneRol = miembro.roles.cache.has(rol.id);

            if (!tieneRol) {

                // Si NO tiene el rol, lo otorgamos
                if(args[2] == "otorgar" || args[2] == "ambos"){

                    await miembro.roles.add(rol);
                    otorgados++;
                }
            } else {

                // Si NO tiene el rol, lo otorgamos
                if(args[2] == "remover" || args[2] == "ambos"){

                    // Si YA tiene el rol, lo removemos
                    await miembro.roles.remove(rol);
                    removidos++;
                }
            }
        } catch (error) {
            
            console.error(`Error procesando a ${miembro.user.tag}: ${error.message}`);
            errores++;
        }
    }

    embed.setAuthor({ name: "Proceso de roles masivo" });
    embed.setDescription(`
        ###  Resumen
        > **Rol en cuestion:** <@&${rol.id}>
        > **Usuarios procesados:** ${miembros.size}
        
        - 🟢 Otorgados: \`${otorgados}\`\n- 🔴 Removidos: \`${removidos}\`\n- 🟡 Errores: \`${errores}\`
    `);

    return {
        embeds: [embed.setColor(rol.color)],
    };
}

async function run(messages, args){

    const { message } = messages;

    const modulos_rol = new Collection([
        ["color", cambiar_color],
        ["otorgar", otorgar],
        ["otorgarTodos", otorgarTodos]
    ]);

    // Revisemos si quien lo ejecuta tiene permisos de admin
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return "No es admin";
    }

    // Es admin

    // Si no existe el argumento para el rol
    if(!modulos_rol.has(args[0])){

        return `## Lista de comandos disponibles \n> ` + 
            modulos_rol.keys().reduce((acumulado, comando) => {acumulado += `\`${comando}\`,`; return acumulado}, "");
    }

    // Si existe entonces correr el comando
    return await modulos_rol.get(args[0])(message, args);
}

module.exports = { run };