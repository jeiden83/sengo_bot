// commands/chat/osu/droid.js
// Controlador para comandos de osu!droid (s.droid / s.osudroid)

const osuDroidModel = require("../../../models/osuDroidModel.js");
const osuDroidEmbeds = require("../../../views/osuDroidEmbeds.js");
const { lookupBeatmapByMD5 } = require("../../../models/BeatmapModel.js");
const { findBeatmapInChannel } = require("../../utils/argsParser.js");
const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message, res, reply, logger } = messages;
    const locale = message.locale || 'es';
    const authorId = message.author?.id;

    const rawArgs = Array.isArray(args) ? args.filter(a => typeof a === 'string' && a.trim().length > 0) : [];
    const firstArg = (rawArgs[0] || '').toLowerCase();

    // 1. Subcomando: Link
    if (firstArg === 'link' || firstArg === 'vincular') {
        const target = rawArgs[1];
        if (!target) {
            return t(locale, 'droid.link_usage') || '💡 Uso: `s.droid link <nombre_o_uid>`';
        }

        if (logger) logger.process(t(locale, 'droid.searching') || 'Consultando API de osu!droid...');
        const profile = await osuDroidModel.resolveDroidUser(target);
        if (!profile) {
            return t(locale, 'droid.user_not_found', { user: target }) || `❌ No se encontró al jugador **${target}** en osu!droid.`;
        }

        const linkRes = await osuDroidModel.linkDroidUser(authorId, profile.UserId);
        if (!linkRes.success) {
            return `❌ Error al vincular cuenta en la base de datos: ${linkRes.error}`;
        }

        return t(locale, 'droid.link_success', { username: profile.Username, uid: profile.UserId }) ||
            `✅ Cuenta de osu!droid **${profile.Username}** (UID: \`${profile.UserId}\`) vinculada exitosamente.`;
    }

    // 2. Subcomando: Unlink
    if (firstArg === 'unlink' || firstArg === 'desvincular') {
        await osuDroidModel.unlinkDroidUser(authorId);
        return t(locale, 'droid.unlink_success') || '✅ Se ha desvinculado tu cuenta de osu!droid.';
    }

    // Identificar el subcomando activo o caer en 'profile'
    let subCommand = 'profile';
    let cleanArgs = [...rawArgs];

    if (['recent', 'rs', 'r'].includes(firstArg)) {
        subCommand = 'recent';
        cleanArgs.shift();
    } else if (['top', 'best', 'mejores'].includes(firstArg)) {
        subCommand = 'top';
        cleanArgs.shift();
    } else if (['lb', 'leaderboard', 'topmap'].includes(firstArg)) {
        subCommand = 'leaderboard';
        cleanArgs.shift();
    } else if (['c', 'compare', 'comparar'].includes(firstArg)) {
        subCommand = 'compare';
        cleanArgs.shift();
    } else if (['card', 'tarjeta'].includes(firstArg)) {
        subCommand = 'card';
        cleanArgs.shift();
    } else if (['skills', 'skill', 'habilidad', 'habilidades'].includes(firstArg)) {
        subCommand = 'skills';
        cleanArgs.shift();
    } else if (['profile', 'perfil', 'p'].includes(firstArg)) {
        subCommand = 'profile';
        cleanArgs.shift();
    }

    // 2.5. Subcomando: Tarjeta Canvas de perfil
    if (subCommand === 'card') {
        const cardCmd = require("./card.js");
        return cardCmd.run(messages, [...cleanArgs, '-droid']);
    }

    // 2.6. Subcomando: Desglose de habilidades (Skills)
    if (subCommand === 'skills') {
        const skillsCmd = require("./skills.js");
        return skillsCmd.run(messages, [...cleanArgs, '-droid']);
    }

    // 2.7. Subcomando: Top Plays
    if (subCommand === 'top') {
        const topCmd = require("./top.js");
        return topCmd.run(messages, [...cleanArgs, '-droid']);
    }

    // 2.8. Subcomando: Recent Score
    if (subCommand === 'recent') {
        const rsCmd = require("./rs.js");
        return rsCmd.run(messages, [...cleanArgs, '-droid']);
    }

    // 2.9. Subcomando: Leaderboard de Mapa en osu!droid
    if (subCommand === 'leaderboard') {
        const lbCmd = require("./lb.js");
        return lbCmd.run(messages, [...cleanArgs, '-droid']);
    }

    // 2.10. Subcomando: Compare (Buscar score en el mapa actual)
    if (subCommand === 'compare') {
        const cCmd = require("./c.js");
        return cCmd.run(messages, [...cleanArgs, '-droid']);
    }

    // 2.11. Subcomando por defecto: Profile
    const osuCmd = require("./osu.js");
    return osuCmd.run(messages, [...cleanArgs, '-droid']);
}

