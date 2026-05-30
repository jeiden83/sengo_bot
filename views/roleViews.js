const { EmbedBuilder } = require("discord.js");
const { t } = require("../utils/i18n.js");

function doRoleColorChangedEmbed({ rol, colorHex, locale }) {
    return new EmbedBuilder()
        .setAuthor({ name: t(locale, 'rol.color_changed_title') })
        .setDescription(t(locale, 'rol.color_changed_desc', { roleId: rol.id }))
        .setColor(colorHex)
        .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();
}

function doRoleGrantedEmbed({ miembro, rol, isGranted, locale }) {
    const titleKey = isGranted ? 'rol.granted_title' : 'rol.removed_title';
    const descKey = isGranted ? 'rol.granted_desc' : 'rol.removed_desc';
    
    return new EmbedBuilder()
        .setAuthor({ name: t(locale, titleKey) })
        .setDescription(t(locale, descKey, { userId: miembro.id, roleId: rol.id }))
        .setColor(rol.color)
        .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();
}

function doRoleMassiveProcessEmbed({ rol, totalMiembros, otorgados, removidos, errores, locale }) {
    const description = `### ${t(locale, 'rol.summary_title')}
> **${t(locale, 'rol.summary_role')}:** <@&${rol.id}>
> **${t(locale, 'rol.summary_processed')}:** ${totalMiembros}

- 🟢 ${t(locale, 'rol.summary_granted')}: \`${otorgados}\`
- 🔴 ${t(locale, 'rol.summary_removed')}: \`${removidos}\`
- 🟡 ${t(locale, 'rol.summary_errors')}: \`${errores}\``;

    return new EmbedBuilder()
        .setAuthor({ name: t(locale, 'rol.massive_title') })
        .setDescription(description)
        .setColor(rol.color)
        .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();
}

module.exports = {
    doRoleColorChangedEmbed,
    doRoleGrantedEmbed,
    doRoleMassiveProcessEmbed
};
