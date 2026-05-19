const fs = require('fs');
const path = require('path');

const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif'
};

async function syncYuriImages(supabase) {
    const folderPath = path.join(process.cwd(), "src/yuri");

    if (!fs.existsSync(folderPath)) {
        console.log("[YURI SYNC] Carpeta local src/yuri no encontrada. Omitiendo sincronización.");
        return;
    }

    try {
        const localFiles = fs.readdirSync(folderPath).filter(f => {
            const ext = path.extname(f).toLowerCase();
            return ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.gif';
        });

        if (localFiles.length === 0) {
            console.log("[YURI SYNC] Carpeta local src/yuri está vacía.");
            return;
        }

        // 1. Validar o crear el bucket 'yuri' en Supabase Storage
        const { data: buckets, error: listError } = await supabase.storage.listBuckets();
        if (listError) {
            console.error("[YURI SYNC] Error listando buckets de Supabase:", listError.message);
            return;
        }

        const yuriBucket = buckets.find(b => b.name === 'yuri');
        if (!yuriBucket) {
            console.log("[YURI SYNC] El bucket 'yuri' no existe en Supabase Storage. Intentando crearlo...");
            const { error: createError } = await supabase.storage.createBucket('yuri', {
                public: true,
                fileSizeLimit: 10485760 // 10MB
            });

            if (createError) {
                if (createError.message.includes('row-level security policy') || createError.message.includes('violates row-level security')) {
                    console.warn("[YURI SYNC] ⚠️ No tienes permisos de políticas (RLS) para crear buckets automáticamente en Supabase.");
                    console.warn("[YURI SYNC] 👉 Por favor, crea el bucket manualmente desde tu Dashboard de Supabase con el nombre: 'yuri' (y configúralo como Public).");
                } else {
                    console.error("[YURI SYNC] Error al crear bucket 'yuri':", createError.message);
                }
                return;
            }
            console.log("[YURI SYNC] Bucket 'yuri' creado con éxito.");
        }

        // 2. Obtener lista de imágenes ya subidas a Supabase Storage
        const { data: remoteFiles, error: listFilesError } = await supabase.storage.from('yuri').list('', { limit: 1000 });
        if (listFilesError) {
            console.error("[YURI SYNC] Error al listar archivos en el bucket yuri:", listFilesError.message);
            return;
        }

        const remoteNames = new Set((remoteFiles || []).map(f => f.name));

        // 3. Filtrar cuáles imágenes locales faltan por subir
        const filesToUpload = localFiles.filter(f => !remoteNames.has(f));
        if (filesToUpload.length === 0) {
            console.log("[YURI SYNC] El bucket yuri ya está sincronizado. 0 imágenes nuevas por subir.");
            return;
        }

        console.log(`[YURI SYNC] Detectadas ${filesToUpload.length} imágenes nuevas localmente. Subiéndolas a Supabase Storage...`);

        let successCount = 0;
        let failCount = 0;

        for (const file of filesToUpload) {
            const filePath = path.join(folderPath, file);
            try {
                const fileBuffer = fs.readFileSync(filePath);
                const ext = path.extname(file).toLowerCase();
                const contentType = mimeTypes[ext] || 'application/octet-stream';

                const { error: uploadError } = await supabase.storage.from('yuri').upload(file, fileBuffer, {
                    contentType,
                    upsert: true
                });

                if (uploadError) {
                    if (uploadError.message.includes('row-level security policy') || uploadError.message.includes('violates row-level security')) {
                        console.error(`[YURI SYNC] ⚠️ Error RLS al subir ${file}: Asegúrate de crear una política RLS en Supabase que permita insertar/subir archivos en el bucket 'yuri'.`);
                    } else {
                        console.error(`[YURI SYNC] Error al subir ${file}:`, uploadError.message);
                    }
                    failCount++;
                } else {
                    successCount++;
                }
            } catch (err) {
                console.error(`[YURI SYNC] Excepción al procesar ${file}:`, err);
                failCount++;
            }
        }

        console.log(`[YURI SYNC] Sincronización finalizada: ${successCount} subidas exitosamente, ${failCount} fallidas.`);

    } catch (e) {
        console.error("[YURI SYNC] Error general durante la sincronización de imágenes:", e);
    }
}

module.exports = { syncYuriImages };
