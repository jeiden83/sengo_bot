const { EmbedBuilder } = require('discord.js');

async function run(messages, args) {
    const { message, res } = messages;
    const supabase = res?.supabaseClient;

    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#378a91';

    const embed = new EmbedBuilder()
        .setTitle('🌐 Usuarios Vinculados por oAuth')
        .setColor(embedColor)
        .setThumbnail("https://jeiden.s-ul.eu/3ssHl9Gd")
        .setFooter({ text: "SengoBot", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();

    if (!supabase) {
        embed.setDescription(`*No se pudieron cargar los usuarios de la base de datos (Supabase no disponible).*`);
        return { embeds: [embed] };
    }

    try {
        const { data, error } = await supabase
            .from('oauth_tokens')
            .select('discord_id, username, country_code, is_supporter')
            .order('username', { ascending: true });

        if (error) {
            console.error("Error al obtener usuarios de Supabase:", error);
            embed.setDescription(`*Error al cargar los usuarios desde la base de datos.*`);
            return { embeds: [embed] };
        }

        if (data && data.length > 0) {
            let description = '';
            
            // Agrupar por nacionalidad
            const groups = {};
            data.forEach(user => {
                const code = (user.country_code || 'UN').toUpperCase();
                if (!groups[code]) groups[code] = [];
                groups[code].push(user);
            });

            // Ordenar países
            const countries = Object.keys(groups).sort();
            for (const country of countries) {
                const flagEmoji = country !== 'UN' ? `:flag_${country.toLowerCase()}:` : '🏳️';
                description += `\n${flagEmoji} **${country}**\n`;
                
                groups[country].forEach(user => {
                    const suppIcon = user.is_supporter ? ' 💖' : '';
                    description += `  • **${user.username}**${suppIcon}\n`;
                });
            }
            embed.setDescription(description);
        } else {
            embed.setDescription(`*Aún no hay usuarios vinculados a través del sistema seguro de oAuth.*`);
        }
    } catch (err) {
        console.error("Error inesperado en contribuidores:", err);
        embed.setDescription(`*Ocurrió un error inesperado al procesar el comando.*`);
    }

    return { embeds: [embed] };
}

run.description = {
    'header' : 'Lista de usuarios vinculados',
    'body' : 'Muestra la comunidad vinculada por oAuth agrupada por país con su estado de supporter.',
    'usage' : undefined
}

module.exports = { run }