// commands/slash/droid.js
// Comando slash para osu!droid con subcomandos (/droid)

const { SlashCommandBuilder } = require("discord.js");
const droidChatCommand = require("../chat/osu/droid.js");
const { createSlashMessagesContext } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("droid")
    .setDescription("Comandos y estadísticas para osu!droid (cliente móvil de osu!)")
    .addSubcommand(sub =>
        sub.setName("perfil")
            .setDescription("Muestra el perfil general y estadísticas de un jugador de osu!droid")
            .addStringOption(opt =>
                opt.setName("usuario")
                    .setDescription("Nombre de usuario o UID numérico en osu!droid")
                    .setRequired(false)
            )
    )
    .addSubcommand(sub =>
        sub.setName("reciente")
            .setDescription("Muestra la jugada más reciente de un jugador en osu!droid")
            .addStringOption(opt =>
                opt.setName("usuario")
                    .setDescription("Nombre de usuario o UID numérico en osu!droid")
                    .setRequired(false)
            )
    )
    .addSubcommand(sub =>
        sub.setName("top")
            .setDescription("Muestra las mejores 50 jugadas de un jugador en osu!droid")
            .addStringOption(opt =>
                opt.setName("usuario")
                    .setDescription("Nombre de usuario o UID numérico en osu!droid")
                    .setRequired(false)
            )
    )
    .addSubcommand(sub =>
        sub.setName("leaderboard")
            .setDescription("Muestra las mejores puntuaciones registradas en osu!droid para un mapa")
            .addStringOption(opt =>
                opt.setName("hash")
                    .setDescription("Hash MD5 del beatmap (opcional, busca en el canal si se omite)")
                    .setRequired(false)
            )
    )
    .addSubcommand(sub =>
        sub.setName("comparar")
            .setDescription("Compara la puntuación de un usuario en el mapa actual de osu!droid")
            .addStringOption(opt =>
                opt.setName("usuario")
                    .setDescription("Nombre de usuario o UID numérico en osu!droid")
                    .setRequired(false)
            )
    )
    .addSubcommand(sub =>
        sub.setName("vincular")
            .setDescription("Vincula tu cuenta de Discord a un usuario o UID de osu!droid")
            .addStringOption(opt =>
                opt.setName("cuenta")
                    .setDescription("Nombre de usuario o UID numérico en osu!droid")
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName("desvincular")
            .setDescription("Desvincula tu cuenta de osu!droid en Sengo")
    );

if (typeof data.setIntegrationTypes === "function") {
    data.setIntegrationTypes([0, 1]);
}
if (typeof data.setContexts === "function") {
    data.setContexts([0, 1, 2]);
}

async function run(interaction, res) {
    const messages = createSlashMessagesContext(interaction, res);
    const subCommand = interaction.options.getSubcommand();
    const args = [];

    if (subCommand === 'perfil') {
        args.push('profile');
        const user = interaction.options.getString('usuario');
        if (user) args.push(user);
    } else if (subCommand === 'reciente') {
        args.push('recent');
        const user = interaction.options.getString('usuario');
        if (user) args.push(user);
    } else if (subCommand === 'top') {
        args.push('top');
        const user = interaction.options.getString('usuario');
        if (user) args.push(user);
    } else if (subCommand === 'leaderboard') {
        args.push('lb');
        const hash = interaction.options.getString('hash');
        if (hash) args.push(hash);
    } else if (subCommand === 'comparar') {
        args.push('compare');
        const user = interaction.options.getString('usuario');
        if (user) args.push(user);
    } else if (subCommand === 'vincular') {
        args.push('link');
        const cuenta = interaction.options.getString('cuenta');
        if (cuenta) args.push(cuenta);
    } else if (subCommand === 'desvincular') {
        args.push('unlink');
    }

    const result = await droidChatCommand.run(messages, args);

    if (result && typeof result === 'string') {
        await interaction.editReply({ content: result });
    } else if (result && result.embeds) {
        await interaction.editReply(result);
    }

    return result || true;
}

run.description = "Comandos y estadísticas para osu!droid (cliente móvil de osu!)";

module.exports = { data, run, description: run.description };
