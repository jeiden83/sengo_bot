const { SlashCommandBuilder, ChannelType } = require("discord.js");
const mapperChatCommand = require("../chat/osu/mapper.js");

const data = new SlashCommandBuilder()
    .setName("mapper")
    .setDescription("Comandos de estadísticas y tracking de mappers en osu!")
    // Subcomando: perfil
    .addSubcommand(sub =>
        sub.setName("perfil")
            .setDescription("Muestra las estadísticas de creador/mapper de un usuario")
            .addStringOption(opt => opt.setName("usuario").setDescription("Nombre de usuario de osu!, mención o ID de Discord").setRequired(false))
            .addStringOption(opt => opt.setName("modo").setDescription("Modo de juego").setRequired(false).addChoices(
                { name: "Standard", value: "std" },
                { name: "Taiko", value: "taiko" },
                { name: "Catch", value: "ctb" },
                { name: "Mania", value: "mania" }
            ))
            .addStringOption(opt => opt.setName("tipo").setDescription("Filtrar categoría de mapas").setRequired(false).addChoices(
                { name: "Rankeados", value: "ranked" },
                { name: "WIP / Pending", value: "pending" },
                { name: "Loved", value: "loved" },
                { name: "Graveyard", value: "graveyard" },
                { name: "GDs (Guest Difficulties)", value: "gd" },
                { name: "Todos", value: "all" }
            ))
    )
    // Subcomando: top
    .addSubcommand(sub =>
        sub.setName("top")
            .setDescription("Muestra la tabla de clasificación de mappers")
            .addStringOption(opt => opt.setName("pais").setDescription("Filtrar por código de país (ej: MX, VE, CL, US)").setRequired(false))
            .addStringOption(opt => opt.setName("sort").setDescription("Criterio de ordenamiento").setRequired(false).addChoices(
                { name: "Kudosu", value: "kudosus" },
                { name: "Dificultades Invitadas (GDs)", value: "gd" },
                { name: "Mapas Rankeados", value: "ranked" },
                { name: "Mapas WIP / Pending", value: "wip" },
                { name: "Mapas Loved", value: "loved" },
                { name: "Seguidores", value: "followers" },
                { name: "Graveyard", value: "graveyard" },
                { name: "Reciente", value: "recent" }
            ))
            .addBooleanOption(opt => opt.setName("servidor").setDescription("Muestra el top de mappers vinculados en este servidor").setRequired(false))
            .addBooleanOption(opt => opt.setName("global").setDescription("Muestra el top global de mappers").setRequired(false))
            .addBooleanOption(opt => opt.setName("sengo").setDescription("Muestra el top de mappers vinculados a Sengo").setRequired(false))
            .addBooleanOption(opt => opt.setName("refresh").setDescription("Fuerza la actualización de la caché").setRequired(false))
    )
    // Subcomando: bn
    .addSubcommand(sub =>
        sub.setName("bn")
            .setDescription("Muestra la lista de Beatmap Nominators (BNs)")
            .addStringOption(opt => opt.setName("usuario").setDescription("Buscar perfil de un BN específico").setRequired(false))
            .addStringOption(opt => opt.setName("modo").setDescription("Filtrar por modo de juego de BN").setRequired(false).addChoices(
                { name: "Standard", value: "std" },
                { name: "Taiko", value: "taiko" },
                { name: "Catch", value: "ctb" },
                { name: "Mania", value: "mania" }
            ))
            .addBooleanOption(opt => opt.setName("activo").setDescription("Mostrar solo BNs con solicitudes abiertas").setRequired(false))
            .addBooleanOption(opt => opt.setName("refresh").setDescription("Fuerza la actualización de datos").setRequired(false))
    )
    // Subgrupo de comandos: track
    .addSubcommandGroup(group =>
        group.setName("track")
            .setDescription("Configuración y gestión de Mapping Tracker")
            .addSubcommand(sub =>
                sub.setName("usuario")
                    .setDescription("Configura tus alertas de tracking (o de otro usuario si eres Admin)")
                    .addStringOption(opt => opt.setName("usuario").setDescription("ID, mención o username del mapper (dejar vacío para ti)").setRequired(false))
                    .addBooleanOption(opt => opt.setName("upload").setDescription("Notificar cuando subas/suban un nuevo mapa por primera vez").setRequired(false))
                    .addBooleanOption(opt => opt.setName("disqualified").setDescription("Notificar cuando el mapa sea descalificado").setRequired(false))
                    .addBooleanOption(opt => opt.setName("ranked").setDescription("Notificar cuando pase a Ranked / Approved").setRequired(false))
                    .addBooleanOption(opt => opt.setName("qualified").setDescription("Notificar cuando ingrese a Qualified").setRequired(false))
                    .addBooleanOption(opt => opt.setName("loved").setDescription("Notificar cuando ingrese a Loved").setRequired(false))
                    .addBooleanOption(opt => opt.setName("pending").setDescription("Notificar updates WIP de mapas existentes").setRequired(false))
                    .addBooleanOption(opt => opt.setName("graveyard").setDescription("Notificar cuando pase a Graveyard").setRequired(false))
                    .addBooleanOption(opt => opt.setName("revive").setDescription("Notificar cuando reviva un mapa").setRequired(false))
                    .addBooleanOption(opt => opt.setName("nomination").setDescription("Notificar nominaciones de BN").setRequired(false))
                    .addBooleanOption(opt => opt.setName("todos").setDescription("Notificar todos los eventos (incluyendo WIP y Graveyard)").setRequired(false))
                    .addBooleanOption(opt => opt.setName("servidor").setDescription("Solo Admins: Añadir a todos los miembros vinculados del servidor").setRequired(false))
            )
            .addSubcommand(sub =>
                sub.setName("canal")
                    .setDescription("Solo Admins: Configura o desactiva el canal de notificaciones")
                    .addChannelOption(opt => opt.setName("canal").setDescription("Canal de texto del servidor").addChannelTypes(ChannelType.GuildText).setRequired(false))
                    .addBooleanOption(opt => opt.setName("desactivar").setDescription("Desactivar el tracking en este servidor").setRequired(false))
            )
            .addSubcommand(sub =>
                sub.setName("test")
                    .setDescription("Solo Admins: Envía una notificación de prueba al canal de tracking")
                    .addStringOption(opt => opt.setName("evento").setDescription("Tipo de evento a probar").setRequired(false).addChoices(
                        { name: "Upload (Nuevo Mapa)", value: "upload" },
                        { name: "Disqualified (Descalificado)", value: "disqualified" },
                        { name: "Ranked", value: "ranked" },
                        { name: "Qualified", value: "qualified" },
                        { name: "Loved", value: "loved" },
                        { name: "Pending / WIP", value: "pending" },
                        { name: "Graveyard", value: "graveyard" },
                        { name: "Revive", value: "revive" },
                        { name: "Nomination", value: "nomination" }
                    ))
                    .addStringOption(opt => opt.setName("comentario").setDescription("Comentario de prueba simulado").setRequired(false))
            )
            .addSubcommand(sub =>
                sub.setName("lista")
                    .setDescription("Muestra la guía interactiva y los mappers rastreados en este servidor")
            )
    );

