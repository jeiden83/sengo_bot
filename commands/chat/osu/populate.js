const PopulationService = require('../../../services/populationService.js');
const { t } = require('../../../utils/i18n.js');
const CONFIG = require('../../../config.js');
const {
    buildPopulateHelpEmbed,
    buildPopulateHelpNavigationRow,
    buildPopulateStatusEmbed,
    buildPopulateDmEmbed,
    buildPopulateWorkersEmbed,
    buildPopulateTopEmbed
} = require('../../../views/populateViews.js');

async function run({ message, res, reply, logger }, args) {
    const locale = message.locale || 'es';
    const arg1 = args[0] ? args[0].toLowerCase() : null;
    const ownerId = process.env.OWNER_ID || CONFIG.ownerId || CONFIG.OWNER_ID;

    // ----------------------------------------------------
    // 1. SUBCOMANDO: -lista / -l (Listar estado de países)
    // ----------------------------------------------------
    if (arg1 === '-lista' || arg1 === '-l' || arg1 === 'lista') {
        const list = await PopulationService.getCountryStatusList();
        const embed = buildPopulateStatusEmbed(list, locale);
        return { embeds: [embed] };
    }

    // ----------------------------------------------------
    // 2. SUBCOMANDO: -top / -ranking (Ranking de Colaboradores)
    // ----------------------------------------------------
    if (arg1 === '-top' || arg1 === '-ranking' || arg1 === 'top' || arg1 === 'ranking') {
        const topList = await PopulationService.getTopContributors(10);
        const embed = buildPopulateTopEmbed(topList, locale);
        return { embeds: [embed] };
    }

    // ----------------------------------------------------
    // 2. SUBCOMANDO: -permitir / -allow (Permitir país - Owner)
    // ----------------------------------------------------
    if (arg1 === '-permitir' || arg1 === '-allow' || arg1 === 'permitir' || arg1 === 'allow') {
        if (message.author.id !== ownerId) {
            return t(locale, 'populate.err_owner_only_allow');
        }

        const targetCountry = args[1] ? args[1].toUpperCase() : null;
        if (!targetCountry || targetCountry.length !== 2) {
            return t(locale, 'populate.err_country_code_required');
        }

        PopulationService.allowCountry(targetCountry);
        return t(locale, 'populate.allow_success', { country: targetCountry });
    }

    // ----------------------------------------------------
    // 3. SUBCOMANDO: -stop / -parar (Kill Switch del Owner)
    // ----------------------------------------------------
    if (arg1 === '-stop' || arg1 === '-parar' || arg1 === 'stop' || arg1 === 'parar') {
        if (message.author.id !== ownerId) {
            return t(locale, 'populate.err_owner_only_stop');
        }

        const targetCountry = args[1] ? args[1].toUpperCase() : null;
        if (!targetCountry || targetCountry.length !== 2) {
            return t(locale, 'populate.err_country_code_required');
        }

        PopulationService.stopCountry(targetCountry);
        return t(locale, 'populate.stop_success', { country: targetCountry });
    }

    // ----------------------------------------------------
    // 4. SUBCOMANDO: -worker / -workers (Monitor de Workers del Owner)
    // ----------------------------------------------------
    if (arg1 === '-worker' || arg1 === '-workers' || arg1 === 'worker' || arg1 === 'workers') {
        if (message.author.id !== ownerId) {
            return t(locale, 'populate.err_owner_only_workers');
        }

        const workers = await PopulationService.getActiveWorkersList();
        const embed = buildPopulateWorkersEmbed(workers, locale);

        try {
            await message.author.send({ embeds: [embed] });
            return t(locale, 'populate.workers_dm_sent_reply');
        } catch (err) {
            return t(locale, 'populate.err_dm_failed');
        }
    }

    // ----------------------------------------------------
    // 4. SUBCOMANDO: <PAÍS> (Iniciar poblamiento para un país)
    // ----------------------------------------------------
    if (arg1 && arg1.length === 2) {
        const countryCode = arg1.toUpperCase();

        const session = await PopulationService.createWorkerSession(message.author.id, message.author.username, countryCode);

        if (session.error === 'NOT_ALLOWED') {
            return t(locale, 'populate.err_not_allowed', { country: countryCode });
        }

        if (session.error === 'COMPLETED') {
            return t(locale, 'populate.err_completed', { country: countryCode });
        }

        if (session.error === 'NO_SUPPORTER') {
            return t(locale, 'populate.err_no_supporter', { country: countryCode });
        }

        // Enviar mensaje al DM del colaborador
        try {
            const dmEmbed = buildPopulateDmEmbed(session.key, countryCode, message.author.username, locale);
            await message.author.send({ embeds: [dmEmbed] });
            return t(locale, 'populate.dm_sent_reply', { country: countryCode });
        } catch (err) {
            return t(locale, 'populate.err_dm_failed');
        }
    }

    // ----------------------------------------------------
    // 5. MENU DE AYUDA (s.populate sin argumentos)
    // ----------------------------------------------------
    const isOwner = message.author.id === ownerId;
    const initialEmbed = buildPopulateHelpEmbed(locale, 0);
    const initialRows = isOwner ? [buildPopulateHelpNavigationRow(0, locale)] : [];

    const sendOptions = {
        embeds: [initialEmbed],
        components: initialRows
    };

    let sentMessage;
    if (reply) {
        sentMessage = await reply.reply(sendOptions);
    } else if (message && message.channel) {
        sentMessage = await message.channel.send(sendOptions);
    }

    if (!sentMessage || !isOwner) return;

    const collector = sentMessage.createMessageComponentCollector({
        idle: 60000 // 60s inactividad
    });

    collector.on('collect', async i => {
        if (i.user.id !== message.author.id) {
            return i.reply({
                content: t(locale, 'populate.only_author'),
                ephemeral: true
            }).catch(() => {});
        }

        try {
            await i.deferUpdate();

            const pageIndex = parseInt(i.customId.replace("pop_help_page_", ""), 10);
            if (isNaN(pageIndex)) return;

            const nextEmbed = buildPopulateHelpEmbed(locale, pageIndex);
            const nextRows = [buildPopulateHelpNavigationRow(pageIndex, locale)];

            await i.editReply({
                embeds: [nextEmbed],
                components: nextRows
            });
        } catch (err) {
            console.error("Error en navegación de s.populate:", err);
        }
    });

    collector.on('end', async () => {
        try {
            await sentMessage.edit({ components: [] });
        } catch (e) {}
    });

    return;
}

run.alias = {
    'poblar': { args: null },
    'pop': { args: null }
};

module.exports = {
    run,
    name: 'populate',
    aliases: ['poblar', 'pop'],
    type: 'osu',
    description: 'Gestiona e inicia sesiones distribuidas de poblamiento para países.'
};
