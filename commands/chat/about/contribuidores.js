const { EmbedBuilder } = require('discord.js');
const OsuUserModel = require('../../../models/OsuUserModel.js');
const { buildPaginationRow } = require('../../../views/osuViewHelpers.js');

async function run(messages, args) {
    const { message, res, reply } = messages;

    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#378a91';

    try {
        const data = await OsuUserModel.getAllOAuthUsers();

        if (data && data.length > 0) {
            // Ordenar alfabéticamente por país y luego por username
            data.sort((a, b) => {
                const countryA = (a.country_code || 'UN').toUpperCase();
                const countryB = (b.country_code || 'UN').toUpperCase();
                if (countryA !== countryB) {
                    return countryA.localeCompare(countryB);
                }
                return (a.username || '').localeCompare(b.username || '');
            });

            const totalUsers = data.length;
            const countryCounts = {};
            data.forEach(user => {
                const code = (user.country_code || 'UN').toUpperCase();
                countryCounts[code] = (countryCounts[code] || 0) + 1;
            });

            const maxPages = Math.ceil(totalUsers / 10);
            let pageNum = 1;
            let startIndex = 0;

            const generateEmbed = (start, page, maxP) => {
                const chunk = data.slice(start, start + 10);
                let description = `Total de usuarios vinculados: **${totalUsers}**\n`;

                // Agrupar el chunk por pais
                const groups = {};
                chunk.forEach(user => {
                    const code = (user.country_code || 'UN').toUpperCase();
                    if (!groups[code]) groups[code] = [];
                    groups[code].push(user);
                });

                // Mantener el orden alfabético de países en este chunk
                const countriesInChunk = Object.keys(groups).sort();
                for (const country of countriesInChunk) {
                    const flagEmoji = country !== 'UN' ? `:flag_${country.toLowerCase()}:` : '🏳️';
                    const totalInCountry = countryCounts[country] || 0;
                    description += `\n${flagEmoji} **${country}** (${totalInCountry})\n`;
                    
                    groups[country].forEach(user => {
                        const suppIcon = user.is_supporter ? ' 💖' : '';
                        description += `  • **${user.username}**${suppIcon}\n`;
                    });
                }

                return new EmbedBuilder()
                    .setTitle('🌐 Usuarios Vinculados por oAuth')
                    .setDescription(description)
                    .setColor(embedColor)
                    .setThumbnail("https://jeiden.s-ul.eu/3ssHl9Gd")
                    .setFooter({ text: `SengoBot • Página ${page}/${maxP}`, iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
                    .setTimestamp();
            };

            const getButtonsRow = (start, total) => {
                return buildPaginationRow({ prefix: 'con', current: start, total, pageSize: 10 });
            };

            const initialEmbed = generateEmbed(startIndex, pageNum, maxPages);

            let sent_message;
            const sendOptions = {
                embeds: [initialEmbed],
                components: totalUsers > 10 ? [getButtonsRow(startIndex, totalUsers)] : []
            };

            if (reply) {
                sent_message = await reply.reply(sendOptions);
            } else {
                sent_message = await message.channel.send(sendOptions);
            }

            if (totalUsers <= 10) return;

            const btnFilter = btnInt => btnInt.user.id === message.author.id;
            const collector = sent_message.createMessageComponentCollector({
                filter: btnFilter,
                idle: 30000
            });

            collector.on('collect', async i => {
                try {
                    await i.deferUpdate();

                    if (i.customId === 'con_first') {
                        startIndex = 0;
                    } else if (i.customId === 'con_prev') {
                        startIndex = Math.max(0, startIndex - 10);
                    } else if (i.customId === 'con_next') {
                        startIndex = startIndex + 10;
                    } else if (i.customId === 'con_last') {
                        startIndex = Math.floor((totalUsers - 1) / 10) * 10;
                    }

                    pageNum = Math.floor(startIndex / 10) + 1;
                    const updatedEmbed = generateEmbed(startIndex, pageNum, maxPages);

                    await i.editReply({
                        embeds: [updatedEmbed],
                        components: [getButtonsRow(startIndex, totalUsers)]
                    });
                } catch (err) {
                    console.error("Error al navegar la lista de contribuidores:", err);
                }
            });

            collector.on('end', async () => {
                try {
                    await sent_message.edit({ components: [] });
                } catch {}
            });
        } else {
            const embed = new EmbedBuilder()
                .setTitle('🌐 Usuarios Vinculados por oAuth')
                .setColor(embedColor)
                .setThumbnail("https://jeiden.s-ul.eu/3ssHl9Gd")
                .setDescription(`*Aún no hay usuarios vinculados a través del sistema seguro de oAuth.*`)
                .setFooter({ text: "SengoBot", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
                .setTimestamp();
            return { embeds: [embed] };
        }
    } catch (err) {
        console.error("Error inesperado en contribuidores:", err);
        const embed = new EmbedBuilder()
            .setTitle('🌐 Usuarios Vinculados por oAuth')
            .setColor(embedColor)
            .setThumbnail("https://jeiden.s-ul.eu/3ssHl9Gd")
            .setDescription(`*Ocurrió un error inesperado al procesar el comando.*`)
            .setFooter({ text: "SengoBot", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
            .setTimestamp();
        return { embeds: [embed] };
    }
}

run.alias = {
    "con": {
        "args": null
    }
}

run.description = {
    'header' : 'Lista de usuarios vinculados',
    'body' : 'Muestra la comunidad vinculada por oAuth agrupada por país con su estado de supporter.',
    'usage' : undefined
}

module.exports = { run }