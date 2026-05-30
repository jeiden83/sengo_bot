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
            .setDescription("Muestra la tabla de clasificación global de mappers")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("pais")
            .setDescription("Filtra por país en la tabla global de mappers (ej: MX, VE, US)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("sort")
            .setDescription("Criterio de ordenamiento para la tabla global de mappers")
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
    );

async function run(interaction, res) {
    const { args, messages } = parseOsuSlashArgs(interaction, res);
    
    // Parsear opciones adicionales específicas del comando mapper
    const top = interaction.options.getBoolean("top");
    const pais = interaction.options.getString("pais");
    const sort = interaction.options.getString("sort");
    const refresh = interaction.options.getBoolean("refresh");
    
    if (top) args.push("-top");
    if (pais) {
        args.push("-pais");
        args.push(pais);
    }
    if (sort) {
        args.push(`-${sort}`);
    }
    if (refresh) args.push("-refresh");

    return await mapperChatCommand.run(messages, args);
}

run.description = "Muestra las estadísticas de creador/mapper de un usuario en osu!";

module.exports = { data, run, description: run.description };
