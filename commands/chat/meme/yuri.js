const fs = require("fs");
const path = require("path");
const { AttachmentBuilder, EmbedBuilder } = require("discord.js");

let list_order = [];

async function run(message, args) {
    const folderPath = path.join(__dirname, "../../../src/yuri");
    const files = fs.readdirSync(folderPath).filter(file => /\.(jpg|png|gif)$/i.test(file));

    if (files.length === 0) {
        return message.reply("No hay imágenes disponibles.");
    }

    // Si no hay orden actual o se terminó, se genera uno nuevo
    if (list_order.length === 0) {
        list_order = shuffleArray([...files]);
    }

    const currentFile = list_order.shift(); // Tomamos el primero de la lista
    const filePath = path.join(folderPath, currentFile);
    const cleanFileName = path.parse(currentFile).name.replace(/[^a-z0-9]/gi, '_') + path.extname(currentFile).toLowerCase();
    const attachment = new AttachmentBuilder(filePath).setName(cleanFileName);

    const embed = new EmbedBuilder()
        .setImage(`attachment://${cleanFileName}`)
        .setColor("#378a91")
        .setFooter({ text: path.parse(currentFile).name });

    return {
        embeds: [embed],
        files: [attachment]
    };
}

// Función para mezclar un array (Fisher–Yates shuffle)
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

run.description = {
    header: "Yuri",
    body: "El creador del bot le gusta leer mangas yuri.",
    usage: undefined
};

module.exports = { run };