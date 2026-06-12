const { EmbedBuilder } = require('discord.js');
const { t } = require('../utils/i18n.js');

/**
 * Crea un embed para mostrar la lista de usuarios bloqueados.
 * @param {string} locale Idioma del servidor
 * @param {array} listData Lista de registros de la blacklist de Supabase
 * @returns {EmbedBuilder} Embed formateado
 */
function doBlacklistListEmbed(locale, listData) {
    const embed = new EmbedBuilder()
        .setTitle(t(locale, "blacklist.title"))
        .setColor("#2f3136")
        .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();

    if (!listData || listData.length === 0) {
        embed.setDescription(t(locale, "blacklist.empty"));
    } else {
        const listText = listData.map((row, idx) => {
            const dateStr = new Date(row.created_at).toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-US');
            
            // Si tiene comandos específicos, los mostramos formateados con un punto adelante, si no, es bloqueo general
            const commandsText = row.commands && row.commands.length > 0 
                ? row.commands.map(c => `\`.${c}\``).join(', ') 
                : t(locale, "blacklist.general_block");
            
            return t(locale, "blacklist.list_entry", {
                index: idx + 1,
                userId: row.discord_id,
                commands: commandsText,
                addedBy: row.added_by || '?',
                date: dateStr
            });
        }).join('\n');

        embed.setDescription(listText);
    }

    return embed;
}

module.exports = {
    doBlacklistListEmbed
};
