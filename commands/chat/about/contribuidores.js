const OsuUserModel = require('../../../models/OsuUserModel.js');
const { buildPaginationRow } = require('../../../views/osuViewHelpers.js');
const { doContributorsEmbed, doContributorsEmptyEmbed, doContributorsErrorEmbed } = require('../../../views/contributorsViews.js');
const { t } = require('../../../utils/i18n.js');

async function run(messages, args) {
    const { message, res, reply } = messages;
    const locale = message.locale || 'es';

    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#378a91';

    const isForce = args && args.some(arg => arg && typeof arg === 'string' && (arg.toLowerCase() === '-force' || arg.toLowerCase() === 'force'));
    let syncSummary = "";

    if (isForce) {
        let tempMsg;
        const msgText = t(locale, 'contributors.syncing');
        if (reply) {
            tempMsg = await reply.reply({ content: msgText });
        } else {
            tempMsg = await message.channel.send({ content: msgText });
        }

        try {
            const syncResult = await OsuUserModel.syncAllSupporterStatuses();
            let syncSummaryStr = t(locale, 'contributors.sync_success', {
                success: syncResult.successCount,
                fail: syncResult.failCount
            });
            if (syncResult.changes.length > 0) {
                const changesStr = syncResult.changes.map(c => `${c.username}: ${c.oldStatus ? '💖' : '❌'}→${c.newStatus ? '💖' : '❌'}`).join(', ');
                syncSummaryStr += t(locale, 'contributors.sync_changes', { changes: changesStr });
            }
            syncSummary = syncSummaryStr;
        } catch (err) {
            console.error("Error en s.con -force:", err);
            syncSummary = t(locale, 'contributors.sync_error', { error: err.message });
        }

        if (tempMsg && !reply) {
            try { await tempMsg.delete(); } catch {}
        }
    }

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

            const getButtonsRow = (start, total) => {
                return buildPaginationRow({ prefix: 'con', current: start, total, pageSize: 10 });
            };

            const initialEmbed = doContributorsEmbed({
                chunk: data.slice(startIndex, startIndex + 10),
                totalUsers,
                countryCounts,
                page: pageNum,
                maxPages,
                embedColor,
                syncSummary,
                locale
            });

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
                    const updatedEmbed = doContributorsEmbed({
                        chunk: data.slice(startIndex, startIndex + 10),
                        totalUsers,
                        countryCounts,
                        page: pageNum,
                        maxPages,
                        embedColor,
                        syncSummary,
                        locale
                    });

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
                } catch { }
            });
        } else {
            const embed = doContributorsEmptyEmbed(embedColor, locale);
            return { embeds: [embed] };
        }
    } catch (err) {
        console.error("Error inesperado en contribuidores:", err);
        const embed = doContributorsErrorEmbed(embedColor, locale);
        return { embeds: [embed] };
    }
}

run.alias = {
    "con": {
        "args": null
    }
}

run.description = {
    'header': 'Lista de usuarios vinculados',
    'body': 'Muestra la comunidad vinculada por oAuth agrupada por país con su estado de supporter.',
    'usage': undefined
}

module.exports = { run };