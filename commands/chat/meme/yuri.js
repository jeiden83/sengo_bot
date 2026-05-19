const fs = require("fs");
const path = require("path");
const { AttachmentBuilder, EmbedBuilder } = require("discord.js");
const { parseYuriFilename, sanitizeStorageKey } = require("../../utils/yuriSync.js");

let list_order = [];

async function run(messages, args) {
    const { message, reply, res, logger } = messages;
    const { getSupabaseClient } = require("../../../db/database.js");
    const supabase = getSupabaseClient();

    if (args?.[0] === '-d' || args?.[0] === '-details' || args?.[0] === '-stats') {
        if (supabase) {
            try {
                const { data: statsData, error: statsError } = await supabase
                    .from('yuri_images')
                    .select('id, medio, subida_por, nombre_serie, capitulo, pagina, fecha_subida, fecha_modificacion');

                if (!statsError && statsData) {
                    const total = statsData.length;
                    const mediosCount = { manga: 0, 'novela ligera': 0, anime: 0 };
                    const uploadersCount = {};
                    const seriesCount = {};

                    statsData.forEach(row => {
                        if (mediosCount[row.medio] !== undefined) {
                            mediosCount[row.medio]++;
                        }
                        uploadersCount[row.subida_por] = (uploadersCount[row.subida_por] || 0) + 1;
                        seriesCount[row.nombre_serie] = (seriesCount[row.nombre_serie] || 0) + 1;
                    });

                    const sortedUploaders = Object.entries(uploadersCount)
                        .sort((a, b) => b[1] - a[1]);

                    const sortedSeries = Object.entries(seriesCount)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5);

                    // Buscar la fila con el ID más alto (última agregada por secuencia de ID)
                    let lastUpload = null;
                    if (statsData.length > 0) {
                        lastUpload = [...statsData].sort((a, b) => b.id - a.id)[0];
                    }

                    let lastUploadText = 'Ninguna';
                    if (lastUpload) {
                        const detail = [lastUpload.capitulo, lastUpload.pagina].filter(Boolean).join(' - ');
                        
                        let relativeTimeStr = '';
                        const dateToUse = lastUpload.fecha_modificacion || lastUpload.fecha_subida;
                        if (dateToUse) {
                            const unixTime = Math.floor(new Date(dateToUse).getTime() / 1000);
                            relativeTimeStr = ` <t:${unixTime}:R>`;
                        }

                        lastUploadText = `[ID: ${lastUpload.id}] **${lastUpload.nombre_serie}**${detail ? ` — *${detail}*` : ''} (por **${lastUpload.subida_por}**)${relativeTimeStr}`;
                    }

                    const embed = new EmbedBuilder()
                        .setTitle("📊 Estadísticas de la Colección Yuri")
                        .setColor("#378a91")
                        .setDescription(`Actualmente hay un total de **${total}** imágenes registradas por Sengo.`)
                        .addFields(
                            { 
                                name: '📺 Distribución por Medio', 
                                value: `📖 **Manga:** ${mediosCount.manga} (${((mediosCount.manga / total) * 100).toFixed(1)}%)\n` +
                                       `📕 **Novela Ligera:** ${mediosCount['novela ligera']} (${((mediosCount['novela ligera'] / total) * 100).toFixed(1)}%)\n` +
                                       `🎬 **Anime:** ${mediosCount.anime} (${((mediosCount.anime / total) * 100).toFixed(1)}%)`,
                                inline: false 
                            },
                            {
                                name: '👤 Contribuidores (Uploaders)',
                                value: sortedUploaders.map(([user, count]) => `• **${user}**: ${count} (${((count / total) * 100).toFixed(1)}%)`).join('\n'),
                                inline: false
                            },
                            {
                                name: '⭐ Top 5 Series con Más Capturas',
                                value: sortedSeries.map(([serie, count], idx) => `**${idx + 1}.** ${serie} — **${count}** capturas`).join('\n'),
                                inline: false
                            },
                            {
                                name: '✨ Última Imagen Subida',
                                value: lastUploadText,
                                inline: false
                            }
                        )
                        .setFooter({ text: "Sengo Bot Yuri Analytics" })
                        .setTimestamp();

                    return {
                        embeds: [embed]
                    };
                }
            } catch (statsError) {
                console.error("Error al obtener estadísticas de yuri_images:", statsError);
            }
        }

        // Fallback local
        const folderPath = path.join(__dirname, "../../../src/yuri");
        if (fs.existsSync(folderPath)) {
            const localFiles = fs.readdirSync(folderPath).filter(f => /\.(jpg|png|gif|jpeg)$/i.test(f));
            if (localFiles.length > 0) {
                const total = localFiles.length;
                const statsData = localFiles.map(f => parseYuriFilename(f));
                
                const mediosCount = { manga: 0, 'novela ligera': 0, anime: 0 };
                const uploadersCount = {};
                const seriesCount = {};

                statsData.forEach(row => {
                    if (mediosCount[row.medio] !== undefined) {
                        mediosCount[row.medio]++;
                    }
                    uploadersCount[row.subida_por] = (uploadersCount[row.subida_por] || 0) + 1;
                    seriesCount[row.nombre_serie] = (seriesCount[row.nombre_serie] || 0) + 1;
                });

                const sortedUploaders = Object.entries(uploadersCount)
                    .sort((a, b) => b[1] - a[1]);

                const sortedSeries = Object.entries(seriesCount)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5);

                // Buscar la fila con el ID más alto (última agregada localmente)
                let lastUpload = null;
                if (statsData.length > 0) {
                    lastUpload = [...statsData].sort((a, b) => b.id - a.id)[0];
                }

                let lastUploadText = 'Ninguna';
                if (lastUpload) {
                    const detail = [lastUpload.capitulo, lastUpload.pagina].filter(Boolean).join(' - ');
                    
                    let relativeTimeStr = '';
                    try {
                        const originalFile = localFiles.find(f => sanitizeStorageKey(f) === lastUpload.file_name) || lastUpload.file_name;
                        const fullFilePath = path.join(folderPath, originalFile);
                        if (fs.existsSync(fullFilePath)) {
                            const stat = fs.statSync(fullFilePath);
                            const unixTime = Math.floor(stat.mtimeMs / 1000);
                            relativeTimeStr = ` <t:${unixTime}:R>`;
                        }
                    } catch (e) {
                        console.error("Error al obtener fecha del archivo local:", e);
                    }

                    lastUploadText = `[ID: ${lastUpload.id}] **${lastUpload.nombre_serie}**${detail ? ` — *${detail}*` : ''} (por **${lastUpload.subida_por}**)${relativeTimeStr}`;
                }

                const embed = new EmbedBuilder()
                    .setTitle("📊 Estadísticas de la Colección Yuri (Modo Local)")
                    .setColor("#378a91")
                    .setDescription(`Actualmente hay un total de **${total}** imágenes registradas por Sengo.`)
                    .addFields(
                        { 
                            name: '📺 Distribución por Medio', 
                            value: `📖 **Manga:** ${mediosCount.manga} (${((mediosCount.manga / total) * 100).toFixed(1)}%)\n` +
                                   `📕 **Novela Ligera:** ${mediosCount['novela ligera']} (${((mediosCount['novela ligera'] / total) * 100).toFixed(1)}%)\n` +
                                   `🎬 **Anime:** ${mediosCount.anime} (${((mediosCount.anime / total) * 100).toFixed(1)}%)`,
                            inline: false 
                        },
                        {
                            name: '👤 Contribuidores (Uploaders)',
                            value: sortedUploaders.map(([user, count]) => `• **${user}**: ${count} (${((count / total) * 100).toFixed(1)}%)`).join('\n'),
                            inline: false
                        },
                        {
                            name: '⭐ Top 5 Series con Más Capturas',
                            value: sortedSeries.map(([serie, count], idx) => `**${idx + 1}.** ${serie} — **${count}** capturas`).join('\n'),
                            inline: false
                        },
                        {
                            name: '✨ Última Imagen Subida',
                            value: lastUploadText,
                            inline: false
                        }
                    )
                    .setFooter({ text: "Sengo Bot Yuri Analytics" })
                    .setTimestamp();

                return {
                    embeds: [embed]
                };
            }
        }
        return "No hay suficientes datos para generar estadísticas.";
    }

    if (supabase) {
        try {
            // 1. Obtener la lista de archivos desde el Storage Bucket de Supabase
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
                // Ordenar numéricamente
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
                if (args?.[0]) {
                    const requestedIndex = parseInt(args[0]);
                    if (!isNaN(requestedIndex) && requestedIndex >= 0) {
                        const idx = Math.min(requestedIndex, imageFiles.length - 1);
                        currentFile = imageFiles[idx];
                    }
                }

                if (!currentFile) {
                    currentFile = imageFiles[Math.floor(Math.random() * imageFiles.length)];
                }

                // Paso 2/3: Loggear progreso
                const totalImages = imageFiles.length;
                const currentIndex = imageFiles.findIndex(f => f.name === currentFile.name) + 1;
                if (logger) {
                    logger.process(`Mostrando imagen ${currentIndex} de ${totalImages} en total`);
                }

                // Obtener la URL pública de la imagen
                const { data } = supabase
                    .storage
                    .from('yuri')
                    .getPublicUrl(currentFile.name);

                const publicUrl = data.publicUrl;

                // Obtener metadatos desde la base de datos
                let dbData = null;
                try {
                    const { data: imgData } = await supabase
                        .from('yuri_images')
                        .select()
                        .eq('file_name', currentFile.name)
                        .maybeSingle();
                    if (imgData) {
                        dbData = imgData;
                    }
                } catch (dbError) {
                    console.error("Error al obtener metadatos de yuri_images:", dbError.message);
                }

                // Si por alguna razón falló la consulta a la BD, intentamos parsear localmente
                if (!dbData) {
                    dbData = parseYuriFilename(currentFile.name);
                }

                const embed = new EmbedBuilder()
                    .setImage(publicUrl)
                    .setColor("#378a91");

                if (dbData) {
                    embed.setTitle(dbData.nombre_serie)
                        .addFields(
                            { name: '📺 Medio', value: dbData.medio.charAt(0).toUpperCase() + dbData.medio.slice(1), inline: true },
                            { name: '📖 Capítulo', value: dbData.capitulo || 'One Shot / N/A', inline: true },
                            { name: '📄 Página', value: dbData.pagina || 'N/A', inline: true }
                        )
                        .setFooter({ text: `Subido por: ${dbData.subida_por} | Imagen ${currentIndex} de ${totalImages}` });
                } else {
                    embed.setTitle(path.parse(currentFile.name).name)
                        .setFooter({ text: `Imagen ${currentIndex} de ${totalImages}` });
                }

                return {
                    embeds: [embed]
                };
            }
        } catch (supabaseError) {
            console.error("Error al obtener imágenes de Supabase Storage (bucket 'yuri'):", supabaseError);
        }
    }

    // --- MODO LOCAL ---
    const folderPath = path.join(__dirname, "../../../src/yuri");
    if (!fs.existsSync(folderPath)) {
        const errorMsg = "No hay imágenes disponibles (directorio local no encontrado).";
        if (message && typeof message.reply === 'function') {
            return message.reply(errorMsg);
        }
        return errorMsg;
    }

    const files = fs.readdirSync(folderPath)
        .filter(file => /\.(jpg|png|gif|jpeg)$/i.test(file))
        .sort((a, b) => {
            const numA = parseInt(a.match(/\d+/)?.[0]) || 0;
            const numB = parseInt(b.match(/\d+/)?.[0]) || 0;
            return numA - numB;
        });

    if (files.length === 0) {
        const errorMsg = "No hay imágenes disponibles.";
        if (message && typeof message.reply === 'function') {
            return message.reply(errorMsg);
        }
        return errorMsg;
    }

    if (list_order.length === 0) {
        list_order = shuffleArray([...files]);
    }

    let currentFile = list_order.shift();

    if (args?.[0]) {
        const requestedIndex = parseInt(args[0]);
        if (!isNaN(requestedIndex) && requestedIndex >= 0) {
            const idx = Math.min(requestedIndex, files.length - 1);
            currentFile = files[idx];
        }
    }

    if (!currentFile) {
        currentFile = files[Math.floor(Math.random() * files.length)];
    }

    // Paso 2/3: Loggear progreso
    const totalImages = files.length;
    const currentIndex = files.indexOf(currentFile) + 1;
    if (logger) {
        logger.process(`Mostrando imagen ${currentIndex} de ${totalImages} en total`);
    }
    
    const filePath = path.join(folderPath, currentFile);
    const cleanFileName = path.parse(currentFile).name.replace(/[^a-z0-9]/gi, '_') + path.extname(currentFile).toLowerCase();
    const attachment = new AttachmentBuilder(filePath).setName(cleanFileName);

    const dbData = parseYuriFilename(currentFile);

    const embed = new EmbedBuilder()
        .setImage(`attachment://${cleanFileName}`)
        .setColor("#378a91");

    if (dbData) {
        embed.setTitle(dbData.nombre_serie)
            .addFields(
                { name: '📺 Medio', value: dbData.medio.charAt(0).toUpperCase() + dbData.medio.slice(1), inline: true },
                { name: '📖 Capítulo', value: dbData.capitulo || 'One Shot / N/A', inline: true },
                { name: '📄 Página', value: dbData.pagina || 'N/A', inline: true }
            )
            .setFooter({ text: `Subido por: ${dbData.subida_por} | Imagen ${currentIndex} de ${totalImages}` });
    } else {
        embed.setTitle(path.parse(currentFile).name)
            .setFooter({ text: `Imagen ${currentIndex} de ${totalImages}` });
    }

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