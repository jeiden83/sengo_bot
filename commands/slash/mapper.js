const { SlashCommandBuilder } = require("discord.js");
const mapperChatCommand = require("../chat/osu/mapper.js");
const { addUsuarioOption, addModoOption, addServidorOption, parseOsuSlashArgs } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("mapper")
    .setDescription("Muestra las estadísticas de creador/mapper de un usuario en osu!")
    .addStringOption(addUsuarioOption)
    .addStringOption(addModoOption)
    .addStringOption(addServidorOption)
    .addBooleanOption(option =>
        option.setName("top")
            .setDescription("Muestra la tabla de clasificación de mappers")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("pais")
            .setDescription("Filtra por país en la tabla de mappers (ej: MX, VE, US)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("sort")
            .setDescription("Criterio de ordenamiento para la tabla de mappers")
            .setRequired(false)
            .addChoices(
                { name: "Kudosu", value: "kudosus" },
                { name: "Dificultades Invitadas (GDs)", value: "gd" },
                { name: "Mapas Rankeados", value: "ranked" },
                { name: "Mapas WIP / Pending", value: "wip" },
                { name: "Mapas Loved", value: "loved" },
                { name: "Seguidores", value: "followers" },
                { name: "Graveyard", value: "graveyard" },
                { name: "Reciente", value: "recent" }
            )
    )
    .addBooleanOption(option =>
        option.setName("refresh")
            .setDescription("Fuerza la actualización de la caché del top de mappers")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("server")
            .setDescription("Muestra el top de mappers vinculados en el servidor actual")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("global")
            .setDescription("Muestra el top global de Kudosu de mappers de osu!")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("sengo")
            .setDescription("Muestra el top de todos los mappers vinculados a Sengo")
            .setRequired(false)
    );

async function run(interaction, res) {
    const { args, messages } = parseOsuSlashArgs(interaction, res);
    
    // Parsear opciones adicionales específicas del comando mapper
    const top = interaction.options.getBoolean("top");
    const pais = interaction.options.getString("pais");
    const sort = interaction.options.getString("sort");
    const refresh = interaction.options.getBoolean("refresh");
    const server = interaction.options.getBoolean("server");
    const globalOpt = interaction.options.getBoolean("global");
    const sengo = interaction.options.getBoolean("sengo");
    
    if (top) args.push("-top");
    if (pais) {
        args.push("-pais");
        args.push(pais);
    }
    if (sort) {
        args.push(`-${sort}`);
    }
    if (refresh) args.push("-refresh");
    if (server) args.push("-server");
    if (globalOpt) args.push("-global");
    if (sengo) args.push("-sengo");

    return await mapperChatCommand.run(messages, args);
}

run.description = "Muestra las estadísticas de creador/mapper de un usuario en osu!";

module.exports = { data, run, description: run.description };
