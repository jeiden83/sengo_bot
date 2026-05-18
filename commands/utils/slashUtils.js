/**
 * Utilidades para estructurar y reutilizar código de comandos Slash
 */

function addUsuarioOption(option) {
    return option
        .setName("usuario")
        .setDescription("Nombre de usuario de osu! o mención de Discord")
        .setRequired(false);
}

function addModoOption(option) {
    return option
        .setName("modo")
        .setDescription("Modo de juego de osu!")
        .setRequired(false)
        .addChoices(
            { name: "Standard", value: "std" },
            { name: "Taiko", value: "taiko" },
            { name: "Catch the Beat", value: "ctb" },
            { name: "Mania", value: "mania" }
        );
}

function addServidorOption(option) {
    return option
        .setName("servidor")
        .setDescription("Servidor de osu! (Bancho o Gatari)")
        .setRequired(false)
        .addChoices(
            { name: "Bancho", value: "bancho" },
            { name: "Gatari", value: "gatari" }
        );
}

/**
 * Convierte las opciones estándar de un comando slash en el formato de argumentos y contexto
 * que esperan los comandos de chat tradicionales.
 * 
 * @param {import('discord.js').ChatInputCommandInteraction} interaction 
 * @param {any} res 
 * @returns {{ args: string[], messages: any }} Contexto simulado para ejecutar .run()
 */
function parseOsuSlashArgs(interaction, res) {
    const usuario = interaction.options.getString("usuario");
    const modo = interaction.options.getString("modo");
    const servidor = interaction.options.getString("servidor");

    const args = [];
    if (usuario) {
        // Extraer ID si es una mención de Discord <@ID>
        const mentionMatch = usuario.match(/^<@!?(\d+)>$/);
        if (mentionMatch) {
            args.push(mentionMatch[1]);
        } else {
            args.push(usuario);
        }
    }
    if (modo) args.push(`-${modo}`);
    if (servidor) args.push(`-${servidor}`);

    const messages = {
        message: {
            author: interaction.user,
            member: interaction.member,
            guild: interaction.guild,
        },
        res: res,
        reply: null,
        logger: interaction.logger
    };

    return { args, messages };
}

module.exports = {
    addUsuarioOption,
    addModoOption,
    addServidorOption,
    parseOsuSlashArgs
};
