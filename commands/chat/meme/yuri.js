const fs = require("fs");
const path = require("path");
const { AttachmentBuilder, EmbedBuilder } = require("discord.js");

async function run(message, args) {
    const folderPath = path.join(__dirname, "../../../src/yuri");
    const files = fs.readdirSync(folderPath).filter(file => file.endsWith(".jpg"));

    if (files.length === 0) {
        return message.reply("No hay imágenes disponibles.");
    }

    // Elige un archivo aleatorio
    const randomFile = files[Math.floor(Math.random() * files.length)];
    const filePath = path.join(folderPath, randomFile);

    // Normaliza el nombre del attachment (reemplaza espacios por guiones bajos, por ejemplo)
    const cleanFileName = path.parse(randomFile).name.replace(/[^a-z0-9]/gi, '_') + ".jpg";

    // Crea el attachment con nombre limpio
    const attachment = new AttachmentBuilder(filePath).setName(cleanFileName);

    const embed = new EmbedBuilder()
        .setImage(`attachment://${cleanFileName}`)
        .setColor("#378a91")
        .setFooter({ text: path.parse(randomFile).name });

    return {
        embeds: [embed],
        files: [attachment]
    };
}

run.description = {
    header: "Yuri",
    body: "El creador del bot le gusta leer mangas yuri.",
    usage: undefined
};

module.exports = { run };