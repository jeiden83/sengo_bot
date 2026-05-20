async function run(messages, args) {
    const { res } = messages;
    const supabase = res?.supabaseClient;

    let msj = `🛡️ **Lista de Contribuidores y Creadores** 🛡️\n` +
              `- **Jeiden**: Creador del bot; obviamente en el top\n` +
              `- **Zebbyx**: La idea de crear el bot para el s.bg y quien me dio las ganas\n` +
              `- **Airflux**: GFX de unos embeds; el aires\n` +
              `- **Phingus**: el comando s.gap\n` +
              `- **Osulatam**: Por debugear y darme mas trabajo\n` +
              `- **Los de mania osulatam**: Por hacerme tener mas trabajo con el minijuego\n` +
              `- **Tsuhikari, Lin, Diego, Luchito, Blast, Mochilo y el resto**: Por debugear y usar el bot\n\n`;

    if (!supabase) {
        return msj + `*No se pudieron cargar los contribuyentes de la base de datos.*`;
    }

    try {
        const { data, error } = await supabase
            .from('oauth_tokens')
            .select('discord_id, username, country_code, is_supporter')
            .order('username', { ascending: true });

        if (error) {
            console.error("Error al obtener contribuyentes de Supabase:", error);
            return msj + `*Error al cargar los contribuyentes desde Supabase.*`;
        }

        if (data && data.length > 0) {
            msj += `🌐 **Usuarios Vinculados por oAuth** 🌐\n`;
            
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
                msj += `\n${flagEmoji} **${country}**\n`;
                
                groups[country].forEach(user => {
                    const suppIcon = user.is_supporter ? ' 💖' : '';
                    msj += `  • **${user.username}** (<@${user.discord_id}>)${suppIcon}\n`;
                });
            }
        } else {
            msj += `*Aún no hay usuarios vinculados a través del sistema seguro de oAuth.*`;
        }
    } catch (err) {
        console.error("Error inesperado en contribuidores:", err);
    }

    return msj;
}

run.description = {
    'header' : 'Lista de contribuidores del bot',
    'body' : '**Ordenados** de mayor a menor contribucion. Además de los creadores fijos, muestra la comunidad vinculada por oAuth agrupada por país con su estado de supporter.',
    'usage' : undefined
}

module.exports = { run }