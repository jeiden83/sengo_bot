const { EmbedBuilder } = require('discord.js');

async function run(messages, args) {
    const { message, reply } = messages;

    // Obtener color del rol más alto del usuario o usar el rosa característico de osu! / Sengo
    const roleColor = message.member?.roles?.highest?.color || '#ff66aa';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ff66aa';

    const embed = new EmbedBuilder()
        .setTitle('🌸 Acerca de Sengo')
        .setDescription(
            `Sengo es un bot de Discord de alto rendimiento especializado para la comunidad de **osu!**, diseñado con un enfoque centrado en la velocidad extrema, la automatización y la integración social.\n\nA continuación se presentan las características avanzadas que lo hacen sobresalir frente a otras alternativas tradicionales:`
        )
        .setColor(embedColor)
        .setThumbnail("https://jeiden.s-ul.eu/3ssHl9Gd")
        .addFields(
            {
                name: '🔒 Vinculación Segura con OAuth 2.0',
                value: 'Olvídate de cambiar tu perfil o usar métodos tediosos. Con `s.link -oauth` vinculas tu cuenta en segundos de forma oficial. Detecta automáticamente tu avatar, bandera del país y tu estado de **osu! Supporter** 💖.'
            },
            {
                name: '⚡ Tiempos de Respuesta Sub-Milisegundo (Caché)',
                value: 'Cuando consultas tu jugada reciente con `.r`, Sengo precarga predictivamente en segundo plano los datos del compare, perfil y beatmap. Al ejecutar `.c` posterior, este se resuelve en **menos de 1ms** desde la caché local.'
            },
            {
                name: '🗺️ Leaderboards Nacionales Inteligentes',
                value: 'Visualiza la tabla de clasificación de tu país usando `.lb -pais`. Al estar vinculado por OAuth, el bot autodetecta tu bandera y nacionalidad sin que tengas que especificar el código de país (ej: `MX`, `ES`, `VE`).'
            },
            {
                name: '👥 Brecha de Puntuaciones (.gap / -friends)',
                value: 'Compara tu puntuación directamente contra todos tus amigos y miembros vinculados del servidor en el mapa actual, calculando diferencias de puntuación, precisión y PP de forma instantánea.'
            },
            {
                name: '🔗 Detección y Contexto Inteligente de Enlaces',
                value: 'Sengo analiza enlaces de mapas de osu!, respuestas a mensajes anteriores, y enlaces directos de Discord para extraer el beatmap sobre el que deseas interactuar sin obligarte a copiar IDs manuales.'
            }
        )
        .setFooter({ text: 'Sengo • s.acerca / s.about', iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();

    const sendOptions = { embeds: [embed] };

    if (reply) {
        await reply.reply(sendOptions);
    } else {
        await message.channel.send(sendOptions);
    }
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
