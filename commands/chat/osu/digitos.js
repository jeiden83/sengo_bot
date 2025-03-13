const { getOsuUser, argsParser, getRecentScores, getBeatmap } = require("../../utils/osu.js");
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

    // String a comparar de los digitos
    const rankDigits = String(osu_user.statistics.global_rank).length;
    const digitsString = `${rankDigits} Digitos`;

	// Si el usuario ya tiene un rol de esos digitos, evitar asignar otro
	if (message.member.roles.cache.find(r => r.name.includes(digitsString))) {
		return `Ya tienes un rol de ${rankDigits} digitos asignado.`;
	}

	// Si no tiene el rol, asignar el rol al usuario
	try {
		
		await message.member.roles.add(message.guild.roles.cache.find(r => r.name.includes(digitsString)));
		return `Rol de ${rankDigits} digitos asignado exitosamente.`;

	} catch (error) {

		console.error(error);
		return `Hubo un error al asignar el rol.`;
	}
}

run.description = 
{
    'header' : 'Autorol de digitos',
    'body' : 'Aplicable para el [**Osu! Latinoamerica**](https://discord.gg/4GHYpRn).\n Otorga un rol de digitos con respecto al usuario linkeado al bot, y con respecto al modo de juego principal',
    'usage' : undefined
}

module.exports = { run }