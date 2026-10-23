const { SlashCommandBuilder } = require("discord.js");
const twinsSlash = require("./twins.js");
const { addUsuarioOption, addModoOption } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("twin")
    .setDescription("Encuentra a tu gemelo de juego en osu! según afinidad de mods, PP o habilidades")
    .addStringOption(addUsuarioOption)
    .addStringOption(addModoOption)
    .addStringOption(option =>
        option.setName("mods")
            .setDescription("Filtrar por afinidad en mods específicos (ej: EZ, HDDT, NM)")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("pp")
            .setDescription("Ordenar por cercanía en PP (más cercano primero)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("skills")
            .setDescription("Buscar por cercanía en habilidades cinéticas")
            .setRequired(false)
            .addChoices(
                { name: "Todas las habilidades (Perfil general)", value: "ALL" },
                { name: "Aim (Puntería)", value: "AIM" },
                { name: "Speed (Velocidad)", value: "SPEED" },
                { name: "Acc (Precisión)", value: "ACC" },
                { name: "Reading (Lectura)", value: "READING" },
                { name: "Stamina (Resistencia)", value: "STAMINA" }
            )
    )
    .addStringOption(option =>
        option.setName("pais")
            .setDescription("Filtrar gemelos únicamente de este código de país (ej: CL, VE, ES, AR, US)")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("priorizar_pais")
            .setDescription("Priorizar jugadores de tu país al inicio de la lista")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("lista")
            .setDescription("Mostrar los gemelos en una lista compacta de a 5")
            .setRequired(false)
    )
    .addIntegerOption(option =>
        option.setName("indice")
            .setDescription("Índice de gemelo específico a consultar directamente (1 a 25)")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(25)
    )
    .addBooleanOption(option =>
        option.setName("rank")
            .setDescription("Filtrar gemelos con rango/nivel global similar al tuyo")
            .setRequired(false)
    );

if (typeof data.setIntegrationTypes === "function") {
    data.setIntegrationTypes([0, 1]);
}
if (typeof data.setContexts === "function") {
    data.setContexts([0, 1, 2]);
}

module.exports = { data, run: twinsSlash.run, description: twinsSlash.description };
