const { EmbedBuilder } = require("discord.js");

async function run(message, args){

    return {embeds: [embed = new EmbedBuilder().setImage("https://jeiden.s-ul.eu/LHiOihNs").setColor("#378a91")]};
}
run.description = 
{
    'header' : 'Yuri',
    'body' : 'El creador del bot le gusta leer mangas yuri.',
    'usage' : undefined
}

module.exports = { run }