const axios = require('axios');
const { EmbedBuilder } = require("discord.js");

async function run(message, args) {
    let return_data;

    try {
        const response = await axios.get("https://osu.ppy.sh/api/v2/seasonal-backgrounds");
        const data = response.data;

        const seasonalChoosen = data.backgrounds[Math.floor(Math.random() * data.backgrounds.length)];

        const embed = new EmbedBuilder()
                .setFooter({
                    text: "Fondo estacional de osu! hecho por: "+seasonalChoosen.user.username, 
                    iconURL: seasonalChoosen.user.avatar_url
                })
                .setImage(seasonalChoosen.url)
                .setColor(seasonalChoosen.user.profile_colour);
                
        return_data = { embeds: [embed] };
    } catch (error) {

        console.error('Error al obtener el fondo:', error);
        return_data = "no";
    }

    return return_data;
}
run.description = 
{
    'header' : 'Para conseguir un bg',
    'body' : 'Retorna una imagen de los fondos estacionales del osu!',
    'usage' : undefined
}
module.exports = { run }