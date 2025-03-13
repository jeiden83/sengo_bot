const { getOsuUser, argsParser, getRecentScores, getBeatmap } = require("../../utils/osu.js");
const country_codes = require("../../../src/country_codes.json");
const { EmbedBuilder } = require("discord.js");

async function run(messages, args) {
    const { message, res } = messages;

	// selfexplainable
	// todo later
	if(message.guild.id !== "592451380942471178"){
		return `Esto no es Osu! latam. Preguntele a Jeiden primero.`
	}

    // Obtenemos el discord id del usuario que dio el comando
    const discord_id = message.author.id;

    // Buscar el usuario linkeado con el bot 
    user_found = await res.User.findOne({ discord_id });

    // Si no está linkeado al bot
    if (!user_found) return `Para usar el comando primero tiene que linkearse al bot.`;

    // Obtener el usuario de osu
    const osu_user = await getOsuUser({ "username": [user_found.osu_id], "gamemode": user_found.main_gamemode == "std" ? "osu" : user_found.main_gamemode });

    // Obtener los roles del servidor
    const role = message.guild.roles.cache.find(r => r.name.includes(`[ ${osu_user.country_code} ]`));

    // Revisar si el rol de país ya está en el servidor
    if (role) {

        // Obtener los nombres de los roles de país a partir de country_codes
		const countryRoleNames = Object.keys(country_codes).map(code => `[ ${code} ] ${country_codes[code].country}`);

		// Revisar si el usuario ya tiene un rol de país
		const userHasCountryRole = message.member.roles.cache.some(r => countryRoleNames.includes(r.name));

		if (role) {
			// Si el usuario ya tiene un rol de país, evitar asignar otro
			if (userHasCountryRole) {
				return `Ya tienes un rol de país asignado.`;
			}

			// Si no tiene el rol, asignar el rol al usuario
			try {
				
				await message.member.roles.add(role);
				return `Rol de país asignado exitosamente.`;
			} catch (error) {
				console.error(error);
				return `Hubo un error al asignar el rol.`;
			}
		}
    } else {
        // Si el rol no existe, crearlo
        // Obtener la información del país desde country_codes usando el código del país
        const country_info = country_codes[osu_user.country_code];

        // Crear el nombre del rol con el formato adecuado, y si no esta en el JSON pues tomarlo de los datos del usuario
        const role_name = `[ ${osu_user.country_code} ] ${country_info ? country_info.country : osu_user.country.name}` 

        try {
			let role_position = 0; // Posición por defecto
		
			// Verificar si la guild es la deseada antes de buscar el rol de referencia
			if (message.guild.id === "592451380942471178") { // OSULATAM
				const reference_role = message.guild.roles.cache.find(r => r.name.includes("Modo de juego")); // ROL DE REFERENCIA
		
				if (reference_role) {
					role_position = reference_role.position; // Poner el nuevo rol justo debajo
				}
			}
		
			// Crear el rol con el color adecuado
			const created_role = await message.guild.roles.create({
				name: role_name,
				color: country_info.color,
				mentionable: false,
				reason: `Rol de país para ${osu_user.country_code}`,
			});
		
			// Si se encontró un rol de referencia, mover el nuevo rol a la posición adecuada
			if (role_position > 0) {
				await created_role.setPosition(role_position);
			}
		
			// Asignar el rol al usuario
			await message.member.roles.add(created_role);
		
			return `Rol de país creado, posicionado y asignado exitosamente.`;
		} catch (error) {

			console.error(error);
			return `Hubo un error al crear o asignar el rol de país.`;
		}
		
    }
}

run.description = 
{
    'header' : 'Autorol de pais',
    'body' : 'Aplicable para el [**Osu! Latinoamerica**](https://discord.gg/4GHYpRn).\n Otorga un rol del pais con respecto al usuario linkeado al bot.',
    'usage' : undefined
}

module.exports = { run}