async function run(interaction, res) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(false);
    const args = [];

    if (group === 'track') {
        args.push('-track');
        if (sub === 'canal') {
            args.push('-canal');
            const channel = interaction.options.getChannel('canal');
            const desactivar = interaction.options.getBoolean('desactivar');
            if (channel) args.push(`<#${channel.id}>`);
        } else if (sub === 'usuario') {
            args.push('-usuario');
            const user = interaction.options.getString('usuario');
            const server = interaction.options.getBoolean('servidor');
            if (user) args.push(user);
            if (server) args.push('-server');

            if (interaction.options.getBoolean('upload')) args.push('-upload');
            if (interaction.options.getBoolean('disqualified')) args.push('-disqualified');
            if (interaction.options.getBoolean('ranked')) args.push('-ranked');
            if (interaction.options.getBoolean('qualified')) args.push('-qualified');
            if (interaction.options.getBoolean('loved')) args.push('-loved');
            if (interaction.options.getBoolean('pending')) args.push('-pending');
            if (interaction.options.getBoolean('graveyard')) args.push('-graveyard');
            if (interaction.options.getBoolean('revive')) args.push('-revive');
            if (interaction.options.getBoolean('nomination')) args.push('-nomination');
            if (interaction.options.getBoolean('todos')) args.push('-all');
        } else if (sub === 'test') {
            args.push('-test');
            const evento = interaction.options.getString('evento');
            const comentario = interaction.options.getString('comentario');
            if (evento) args.push(`-${evento}`);
            if (comentario) {
                args.push('-comment');
                args.push(comentario);
            }
        }
    } else if (sub === 'perfil') {
        const user = interaction.options.getString('usuario');
        const modo = interaction.options.getString('modo');
        const tipo = interaction.options.getString('tipo');
        if (user) args.push(user);
        if (modo) { args.push('-m'); args.push(modo); }
        if (tipo && tipo !== 'all') args.push(`-${tipo}`);
    } else if (sub === 'top') {
        args.push('-top');
        const pais = interaction.options.getString('pais');
        const sort = interaction.options.getString('sort');
        const server = interaction.options.getBoolean('servidor');
        const globalOpt = interaction.options.getBoolean('global');
        const sengo = interaction.options.getBoolean('sengo');
        const refresh = interaction.options.getBoolean('refresh');

        if (pais) { args.push('-pais'); args.push(pais); }
        if (sort) args.push(`-${sort}`);
        if (server) args.push('-server');
        if (globalOpt) args.push('-global');
        if (sengo) args.push('-sengo');
        if (refresh) args.push('-refresh');
    } else if (sub === 'bn') {
        args.push('-bn');
        const user = interaction.options.getString('usuario');
        const modo = interaction.options.getString('modo');
        const activo = interaction.options.getBoolean('activo');
        const refresh = interaction.options.getBoolean('refresh');

        if (user) args.push(user);
        if (modo) { args.push('-m'); args.push(modo); }
        if (activo) args.push('-activo');
        if (refresh) args.push('-force');
    }

    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);

    return await mapperChatCommand.run(messages, args);
}

run.description = "Comandos de estadísticas y tracking de mappers en osu!";
run.noDefer = false;

module.exports = { data, run, description: run.description };
