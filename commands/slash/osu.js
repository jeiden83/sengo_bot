const { SlashCommandBuilder } = require("discord.js");
const osuChatCommand = require("../chat/osu/osu.js");

const data = new SlashCommandBuilder()
    .setName("osu")
    .setDescription("Muestra el perfil de un usuario en osu!")
    .addStringOption(option =>
        option.setName("usuario")
            .setDescription("Nombre de usuario de osu! o mención de Discord")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("modo")
            .setDescription("Modo de juego de osu!")
            .setRequired(false)
            .addChoices(
                { name: "Standard", value: "std" },
                { name: "Taiko", value: "taiko" },
                { name: "Catch the Beat", value: "ctb" },
                { name: "Mania", value: "mania" }
            )
    )
    .addStringOption(option =>
        option.setName("servidor")
            .setDescription("Servidor de osu! (Bancho o Gatari)")
            .setRequired(false)
            .addChoices(
                { name: "Bancho", value: "bancho" },
                { name: "Gatari", value: "gatari" }
            )
    );

async function run(interaction, res) {
    const usuario = interaction.options.getString("usuario");
    const modo = interaction.options.getString("modo");
    const servidor = interaction.options.getString("servidor");

    // Construir el array de argumentos virtuales
    const args = [];
    if (usuario) {
        // Si el usuario es una mención de Discord (ej: <@395623267530047489>), extraemos solo la ID numérica
        const mentionMatch = usuario.match(/^<@!?(\d+)>$/);
        if (mentionMatch) {
            args.push(mentionMatch[1]);
        } else {
            args.push(usuario);
        }
    }
    if (modo) args.push(`-${modo}`);
    if (servidor) args.push(`-${servidor}`);

    // Construir el objeto de mensajes virtual
    const messages = {
        message: {
            author: interaction.user,
            member: interaction.member,
            guild: interaction.guild,
        },
        res: res,
        reply: null
    };

    // Ejecutar la función run del comando original
    return await osuChatCommand.run(messages, args);
}

run.description = "Muestra el perfil de un usuario en osu!";

module.exports = { data, run, description: run.description };
