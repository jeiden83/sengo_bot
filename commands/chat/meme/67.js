const { EmbedBuilder, AttachmentBuilder } = require("discord.js");

async function run(messages, args){
    const { logger } = messages;
    if (logger) logger.process("Generando attachment y embed del meme 67");

    const attachment = new AttachmentBuilder("https://media1.tenor.com/m/U94DkrDstecAAAAC/67-angry-bird.gif", { name: "67.gif" });

    const embed = new EmbedBuilder()
        .setImage("attachment://67.gif")
        .setColor("#FF0000")
        .setFooter({
            text: "Muere blue",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })

    return {
        embeds: [embed],
        files: [attachment]
    };
}

run.description = {
    'header' : 'Angry Bird 67',
    'body' : "Muestra el gif clásico del Angry Bird enojado mirando a la cámara (67)",
    'usage' : undefined
}

module.exports = { run };
