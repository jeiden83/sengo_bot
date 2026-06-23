const OsuUserModel = require("../../../models/OsuUserModel.js");
const OsuTrackerModel = require("../../../models/OsuTrackerModel.js");
const osuTrackerService = require("../../../services/osuTrackerService.js");
const { PermissionFlagsBits, ChannelType } = require("discord.js");
const { t } = require("../../../utils/i18n.js");
const {
    doTrackHelpEmbed,
    doTrackAddEmbed,
    doTrackRemoveEmbed,
    doTrackListEmbed
} = require("../../../views/osuTrackerViews.js");

async function run(messages, args) {
    const { message, res } = messages;
    const guild = message.guild;
    const locale = message.locale || 'es';
    const prefix = message.prefix || 's.';

    if (!guild) {
        return t(locale, "track.only_guild");
    }

    // Validar permisos de administrador
    const member = message.member || await guild.members.fetch(message.author.id).catch(() => null);
    if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
        return t(locale, "track.err_admin_only");
    }

    const cleanArgs = args && Array.isArray(args) ? args.filter(Boolean) : [];
    if (cleanArgs.length === 0) {
        const embed = doTrackHelpEmbed(prefix, locale);
        return { embeds: [embed] };
    }

    const sub = cleanArgs[0].toLowerCase();

    if (sub === "canal" || sub === "channel") {
        if (!cleanArgs[1]) {
            const currentChannelId = await OsuTrackerModel.getTrackChannel(guild.id);
            if (currentChannelId) {
                return t(locale, "track.channel_current", { channelId: currentChannelId, prefix });
            }
            return t(locale, "track.channel_none", { prefix });
        }

        const channelArg = cleanArgs[1].toLowerCase();
        if (channelArg === "quitar" || channelArg === "desactivar" || channelArg === "none" || channelArg === "disable") {
            await OsuTrackerModel.setTrackChannel(guild.id, null);
            osuTrackerService.updateTrackChannelInMemory(guild.id, null);
            return t(locale, "track.channel_disable_success");
        }

        let channelId = null;
        const match = cleanArgs[1].match(/^<#(\d+)>$/) || cleanArgs[1].match(/^(\d+)$/);
        if (match) {
            channelId = match[1];
        }

        if (!channelId) {
            return t(locale, "track.channel_invalid");
        }

        const targetChannel = guild.channels.cache.get(channelId);
        if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
            return t(locale, "track.channel_not_text");
        }

        // Validar permisos del bot en el canal
        const botMember = guild.members.me || await guild.members.fetch(message.client.user.id).catch(() => null);
        if (botMember) {
            const permissions = targetChannel.permissionsFor(botMember);
            const missing = [];
            if (!permissions.has(PermissionFlagsBits.ViewChannel)) missing.push(locale === 'es' ? "`Ver canal` (ViewChannel)" : "`View Channel` (ViewChannel)");
            if (!permissions.has(PermissionFlagsBits.SendMessages)) missing.push(locale === 'es' ? "`Enviar mensajes` (SendMessages)" : "`Send Messages` (SendMessages)");
            if (!permissions.has(PermissionFlagsBits.EmbedLinks)) missing.push(locale === 'es' ? "`Insertar enlaces` (EmbedLinks)" : "`Embed Links` (EmbedLinks)");

            if (missing.length > 0) {
                const missingPermissions = missing.map(p => `- ${p}`).join("\n");
                return t(locale, "track.channel_missing_permissions", { channelId, missingPermissions });
            }
        }

        await OsuTrackerModel.setTrackChannel(guild.id, channelId);
        osuTrackerService.updateTrackChannelInMemory(guild.id, channelId);
        return t(locale, "track.channel_success", { channelId });
    }

    if (sub === "add" || sub === "agregar") {
        if (!cleanArgs[1]) {
            return t(locale, "track.add_usage", { prefix });
        }

        // Obtener el canal configurado
        const trackChannelId = await OsuTrackerModel.getTrackChannel(guild.id);
        if (!trackChannelId) {
            return t(locale, "track.add_no_channel", { prefix });
        }

        const targetChannel = guild.channels.cache.get(trackChannelId) || await guild.channels.fetch(trackChannelId).catch(() => null);
        if (!targetChannel) {
            return locale === 'es' 
                ? `❌ El canal de tracking configurado ya no existe o no tengo acceso a él.` 
                : `❌ The configured tracking channel no longer exists or I don't have access to it.`;
        }

        // Validar permisos del bot en el canal
        const botMember = guild.members.me || await guild.members.fetch(message.client.user.id).catch(() => null);
        if (botMember) {
            const permissions = targetChannel.permissionsFor(botMember);
            const missing = [];
            if (!permissions.has(PermissionFlagsBits.ViewChannel)) missing.push(locale === 'es' ? "`Ver canal` (ViewChannel)" : "`View Channel` (ViewChannel)");
            if (!permissions.has(PermissionFlagsBits.SendMessages)) missing.push(locale === 'es' ? "`Enviar mensajes` (SendMessages)" : "`Send Messages` (SendMessages)");
            if (!permissions.has(PermissionFlagsBits.EmbedLinks)) missing.push(locale === 'es' ? "`Insertar enlaces` (EmbedLinks)" : "`Embed Links` (EmbedLinks)");

            if (missing.length > 0) {
                const missingPermissions = missing.map(p => `- ${p}`).join("\n");
                return t(locale, "track.channel_missing_permissions", { channelId: trackChannelId, missingPermissions });
            }
        }

        const queryUsername = cleanArgs.slice(1).join(" ");

        // Buscar usuario en la API de osu!
        const osuUser = await OsuUserModel.getOsuUser({ username: [queryUsername], gamemode: 'osu' });
        if (typeof osuUser === "string" || !osuUser) {
            return t(locale, "track.add_not_found", { username: queryUsername });
        }

        const osuId = osuUser.id.toString();
        const osuUsername = osuUser.username;

        // Comprobar si está vinculado a algún Discord member en la base de datos
        let discordId = null;
        try {
            const linkedUsers = await OsuUserModel.getLinkedUsersMap();
            const linked = linkedUsers.get(osuId);
            if (linked) {
                discordId = linked.discord_id;
            }
        } catch (e) {
            console.error("[TRACK-COMMAND] Error al buscar vinculación de Discord:", e);
        }

        // Añadir a la base de datos
        const record = await OsuTrackerModel.addTrackedUser(guild.id, trackChannelId, osuId, osuUsername, discordId);
        
        // Añadir a la memoria en caliente
        await osuTrackerService.addTrackedUserInMemory(record);

        const userMention = discordId ? `<@${discordId}>` : "";
        const embed = doTrackAddEmbed(osuUsername, osuId, userMention, trackChannelId, locale);
        return { embeds: [embed] };
    }

    if (sub === "remove" || sub === "quitar" || sub === "delete") {
        if (!cleanArgs[1]) {
            return t(locale, "track.remove_usage", { prefix });
        }

        const queryUsername = cleanArgs.slice(1).join(" ");
        let osuId = null;
        let osuUsername = queryUsername;

        // Intentar buscar primero en los seguidos de esta guild por si acaso coincide con el nombre de usuario
        const trackedInGuild = await OsuTrackerModel.getTrackedUsersInGuild(guild.id);
        const matchLocal = trackedInGuild.find(u => u.osu_username.toLowerCase() === queryUsername.toLowerCase() || u.osu_id === queryUsername);
        
        if (matchLocal) {
            osuId = matchLocal.osu_id;
            osuUsername = matchLocal.osu_username;
        } else {
            // Si no está localmente por nombre directo, resolvemos contra la API de osu!
            const osuUser = await OsuUserModel.getOsuUser({ username: [queryUsername], gamemode: 'osu' });
            if (typeof osuUser !== "string" && osuUser) {
                osuId = osuUser.id.toString();
                osuUsername = osuUser.username;
            }
        }

        if (!osuId) {
            return t(locale, "track.add_not_found", { username: queryUsername });
        }

        // Remover de la base de datos
        const removed = await OsuTrackerModel.removeTrackedUser(guild.id, osuId);
        if (!removed) {
            return t(locale, "track.remove_not_found", { username: osuUsername });
        }

        // Remover de la memoria en caliente
        osuTrackerService.removeTrackedUserInMemory(guild.id, osuId);

        const embed = doTrackRemoveEmbed(osuUsername, osuId, locale);
        return { embeds: [embed] };
    }

    if (sub === "test" || sub === "prueba") {
        const config = require("../../../config.js");
        if (message.author.id !== config.OWNER_ID) {
            return "Este comando es exclusivo del desarrollador/owner del bot.";
        }

        // Obtener canal de tracking
        const trackChannelId = await OsuTrackerModel.getTrackChannel(guild.id);
        if (!trackChannelId) {
            return `No hay un canal de tracking configurado. Configúralo con \`${prefix}track canal #canal\` primero.`;
        }

        const channel = await message.client.channels.fetch(trackChannelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            return `El canal de tracking configurado no es válido o no tengo permisos para verlo.`;
        }

        // Obtener el primer usuario trackeado de esta guild, o usar peppy (ID: 2) si no hay
        const trackedList = await OsuTrackerModel.getTrackedUsersInGuild(guild.id);
        let testOsuId = "2"; // peppy
        let testDiscordId = null;
        if (trackedList.length > 0) {
            testOsuId = trackedList[0].osu_id;
            testDiscordId = trackedList[0].discord_id;
        }

        // Buscar jugada top #1
        const { v2 } = require('osu-api-extended');
        const { osuApiQueue } = require('../../../utils/OsuApiQueue.js');
        const { getBeatmap, getBeatmap_osu, calculatePP, normalizeScore, NewloadToken } = require('../../utils/osu.js');
        const { doOsuEmbed } = require('../../../views/osuEmbeds.js');

        // Indicamos en chat que estamos cargando el test
        const statusMsg = await message.reply("Cargando score de prueba desde la API de osu!...");

        try {
            await NewloadToken();
            const bestScores = await osuApiQueue.add(() => v2.scores.list({
                type: 'user_best',
                user_id: testOsuId,
                mode: 'osu',
                limit: 1
            }), 0);

            if (!bestScores || bestScores.length === 0) {
                await statusMsg.edit("El usuario de prueba no tiene mejores jugadas registradas en osu! standard.");
                return;
            }

            const score = bestScores[0];
            normalizeScore(score);

            const beatmapData = await getBeatmap(score.beatmap.id);
            const mapObj = await getBeatmap_osu(score.beatmap.beatmapset_id, score.beatmap.id, beatmapData);

            let maxAttrs = null;
            try {
                maxAttrs = calculatePP(score, mapObj, "maximo_pp");
            } catch (err) {
                console.error("[TRACK-COMMAND-TEST] Error calculating maxAttrs:", err);
            }

            const user_pp = score.pp ? score.pp : calculatePP(score, mapObj, null, maxAttrs).pp;
            const beatmap_max_combo = beatmapData.max_combo || (maxAttrs && maxAttrs.difficulty ? maxAttrs.difficulty.maxCombo : 0);

            const statistics = score.statistics || {};
            const miss = statistics.miss || 0;
            const total_hits = (statistics.great || 0) + (statistics.ok || 0) + (statistics.meh || 0) + miss;

            let pp_fc = null;
            const isFC = score.perfect || (miss === 0 && score.max_combo >= beatmap_max_combo - 2);
            if (!isFC) {
                try {
                    const fc_statistics = {
                        ...statistics,
                        great: (statistics.great || 0) + miss,
                        miss: 0
                    };
                    const fc_score = {
                        ...score,
                        max_combo: beatmap_max_combo,
                        statistics: fc_statistics
                    };
                    pp_fc = calculatePP(fc_score, mapObj, null, maxAttrs).pp;
                } catch (err) {
                    console.error("[TRACK-COMMAND-TEST] Error calculating pp_fc:", err);
                }
            }

            const pre_calculated = {
                "map": mapObj,
                "map_completion": score.passed ? 100 : total_hits / mapObj.nObjects,
                "maxAttrs": maxAttrs,
                "pp": user_pp,
                "beatmap_max_combo": beatmap_max_combo,
                "pp_fc": pp_fc
            };

            const mockMessage = {
                locale: locale,
                guild: guild,
                author: { id: testDiscordId || message.author.id }
            };

            const embed = await doOsuEmbed(mockMessage, score, pre_calculated, locale, 'classic');

            // Colores
            embed.setColor('#FFD700'); // Dorado para simular Top #1
            embed.setAuthor({
                name: `¡Nueva Top Play #1! ▸ ${score.user.username}`,
                url: `https://osu.ppy.sh/users/${score.user.id}`,
                iconURL: score.user.avatar_url
            });

            await channel.send({ embeds: [embed] });
            await statusMsg.edit(`¡Anuncio de prueba enviado con éxito al canal <#${trackChannelId}>!`);
            
            // Liberar
            if (mapObj) {
                try {
                    mapObj.free();
                } catch (err) {
                    console.error("[TRACK-COMMAND-TEST] Error al liberar Beatmap de WASM:", err);
                }
            }
        } catch (e) {
            console.error("[TRACK-COMMAND-TEST] Error al enviar embed de prueba:", e);
            await statusMsg.edit(`Error al procesar la jugada de prueba: ${e.message}`);
        }
        return;
    }

    if (sub === "list" || sub === "lista") {
        const trackedInGuild = await OsuTrackerModel.getTrackedUsersInGuild(guild.id);
        
        if (trackedInGuild.length === 0) {
            return t(locale, "track.list_empty", { prefix });
        }

        const currentChannelId = await OsuTrackerModel.getTrackChannel(guild.id);
        const embed = doTrackListEmbed(guild.name, trackedInGuild, currentChannelId, locale);
        return { embeds: [embed] };
    }

    // Por defecto, ayuda
    const embed = doTrackHelpEmbed(prefix, locale);
    return { embeds: [embed] };
}

run.description = {
    'header': t('es', 'commands.track.header'),
    'body': t('es', 'commands.track.body'),
    'usage': t('es', 'commands.track.usage')
};

module.exports = { run, description: run.description };
