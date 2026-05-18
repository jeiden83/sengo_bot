const { EmbedBuilder } = require("discord.js");

async function run(messages, args){
    const { logger } = messages;
    if (logger) logger.process("Generando embed del meme 67");

    return {
        embeds: [
            new EmbedBuilder()
                .setImage("https://media1.tenor.com/m/U94DkrDstecAAAAC/67-angry-bird.gif")
                .setColor("#FF0000")
        ]
    };
}

run.description = {
    'header' : 'Angry Bird 67',
    'body' : "Muestra el gif clásico del Angry Bird enojado mirando a la cámara (67)",
    'usage' : undefined
}

module.exports = { run };
