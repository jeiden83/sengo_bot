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
