const fs = require("fs");
const path = require("path");
const { AttachmentBuilder, EmbedBuilder, ChatInputCommandInteraction } = require("discord.js");

let list_order = [];

async function run(message, args) {
    const { getSupabaseClient } = require("../../db/database.js");
    const supabase = getSupabaseClient();

    if (supabase) {
        try {
            // 1. Obtener la lista de archivos desde el Storage Bucket de Supabase
            // Por defecto, listamos hasta 1000 imágenes del bucket 'yuri'
            const { data: files, error } = await supabase
                .storage
                .from('yuri')
                .list('', {
                    limit: 1000,
                    sortBy: { column: 'name', order: 'asc' }
                });

            if (error) throw error;

            // Filtrar solo imágenes
            const imageFiles = (files || []).filter(file => /\.(jpg|png|gif|jpeg)$/i.test(file.name));

            if (imageFiles.length > 0) {
                // Ordenar numéricamente si los nombres tienen números (ej. yuri1.png, yuri2.png)
                imageFiles.sort((a, b) => {
                    const numA = parseInt(a.name.match(/\d+/)?.[0]) || 0;
                    const numB = parseInt(b.name.match(/\d+/)?.[0]) || 0;
                    return numA - numB;
                });

                // Si no hay orden actual o se terminó, se genera uno nuevo
                if (list_order.length === 0) {
                    list_order = shuffleArray([...imageFiles]);
                }

                let currentFile = list_order.shift();

                // Si es un comando de texto y se especifica un número por argumento
                if (!(message instanceof ChatInputCommandInteraction) && args?.[0]) {
                    const requestedIndex = parseInt(args[0]);
                    if (!isNaN(requestedIndex) && requestedIndex > 0) {
                        const idx = Math.min(requestedIndex, imageFiles.length) - 1;
                        currentFile = imageFiles[idx];
                    }
                }

                if (!currentFile) {
                    currentFile = imageFiles[Math.floor(Math.random() * imageFiles.length)];
                }

                // Obtener la URL pública de la imagen
                const { data } = supabase
                    .storage
                    .from('yuri')
                    .getPublicUrl(currentFile.name);

                const publicUrl = data.publicUrl;

                const embed = new EmbedBuilder()
                    .setImage(publicUrl)
                    .setColor("#378a91")
                    .setFooter({ text: path.parse(currentFile.name).name });

                return {
                    embeds: [embed]
                };
            }
        } catch (supabaseError) {
            console.error("Error al obtener imágenes de Supabase Storage (bucket 'yuri'):", supabaseError);
            // Fallback al modo local si hay error en Supabase
        }
    }

    // --- MODO LOCAL ---
    const folderPath = path.join(__dirname, "../../../src/yuri");
    if (!fs.existsSync(folderPath)) {
        return message.reply("No hay imágenes disponibles (directorio local no encontrado).");
    }

    const files = fs.readdirSync(folderPath)
        .filter(file => /\.(jpg|png|gif|jpeg)$/i.test(file))
        .sort((a, b) => {
            const numA = parseInt(a.match(/\d+/)?.[0]) || 0;
            const numB = parseInt(b.match(/\d+/)?.[0]) || 0;
            return numA - numB;
        });

    if (files.length === 0) {
        return message.reply("No hay imágenes disponibles.");
    }

    if (list_order.length === 0) {
        list_order = shuffleArray([...files]);
    }

    let currentFile = list_order.shift();

    if (!(message instanceof ChatInputCommandInteraction) && args?.[0]) {
        const requestedIndex = parseInt(args[0]);
        if (!isNaN(requestedIndex) && requestedIndex > 0) {
            const idx = Math.min(requestedIndex, files.length) - 1;
            currentFile = files[idx];
        }
    }

    if (!currentFile) {
        currentFile = files[Math.floor(Math.random() * files.length)];
    }
    
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