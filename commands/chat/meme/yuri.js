const fs = require("fs");
const path = require("path");
const { AttachmentBuilder } = require("discord.js");
const { parseYuriFilename, sanitizeStorageKey } = require("../../../services/yuriSync.js");
const { doYuriStatsEmbed, doYuriImageEmbed } = require("../../../views/yuriViews.js");
const { t } = require("../../../utils/i18n.js");

let list_order = [];

async function run(messages, args) {
    const { message, reply, res, logger } = messages;
    const locale = message.locale || 'es';
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

                    let lastUploadText = t(locale, 'yuri.none');
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

                    const embed = doYuriStatsEmbed({
                        message,
                        total,
                        mediosCount,
                        sortedUploaders,
                        sortedSeries,
                        lastUploadText,
                        isLocal: false,
                        locale
                    });

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

                let lastUploadText = t(locale, 'yuri.none');
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

                const embed = doYuriStatsEmbed({
                    message,
                    total,
                    mediosCount,
                    sortedUploaders,
                    sortedSeries,
                    lastUploadText,
                    isLocal: true,
                    locale
                });

                return {
                    embeds: [embed]
                };
            }
        }
        return t(locale, 'yuri.stats_no_data');
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

                const embed = doYuriImageEmbed({
                    message,
                    imageUrl: publicUrl,
                    dbData,
                    currentIndex,
                    totalImages,
                    locale
                });

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
        const errorMsg = t(locale, 'yuri.no_images_dir');
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
        const errorMsg = t(locale, 'yuri.no_images');
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

    const embed = doYuriImageEmbed({
        message,
        imageUrl: `attachment://${cleanFileName}`,
        dbData,
        currentIndex,
        totalImages,
        locale
    });

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
    body: "Al creador del bot le gusta leer mangas yuri. / The creator of the bot likes reading yuri manga.",
    usage: 's.yuri\ns.yuri -details\ns.yuri -stats'
};

module.exports = { run };