/**
 * Helper para despachar mensajes y configurar el colector de botones interactivos
 */
async function handleInteractiveDroidMessage({ message, reply, initialPayload, authorId, profile, locale }) {
    let sentMessage;
    if (typeof reply === 'function') {
        sentMessage = await reply(initialPayload);
    } else if (message?.channel && typeof message.channel.send === 'function') {
        sentMessage = await message.channel.send(initialPayload);
    }

    if (!sentMessage || typeof sentMessage.createMessageComponentCollector !== 'function') {
        return sentMessage || initialPayload;
    }

    const collector = sentMessage.createMessageComponentCollector({
        filter: i => i.user.id === authorId,
        time: 120000
    });

    collector.on('collect', async i => {
        try {
            const customId = i.customId;
            const parts = customId.split('_');
            if (parts[0] !== 'droid') return;

            const action = parts[1];
            const userId = parts[2];

            if (action === 'prof') {
                const freshProfile = await osuDroidModel.fetchProfileByUid(userId) || profile;
                const embed = osuDroidEmbeds.doDroidProfileEmbed(message, freshProfile, locale);
                await i.update(embed);
            } else if (action === 'rs') {
                const freshProfile = await osuDroidModel.fetchProfileByUid(userId) || profile;
                if (freshProfile.Last50Scores && freshProfile.Last50Scores.length > 0) {
                    const score = freshProfile.Last50Scores[0];
                    const bInfo = score.MapHash ? await lookupBeatmapByMD5(score.MapHash).catch(() => null) : null;
                    const embed = osuDroidEmbeds.doDroidRecentEmbed(message, freshProfile, score, bInfo, locale);
                    await i.update(embed);
                } else {
                    await i.reply({ content: t(locale, 'droid.no_recent', { user: freshProfile.Username }), ephemeral: true });
                }
            } else if (action === 'top') {
                const targetPage = parseInt(parts[3], 10) || 0;
                const freshProfile = await osuDroidModel.fetchProfileByUid(userId) || profile;
                const embed = osuDroidEmbeds.doDroidTopEmbed(message, freshProfile, targetPage, 5, locale);
                await i.update(embed);
            }
        } catch (err) {
            console.error('[droid.js] Error en colector interactivo:', err);
        }
    });

    return sentMessage;
}

run.description = {
    header: "Consulta perfiles, jugadas y leaderboards de osu!droid (cliente móvil)",
    body: "Permite explorar el rendimiento oficial en osu!droid, ver la última jugada con estadísticas táctiles (sliders, hits, PP), navegar por el Top 50, consultar el leaderboard de un mapa y vincular tu cuenta.",
    usage: "s.droid [usuario_o_uid]\ns.droid card [usuario]\ns.droid recent [usuario]\ns.droid top [usuario]\ns.droid lb\ns.droid compare\ns.droid link <nombre_o_uid>\ns.droid unlink"
};

run.alias = ["osudroid", "odroid"];

module.exports = { run, description: run.description };
