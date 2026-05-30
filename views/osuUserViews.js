const { EmbedBuilder } = require("discord.js");
const { getEmbedColor, getFlagEmoji } = require("./osuViewHelpers.js");

/**
 * Renderiza el embed para el enlace seguro de OAuth (link.js)
 */
function doOsuOAuthEmbed(authUrl) {
    return new EmbedBuilder()
        .setTitle("Vinculación de Cuenta Segura - Sengo")
        .setDescription(
            "Para vincular tu cuenta de osu! de forma completamente segura y privada mediante la API oficial (OAuth), haz clic en el siguiente botón:\n\n" +
            `👉 **[Autorizar Cuenta de osu!](${authUrl})**\n\n` +
            "**¿Por qué usar OAuth?**\n" +
            "• **Seguridad**: No necesitamos tu contraseña.\n" +
            "• **Pool de Soporte**: Tu cuenta ayudará a consultar rankings nacionales si tienes supporter.\n" +
            "• **Privado**: Este proceso es completamente confidencial."
        )
        .setColor("#ff66aa")
        .setFooter({ text: "Sengo OAuth System v2" })
        .setTimestamp();
}

/**
 * Renderiza el embed de usuarios vinculados faltantes (amigos.js -sengo)
 */
function doOsuMissingFriendsEmbed(message, missingFriends) {
    const embedColor = getEmbedColor(message);

    const missingEmbed = new EmbedBuilder()
        .setTitle("🕵️ Usuarios Vinculados al Sengo Faltantes")
        .setColor(embedColor)
        .setThumbnail("https://jeiden.s-ul.eu/3ssHl9Gd")
        .setTimestamp();

    if (missingFriends.length === 0) {
        missingEmbed.setDescription("✨ **¡Increíble!** Tienes agregado a todos los usuarios vinculados al Sengo Bot en tu cuenta de osu!.");
    } else {
        let desc = `Los siguientes **${missingFriends.length}** usuarios vinculados al Sengo aún **no** están en tu lista de amigos de osu!:\n\n`;
        let addedCount = 0;
        for (let idx = 0; idx < missingFriends.length; idx++) {
            const user = missingFriends[idx];
            const line = `${idx + 1}. **${user.username}** (osu!: [perfil](https://osu.ppy.sh/users/${user.osu_id})) ▸ Discord: <@${user.discord_id}>\n`;
            if (desc.length + line.length > 3900) {
                desc += `\n*...y **${missingFriends.length - addedCount}** usuarios vinculados más.*`;
                break;
            }
            desc += line;
            addedCount++;
        }
        missingEmbed.setDescription(desc);
    }

    return missingEmbed;
}

/**
 * Renderiza una página de la lista de amigos en osu! (amigos.js)
 */
function doOsuFriendsListEmbed(message, friends, chunk, page, maxPages, startIndex, totalFriends) {
    const embedColor = getEmbedColor(message);
    let desc = `Total de amigos en osu!: **${totalFriends}**\n\n`;

    chunk.forEach((friend, idx) => {
        const globalIndex = startIndex + idx + 1;
        const flag = getFlagEmoji(friend.country_code);
        const SuppIcon = friend.is_supporter ? '💖' : '❌';
        const SengoIcon = friend.sengo ? '✅' : '❌';

        let mutualIcon = '❌';
        if (friend.mutual === 'yes') mutualIcon = '✅';
        else if (friend.mutual === 'unknown') mutualIcon = '❓';

        desc += `\`#${globalIndex.toString().padEnd(2, ' ')}\` ▸ ${flag} [**${friend.username}**](https://osu.ppy.sh/users/${friend.id}) ▸ Supporter: ${SuppIcon} ▸ Mutual: ${mutualIcon} ▸ Sengo: ${SengoIcon}\n`;
    });

    desc += `\n**Leyenda:**\n` +
            `• **Supporter**: Si el usuario tiene supporter en osu! activo.\n` +
            `• **Mutual**: ✅ Sí, ❌ No, ❓ Vinculado pero falta scope \`friends.read\` (se requiere \`s.link -oauth\`).\n` +
            `• **Sengo**: Cuenta vinculada al Sengo Bot.`;

    return new EmbedBuilder()
        .setTitle("👥 Lista de Amigos en osu!")
        .setDescription(desc)
        .setColor(embedColor)
        .setThumbnail("https://jeiden.s-ul.eu/3ssHl9Gd")
        .setFooter({ text: `Sengo • Página ${page}/${maxPages}`, iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();
}

/**
 * Renderiza el embed para las estadísticas de creador/mapper (.mapper)
 */
function doOsuMapperEmbed(message, user) {
    const embedColor = getEmbedColor(message);
    const flag = getFlagEmoji(user.country_code);
    
    // Kudosu y seguidores de mapeo
    const mappingFollowers = user.mapping_follower_count?.toLocaleString('es-ES') || '0';
    const kudosuTotal = user.kudosu?.total?.toLocaleString('es-ES') || '0';
    const kudosuAvailable = user.kudosu?.available?.toLocaleString('es-ES') || '0';
    
    // Conteo de sets de beatmaps
    const rankedCount = user.ranked_and_approved_beatmapset_count?.toLocaleString('es-ES') || '0';
    const lovedCount = user.loved_beatmapset_count?.toLocaleString('es-ES') || '0';
    const pendingCount = user.pending_beatmapset_count?.toLocaleString('es-ES') || '0';
    const graveyardCount = user.graveyard_beatmapset_count?.toLocaleString('es-ES') || '0';
    const guestCount = user.guest_beatmapset_count?.toLocaleString('es-ES') || '0';
    const nominatedCount = user.nominated_beatmapset_count?.toLocaleString('es-ES') || '0';
    
    const isSupporter = user.is_supporter ? " 💖" : "";
    
    // Crear embed
    const embed = new EmbedBuilder()
        .setTitle(`🛠️ Estadísticas de Mapper: ${user.username}${isSupporter}`)
        .setURL(`https://osu.ppy.sh/users/${user.id}`)
        .setDescription(
            `**${flag} [${user.username}](https://osu.ppy.sh/users/${user.id})** es un creador de contenido en la comunidad de \`osu!\`.\n` +
            `Aquí tienes un resumen de su actividad de mapeo:`
        )
        .setColor(embedColor)
        .setThumbnail(user.avatar_url)
        .addFields(
            { name: "👥 Comunidad", value: `• **Notificado / Seguidores**: \`${mappingFollowers}\`\n• **Kudosu Total**: \`${kudosuTotal}\` (Disponible: \`${kudosuAvailable}\`)`, inline: false },
            { name: "🟢 Mapas Oficiales", value: `• **Rankeados / Aprobados**: \`${rankedCount}\`\n• **Loved (Amados)**: \`${lovedCount}\``, inline: true },
            { name: "⚫ Otros Mapas", value: `• **Pending / WIP**: \`${pendingCount}\`\n• **Graveyard (Cementerio)**: \`${graveyardCount}\``, inline: true },
            { name: "🤝 Colaboraciones y Nominaciones", value: `• **Dificultades Invitadas (GDs)**: \`${guestCount}\`\n• **Beatmapsets Nominados**: \`${nominatedCount}\``, inline: false }
        )
        .setFooter({ text: "Sengo Mapper Stats", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();
        
    if (user.cover_url || (user.cover && user.cover.url)) {
        embed.setImage(user.cover_url || user.cover.url);
    }
    
    return embed;
}

module.exports = {
    doOsuOAuthEmbed,
    doOsuMissingFriendsEmbed,
    doOsuFriendsListEmbed,
    doOsuMapperEmbed
};
