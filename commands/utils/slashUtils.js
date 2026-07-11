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
        .setDescription("Servidor de osu! (Bancho, Gatari o Mamesosu)")
        .setRequired(false)
        .addChoices(
            { name: "Bancho", value: "bancho" },
            { name: "Gatari", value: "gatari" },
            { name: "Mamesosu", value: "mameosu" }
        );
}

/**
 * Crea un contexto de mensajes seguro para comandos slash que redirige respuestas
 * e interactúa usando los tokens de la interacción, compatible con servidores externos.
 * 
 * @param {import('discord.js').ChatInputCommandInteraction} interaction 
 * @param {any} res 
 * @returns {any} Contexto de mensajes simulado para .run()
 */
function createSlashMessagesContext(interaction, res) {
    let interactionUsed = false;

    const replyFn = async (options) => {
        if (!interaction.replied && !interaction.deferred) {
            interactionUsed = true;
            return await interaction.reply(options);
        }
        if (interaction.deferred && !interactionUsed) {
            interactionUsed = true;
            return await interaction.editReply(options);
        }
        try {
            return await interaction.followUp(options);
        } catch {
            return await interaction.channel.send(options);
        }
    };

    return {
        message: {
            author: interaction.user,
            member: interaction.member,
            guild: interaction.guild,
            locale: interaction.resolvedLocale || interaction.locale || 'es',
            reply: replyFn,
            channel: {
                send: replyFn,
                sendTyping: async () => {
                    try {
                        await interaction.channel.sendTyping();
                    } catch {}
                },
                id: interaction.channelId,
                isTextBased: () => true,
                messages: interaction.channel?.messages || {
                    fetch: async () => new Map()
                }
            }
        },
        res: res,
        reply: {
            reply: replyFn
        },
        logger: interaction.logger
    };
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

    const messages = createSlashMessagesContext(interaction, res);

    return { args, messages };
}

module.exports = {
    addUsuarioOption,
    addModoOption,
    addServidorOption,
    createSlashMessagesContext,
    parseOsuSlashArgs
};

