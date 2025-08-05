const { EmbedBuilder } = require("discord.js");

async function run(message, args){

    return {content: `Callate <@461338225756209163>`, embeds: [embed = new EmbedBuilder().setImage("https://jeiden.s-ul.eu/eQeMM2nX").setColor("#378a91")]}
}
run.description = 
{
    'header' : 'Que no',
    'body' : undefined,
    'usage' : undefined
}

module.exports = { run }