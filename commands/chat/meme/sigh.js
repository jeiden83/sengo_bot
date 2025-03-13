const { EmbedBuilder } = require("discord.js");

async function run(message, args){

    return {embeds: [embed = new EmbedBuilder().setImage("https://jeiden.s-ul.eu/2wyt0ZNx").setColor("#378a91")]}
}
run.description = 
{
    'header' : 'Miyabi Melon',
    'body' : "Sticker pero con mas enfasis",
    'usage' : undefined
}
module.exports = { run }