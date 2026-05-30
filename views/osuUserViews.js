const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
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
        .setTitle(`🛠️ Estadísticas de Mapper: ${flag} ${user.username}${isSupporter}`)
        .setURL(`https://osu.ppy.sh/users/${user.id}`)
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

function buildMapperButtonsRow(user, activeType, currentPage = 1, totalPages = 1) {
    const rankedCount = user.ranked_and_approved_beatmapset_count || 0;
    const lovedCount = user.loved_beatmapset_count || 0;
    const pendingCount = user.pending_beatmapset_count || 0;
    const graveyardCount = user.graveyard_beatmapset_count || 0;
    const guestCount = user.guest_beatmapset_count || 0;
    const totalCount = rankedCount + lovedCount + pendingCount + graveyardCount + guestCount;

    const hasPagination = ['ranked', 'loved', 'pending', 'graveyard', 'guest'].includes(activeType);

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("mapper_prev")
            .setLabel("Anterior")
            .setEmoji("◀️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasPagination || currentPage <= 1),
        new ButtonBuilder()
            .setCustomId("mapper_next")
            .setLabel("Siguiente")
            .setEmoji("▶️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasPagination || currentPage >= totalPages),
        new ButtonBuilder()
            .setCustomId("mapper_ranked")
            .setLabel("Rankeados")
            .setEmoji("🟢")
            .setStyle(ButtonStyle.Success)
            .setDisabled(activeType === 'ranked' || rankedCount === 0),
        new ButtonBuilder()
            .setCustomId("mapper_loved")
            .setLabel("Amados")
            .setEmoji("🔮")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(activeType === 'loved' || lovedCount === 0),
        new ButtonBuilder()
            .setCustomId("mapper_pending")
            .setLabel("WIP")
            .setEmoji("⚫")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(activeType === 'pending' || pendingCount === 0)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("mapper_graveyard")
            .setLabel("Abandonados")
            .setEmoji("🪦")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(activeType === 'graveyard' || graveyardCount === 0),
        new ButtonBuilder()
            .setCustomId("mapper_guest")
            .setLabel("GDs")
            .setEmoji("🤝")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(activeType === 'guest' || guestCount === 0),
        new ButtonBuilder()
            .setCustomId("mapper_all")
            .setLabel("Todos")
            .setEmoji("🗺️")
            .setStyle(ButtonStyle.Success)
            .setDisabled(activeType === 'all' || totalCount === 0)
    );

    return [row1, row2];
}

function formatBeatmapset(set, index, type, userId) {
    const diffs = set.beatmaps || [];
    let starsStr = "N/A";
    if (diffs.length > 0) {
        const ratings = diffs.map(b => b.difficulty_rating || 0);
        const minS = Math.min(...ratings).toFixed(2);
        const maxS = Math.max(...ratings).toFixed(2);
        starsStr = minS === maxS ? `${maxS}★` : `${minS}★ - ${maxS}★`;
    }

    const playcount = (set.play_count || 0).toLocaleString('es-ES');
    const favorites = (set.favourite_count || 0).toLocaleString('es-ES');
    
    let line = `**${index}.** [${set.artist} - ${set.title}](https://osu.ppy.sh/s/${set.id})`;
    if (type === 'guest') {
        const guestDiffs = diffs.filter(b => b.user_id === userId);
        if (guestDiffs.length > 0) {
            const diffsNames = guestDiffs.map(b => `\`${b.version}\` (⭐${(b.difficulty_rating || 0).toFixed(2)}★)`).join(", ");
            line += `\n   ↳ Host: [${set.creator}](https://osu.ppy.sh/users/${set.user_id}) | GDs: ${diffsNames}`;
        } else {
            line += `\n   ↳ Host: [${set.creator}](https://osu.ppy.sh/users/${set.user_id}) | ⭐ ${starsStr}`;
        }
    } else {
        line += `\n   ▸ ⭐ **${starsStr}** | 🎮 **${playcount}** plays | ❤️ **${favorites}**`;
    }
    return line;
}

function doOsuMapperListEmbed(message, user, type, data, page = 1) {
    const embedColor = getEmbedColor(message);
    const flag = getFlagEmoji(user.country_code);
    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setThumbnail(user.avatar_url)
        .setFooter({ text: "Sengo Mapper Stats", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();

    if (user.cover_url || (user.cover && user.cover.url)) {
        embed.setImage(user.cover_url || user.cover.url);
    }

    const titleType = {
        'ranked': '🟢 Mapas Rankeados',
        'loved': '🔮 Mapas Loved',
        'pending': '⚫ Mapas Pending / WIP',
        'graveyard': '🪦 Mapas Graveyard',
        'guest': '🤝 Dificultades Invitadas (GDs)',
        'all': '🗺️ Todos los Mapas'
    }[type] || 'Mapas';

    if (type === 'all') {
        embed.setTitle(`${titleType} de ${flag} ${user.username}`);
        let desc = `Resumen completo de mapas creados por **${user.username}**:\n\n`;
        
        // Ranked
        const rankedList = data.ranked || [];
        const rankedCount = user.ranked_and_approved_beatmapset_count || 0;
        desc += `🟢 **Rankeados (${rankedCount})**\n`;
        if (rankedList.length === 0) {
            desc += `*Ninguno*\n\n`;
        } else {
            desc += rankedList.slice(0, 3).map((set, idx) => {
                const ratings = (set.beatmaps || []).map(b => b.difficulty_rating || 0);
                const maxS = ratings.length > 0 ? Math.max(...ratings).toFixed(2) : '0';
                return `• [${set.title}](https://osu.ppy.sh/s/${set.id}) (⭐${maxS}★)`;
            }).join("\n") + (rankedList.length > 3 ? `\n*...y ${rankedCount - 3} más.*` : "") + `\n\n`;
        }

        // Loved
        const lovedList = data.loved || [];
        const lovedCount = user.loved_beatmapset_count || 0;
        desc += `🔮 **Loved (${lovedCount})**\n`;
        if (lovedList.length === 0) {
            desc += `*Ninguno*\n\n`;
        } else {
            desc += lovedList.slice(0, 3).map((set, idx) => {
                const ratings = (set.beatmaps || []).map(b => b.difficulty_rating || 0);
                const maxS = ratings.length > 0 ? Math.max(...ratings).toFixed(2) : '0';
                return `• [${set.title}](https://osu.ppy.sh/s/${set.id}) (⭐${maxS}★)`;
            }).join("\n") + (lovedList.length > 3 ? `\n*...y ${lovedCount - 3} más.*` : "") + `\n\n`;
        }

        // Pending
        const pendingList = data.pending || [];
        const pendingCount = user.pending_beatmapset_count || 0;
        desc += `⚫ **Pending / WIP (${pendingCount})**\n`;
        if (pendingList.length === 0) {
            desc += `*Ninguno*\n\n`;
        } else {
            desc += pendingList.slice(0, 3).map((set, idx) => {
                const ratings = (set.beatmaps || []).map(b => b.difficulty_rating || 0);
                const maxS = ratings.length > 0 ? Math.max(...ratings).toFixed(2) : '0';
                return `• [${set.title}](https://osu.ppy.sh/s/${set.id}) (⭐${maxS}★)`;
            }).join("\n") + (pendingList.length > 3 ? `\n*...y ${pendingCount - 3} más.*` : "") + `\n\n`;
        }

        // Graveyard
        const graveyardList = data.graveyard || [];
        const graveyardCount = user.graveyard_beatmapset_count || 0;
        desc += `🪦 **Graveyard (${graveyardCount})**\n`;
        if (graveyardList.length === 0) {
            desc += `*Ninguno*\n\n`;
        } else {
            desc += graveyardList.slice(0, 3).map((set, idx) => {
                const ratings = (set.beatmaps || []).map(b => b.difficulty_rating || 0);
                const maxS = ratings.length > 0 ? Math.max(...ratings).toFixed(2) : '0';
                return `• [${set.title}](https://osu.ppy.sh/s/${set.id}) (⭐${maxS}★)`;
            }).join("\n") + (graveyardList.length > 3 ? `\n*...y ${graveyardCount - 3} más.*` : "") + `\n\n`;
        }

        // Guest
        const guestList = data.guest || [];
        const guestCount = user.guest_beatmapset_count || 0;
        desc += `🤝 **Guest Diffs (${guestCount})**\n`;
        if (guestList.length === 0) {
            desc += `*Ninguno*\n\n`;
        } else {
            desc += guestList.slice(0, 3).map((set, idx) => {
                const guestDiffs = (set.beatmaps || []).filter(b => b.user_id === user.id);
                const diffsNames = guestDiffs.map(b => `\`${b.version}\` (⭐${(b.difficulty_rating || 0).toFixed(2)}★)`).join(", ");
                return `• [${set.title}](https://osu.ppy.sh/s/${set.id}) - GDs: ${diffsNames}`;
            }).join("\n") + (guestList.length > 3 ? `\n*...y ${guestCount - 3} más.*` : "") + `\n\n`;
        }

        embed.setDescription(desc);
    } else {
        if (!data || data.length === 0) {
            embed.setTitle(`${titleType} de ${flag} ${user.username}`);
            embed.setDescription(`*No se encontraron mapas en esta categoría.*`);
        } else {
            const itemsPerPage = 10;
            const totalPages = Math.max(1, Math.ceil(data.length / itemsPerPage));
            const currentPage = Math.min(Math.max(1, page), totalPages);
            
            embed.setTitle(`${titleType} de ${flag} ${user.username} (Pág. ${currentPage}/${totalPages})`);

            const pageData = data.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
            let desc = `Mostrando mapas **${(currentPage - 1) * itemsPerPage + 1}** a **${Math.min(currentPage * itemsPerPage, data.length)}** de **${data.length}**:\n\n`;
            desc += pageData.map((set, idx) => formatBeatmapset(set, (currentPage - 1) * itemsPerPage + idx + 1, type, user.id)).join("\n\n");
            
            const totalCount = {
                'ranked': user.ranked_and_approved_beatmapset_count,
                'loved': user.loved_beatmapset_count,
                'pending': user.pending_beatmapset_count,
                'graveyard': user.graveyard_beatmapset_count,
                'guest': user.guest_beatmapset_count
            }[type] || data.length;

            if (totalCount > data.length) {
                desc += `\n\n*Nota: Mostrando hasta los primeros ${data.length} mapas más recientes. La lista completa está disponible en la web de osu!.*`;
            }
            embed.setDescription(desc);
        }
    }

    return embed;
}

module.exports = {
    doOsuOAuthEmbed,
    doOsuMissingFriendsEmbed,
    doOsuFriendsListEmbed,
    doOsuMapperEmbed,
    buildMapperButtonsRow,
    doOsuMapperListEmbed
};
