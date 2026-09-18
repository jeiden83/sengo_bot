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
    } else if (['profile', 'perfil', 'p'].includes(firstArg)) {
        subCommand = 'profile';
        cleanArgs.shift();
    }

    // 3. Subcomando: Leaderboard de Mapa en osu!droid
    if (subCommand === 'leaderboard') {
        if (logger) logger.process(t(locale, 'droid.searching') || 'Consultando API de osu!droid...');

        let hash = null;
        let beatmapInfo = null;

        // Verificar si se pasó un hash MD5 explícito
        const potentialHash = cleanArgs.find(a => /^[a-f0-9]{32}$/i.test(a));
        if (potentialHash) {
            hash = potentialHash;
            beatmapInfo = await lookupBeatmapByMD5(hash).catch(() => null);
        } else {
            // Buscar mapa referenciado en el canal
            const found = await findBeatmapInChannel(message, !!message.reference?.messageId);
            if (found && found.beatmap_url) {
                const BeatmapModel = require("../../../models/BeatmapModel.js");
                const bId = found.beatmap_url.replace('set/', '');
                const bData = await BeatmapModel.getBeatmap(bId).catch(() => null);
                if (bData && bData.checksum) {
                    hash = bData.checksum;
                    beatmapInfo = bData;
                }
            }
        }

        if (!hash) {
            return t(locale, 'droid.no_map_found') || '❌ No se encontró ningún beatmap de osu! en este canal o no se especificó un hash válido.';
        }

        const lbData = await osuDroidModel.fetchLeaderboardByHash(hash, 1);
        if (!lbData || !lbData.Top50Plays || lbData.Top50Plays.length === 0) {
            return t(locale, 'droid.lb_empty') || '❌ No se encontraron jugadas en osu!droid para este mapa.';
        }

        const lbPayload = osuDroidEmbeds.doDroidLeaderboardEmbed(message, hash, lbData, beatmapInfo, 1, locale);
        let sentMessage;
        if (typeof reply === 'function') {
            sentMessage = await reply(lbPayload);
        } else if (message?.channel && typeof message.channel.send === 'function') {
            sentMessage = await message.channel.send(lbPayload);
        }

        if (!sentMessage || typeof sentMessage.createMessageComponentCollector !== 'function') {
            return sentMessage || lbPayload;
        }

        const collector = sentMessage.createMessageComponentCollector({
            filter: i => i.user.id === authorId,
            time: 120000
        });

        collector.on('collect', async i => {
            try {
                const parts = i.customId.split('_');
                if (parts[0] === 'droid' && parts[1] === 'lb') {
                    const targetHash = parts[2];
                    const targetPage = parseInt(parts[3], 10) || 1;
                    const newLbData = await osuDroidModel.fetchLeaderboardByHash(targetHash, 1);
                    const updatedPayload = osuDroidEmbeds.doDroidLeaderboardEmbed(message, targetHash, newLbData, beatmapInfo, targetPage, locale);
                    await i.update(updatedPayload);
                }
            } catch (err) {
                console.error('[droid.js] Error en colector de leaderboard:', err);
            }
        });

        return sentMessage;
    }

    // Resolver el jugador objetivo para subcomandos: profile, recent, top, compare
    let targetUser = cleanArgs.join(' ').trim();
    if (!targetUser) {
        // Verificar si el autor tiene cuenta vinculada
        const linkedUid = await osuDroidModel.getLinkedDroidUid(authorId);
        if (linkedUid) {
            targetUser = linkedUid;
        }
    }

    if (!targetUser) {
        return t(locale, 'droid.not_linked') ||
            '⚠️ No tienes una cuenta de osu!droid vinculada. Usa `s.droid link <usuario_o_uid>` o especifica un usuario.';
    }

    if (logger) logger.process(t(locale, 'droid.searching') || 'Consultando API de osu!droid...');
    const profile = await osuDroidModel.resolveDroidUser(targetUser);

    if (!profile) {
        return t(locale, 'droid.user_not_found', { user: targetUser }) ||
            `❌ No se encontró al jugador **${targetUser}** en osu!droid.`;
    }

    // 4. Subcomando: Compare (Buscar score en el mapa actual)
    if (subCommand === 'compare') {
        const found = await findBeatmapInChannel(message, !!message.reference?.messageId);
        let hash = null;
        let beatmapInfo = null;

        if (found && found.beatmap_url) {
            const BeatmapModel = require("../../../models/BeatmapModel.js");
            const bId = found.beatmap_url.replace('set/', '');
            const bData = await BeatmapModel.getBeatmap(bId).catch(() => null);
            if (bData && bData.checksum) {
                hash = bData.checksum;
                beatmapInfo = bData;
            }
        }

        if (!hash) {
            return t(locale, 'droid.no_map_found') || '❌ No se encontró ningún beatmap de osu! en este canal.';
        }

        const scores = await osuDroidModel.searchScore(profile.UserId, hash);
        if (!scores || !Array.isArray(scores) || scores.length === 0) {
            return `❌ El jugador **${profile.Username}** no tiene puntuaciones registradas en este mapa en osu!droid.`;
        }

        const targetScore = scores[0];
        // Adaptar campos para la vista de recent
        const adaptedScore = {
            ScoreId: targetScore.id,
            Filename: targetScore.filename,
            MapHash: targetScore.hash,
            Mods: targetScore.mods,
            MapScore: targetScore.score,
            MapCombo: targetScore.combo,
            MapRank: targetScore.mark,
            MapPerfect: targetScore.perfect,
            MapGood: targetScore.good,
            MapBad: targetScore.bad,
            MapMiss: targetScore.miss,
            MapAccuracy: targetScore.accuracy,
            MapPP: targetScore.pp,
            PlayedDate: targetScore.date ? new Date(targetScore.date * 1000).toISOString() : null,
            SliderHeadHit: targetScore.sliderHeadHit,
            SliderTickHit: targetScore.sliderTickHit,
            SliderRepeatHit: targetScore.sliderRepeatHit,
            SliderEndHit: targetScore.sliderEndHit
        };

        const comparePayload = osuDroidEmbeds.doDroidRecentEmbed(message, profile, adaptedScore, beatmapInfo, locale);
        if (typeof reply === 'function') return reply(comparePayload);
        if (message?.channel?.send) return message.channel.send(comparePayload);
        return comparePayload;
    }

    // 5. Subcomando: Recent Score
    if (subCommand === 'recent') {
        if (!profile.Last50Scores || profile.Last50Scores.length === 0) {
            return t(locale, 'droid.no_recent', { user: profile.Username }) ||
                `❌ El jugador **${profile.Username}** no tiene jugadas recientes en osu!droid.`;
        }

        const recentScore = profile.Last50Scores[0];
        let beatmapInfo = null;
        if (recentScore.MapHash) {
            beatmapInfo = await lookupBeatmapByMD5(recentScore.MapHash).catch(() => null);
        }

        const recentPayload = osuDroidEmbeds.doDroidRecentEmbed(message, profile, recentScore, beatmapInfo, locale);
        return handleInteractiveDroidMessage({ message, reply, initialPayload: recentPayload, authorId, profile, locale });
    }

    // 6. Subcomando: Top Plays
    if (subCommand === 'top') {
        if (!profile.Top50Plays || profile.Top50Plays.length === 0) {
            return t(locale, 'droid.no_top', { user: profile.Username }) ||
                `❌ El jugador **${profile.Username}** no tiene jugadas en su Top de osu!droid.`;
        }

        const topPayload = osuDroidEmbeds.doDroidTopEmbed(message, profile, 0, 5, locale);
        return handleInteractiveDroidMessage({ message, reply, initialPayload: topPayload, authorId, profile, locale });
    }

    // 7. Subcomando por defecto: Profile
    const profilePayload = osuDroidEmbeds.doDroidProfileEmbed(message, profile, locale);
    return handleInteractiveDroidMessage({ message, reply, initialPayload: profilePayload, authorId, profile, locale });
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
    usage: "s.droid [usuario_o_uid]\ns.droid recent [usuario]\ns.droid top [usuario]\ns.droid lb\ns.droid compare\ns.droid link <nombre_o_uid>\ns.droid unlink"
};

run.alias = ["osudroid", "odroid"];

module.exports = { run, description: run.description };
