const fs = require('fs');
const path = require('path');

const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif'
};

/**
 * Sanitiza el nombre del archivo para que sea un Key válido en Supabase Storage
 * pero manteniendo el formato original (letras, números, espacios estándar y guiones).
 */
function sanitizeStorageKey(fileName) {
    if (!fileName) return '';
    
    // Separar nombre y extensión
    const ext = path.extname(fileName).toLowerCase();
    const nameWithoutExt = path.basename(fileName, ext);

    const sanitizedName = nameWithoutExt
        // 1. Normalizar caracteres unicode con acentos (ej. Pág -> Pag)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        // 2. Reemplazar cualquier espacio no estándar (como \u00a0 / &nbsp;) por un espacio estándar
        .replace(/[\s\u00a0]+/g, ' ')
        // 3. Eliminar caracteres completamente inválidos en keys de S3/Supabase (solo permitimos letras, números, puntos, guiones, guiones bajos y espacios estándar)
        .replace(/[^a-zA-Z0-9.\-\s_]/g, '')
        // 4. Quitar espacios dobles o bordes
        .trim();

    return sanitizedName + ext;
}

/**
 * Parsea el nombre de un archivo Yuri para extraer ID, nombre_serie, capitulo, pagina, medio y subida_por
 */
function parseYuriFilename(fileName) {
    const ext = path.extname(fileName);
    let nameWithoutExt = path.basename(fileName, ext).trim();

    // 1. Extraer ID del inicio (ej. "136 - Koharu..." -> ID = 136)
    const idMatch = nameWithoutExt.match(/^(\d+)\s*-\s*(.*)$/);
    let id = null;
    let rest = nameWithoutExt;
    if (idMatch) {
        id = parseInt(idMatch[1]);
        rest = idMatch[2].trim();
    } else {
        const firstNumMatch = nameWithoutExt.match(/^(\d+)\s+(.*)$/);
        if (firstNumMatch) {
            id = parseInt(firstNumMatch[1]);
            rest = firstNumMatch[2].trim();
        }
    }

    // 2. Extraer uploader (cualquier cosa después de # al final)
    let subida_por = 'Jeiden';
    const uploaderMatch = rest.match(/(.*)#([a-zA-Z0-9_-]+)\s*$/);
    if (uploaderMatch) {
        rest = uploaderMatch[1].trim();
        subida_por = uploaderMatch[2].trim();
    }

    // Quitar guiones finales
    if (rest.endsWith('-')) {
        rest = rest.slice(0, -1).trim();
    }

    // 3. Normalizar espacios no estándar en el resto del nombre
    rest = rest.replace(/[\s\u00a0]+/g, ' ');

    // 4. Normalizar guiones mal espaciados, pero solo si tienen un espacio en al menos uno de los lados (evitando palabras compuestas como Asumi-chan o One-shot)
    rest = rest.replace(/(\s+-\s*|\s*-\s+)/g, ' - ');

    // 5. Determinar el medio
    let medio = 'manga'; // default
    const lowerRest = rest.toLowerCase();
    if (lowerRest.includes('(ln)') || lowerRest.includes('novel') || lowerRest.includes('novela ligera')) {
        medio = 'novela ligera';
    } else if (/\b(min|minute|minutes)\b/i.test(lowerRest) || ext.toLowerCase() === '.gif') {
        medio = 'anime';
    }

    // 6. Parsear partes por " - " (requiere espacio antes y después del guion para ser separador)
    const parts = rest.split(/\s+-\s+/).map(p => p.trim()).filter(Boolean);

    let nombre_serie = '';
    let capitulo = null;
    let pagina = null;

    if (parts.length === 1) {
        nombre_serie = parts[0];
    } else if (parts.length === 2) {
        nombre_serie = parts[0];
        const detail = parts[1];
        const lowerDetail = detail.toLowerCase();
        if (lowerDetail.includes('cap') || lowerDetail.includes('vol') || lowerDetail.includes('one shot') || lowerDetail.includes('oneshot') || lowerDetail.includes('vn')) {
            capitulo = detail;
        } else if (lowerDetail.includes('pag') || lowerDetail.includes('pág') || lowerDetail.includes('min')) {
            pagina = detail;
        } else {
            capitulo = detail;
        }
    } else {
        nombre_serie = parts[0];
        for (let i = 1; i < parts.length; i++) {
            const part = parts[i];
            const lowerPart = part.toLowerCase();
            if (lowerPart.includes('cap') || lowerPart.includes('vol') || lowerPart.includes('one shot') || lowerPart.includes('oneshot') || lowerPart.includes('vn')) {
                capitulo = part;
            } else if (lowerPart.includes('pag') || lowerPart.includes('pág') || lowerPart.includes('min')) {
                pagina = part;
            } else {
                if (!capitulo) {
                    capitulo = part;
                } else if (!pagina) {
                    pagina = part;
                }
            }
        }
    }

    if (nombre_serie.endsWith('-')) {
        nombre_serie = nombre_serie.slice(0, -1).trim();
    }

    // Si tiene (LN) o similar en el nombre de la serie, limpiarlo para normalizar el nombre
    nombre_serie = nombre_serie.replace(/\s*\(LN\)\s*/i, '').trim();

    return {
        id,
        nombre_serie,
        capitulo,
        pagina,
        medio,
        subida_por,
        file_name: sanitizeStorageKey(fileName)
    };
}

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

        // Mapear archivos locales a sus nombres originales y sanitizados
        const localFilesMapped = localFiles.map(f => {
            return {
                original: f,
                sanitized: sanitizeStorageKey(f)
            };
        });

        // 3. Filtrar cuáles imágenes locales faltan por subir al storage
        const filesToUpload = localFilesMapped.filter(f => !remoteNames.has(f.sanitized));
        if (filesToUpload.length > 0) {
            console.log(`[YURI SYNC] Detectadas ${filesToUpload.length} imágenes nuevas localmente. Subiéndolas a Supabase Storage...`);

            let successCount = 0;
            let failCount = 0;

            for (const file of filesToUpload) {
                const filePath = path.join(folderPath, file.original);
                try {
                    const fileBuffer = fs.readFileSync(filePath);
                    const ext = path.extname(file.original).toLowerCase();
                    const contentType = mimeTypes[ext] || 'application/octet-stream';

                    const { error: uploadError } = await supabase.storage.from('yuri').upload(file.sanitized, fileBuffer, {
                        contentType,
                        upsert: true
                    });

                    if (uploadError) {
                        if (uploadError.message.includes('row-level security policy') || uploadError.message.includes('violates row-level security')) {
                            console.error(`[YURI SYNC] ⚠️ Error RLS al subir ${file.original}: Asegúrate de crear una política RLS en Supabase que permita insertar/subir archivos en el bucket 'yuri'.`);
                        } else {
                            console.error(`[YURI SYNC] Error al subir ${file.original}:`, uploadError.message);
                        }
                        failCount++;
                    } else {
                        successCount++;
                    }
                } catch (err) {
                    console.error(`[YURI SYNC] Excepción al procesar ${file.original}:`, err);
                    failCount++;
                }
            }

            console.log(`[YURI SYNC] Sincronización finalizada en Storage: ${successCount} subidas exitosamente, ${failCount} fallidas.`);
        } else {
            console.log("[YURI SYNC] El bucket yuri ya está sincronizado. 0 imágenes nuevas por subir.");
        }

        // 4. Sincronizar metadatos con la tabla 'yuri_images'
        console.log("[YURI SYNC] Sincronizando metadatos con la tabla 'yuri_images'...");
        
        // Obtener todos los IDs y fechas de modificación de la base de datos
        const { data: dbRows, error: dbQueryError } = await supabase
            .from('yuri_images')
            .select('id, fecha_modificacion');
            
        if (dbQueryError) {
            console.error("[YURI SYNC] Error al consultar la tabla 'yuri_images':", dbQueryError.message);
        } else {
            const dbIds = new Set((dbRows || []).map(r => r.id));
            const dbRowsMap = new Map((dbRows || []).map(r => [r.id, r]));
            
            const newDbRecords = [];
            const recordsToUpdate = [];

            for (const file of localFiles) {
                const parsed = parseYuriFilename(file);
                
                // Obtener fecha de modificación física del archivo
                const filePath = path.join(folderPath, file);
                let fecha_modificacion = new Date().toISOString();
                if (fs.existsSync(filePath)) {
                    try {
                        const stat = fs.statSync(filePath);
                        fecha_modificacion = stat.mtime.toISOString();
                    } catch (e) {
                        console.error(`Error al obtener mtime de ${file}:`, e);
                    }
                }
                parsed.fecha_modificacion = fecha_modificacion;

                if (parsed.id !== null) {
                    if (!dbIds.has(parsed.id)) {
                        newDbRecords.push(parsed);
                    } else {
                        const existing = dbRowsMap.get(parsed.id);
                        if (!existing || !existing.fecha_modificacion) {
                            recordsToUpdate.push({
                                id: parsed.id,
                                fecha_modificacion: parsed.fecha_modificacion
                            });
                        }
                    }
                }
            }
            
            // Actualizar registros existentes que no tengan la fecha de modificación
            if (recordsToUpdate.length > 0) {
                console.log(`[YURI SYNC] Detectados ${recordsToUpdate.length} registros existentes con fecha_modificacion faltante. Actualizando...`);
                for (const rec of recordsToUpdate) {
                    const { error: updateError } = await supabase
                        .from('yuri_images')
                        .update({ fecha_modificacion: rec.fecha_modificacion })
                        .eq('id', rec.id);
                    if (updateError) {
                        console.error(`[YURI SYNC] Error al actualizar fecha para ID ${rec.id}:`, updateError.message);
                    }
                }
                console.log("[YURI SYNC] Actualización de fechas completada.");
            }

            if (newDbRecords.length > 0) {
                console.log(`[YURI SYNC] Detectados ${newDbRecords.length} nuevos registros para la tabla 'yuri_images'. Registrándolos...`);
                
                // Insertar en lotes de 50 para evitar exceder límites
                const batchSize = 50;
                let registeredCount = 0;
                for (let i = 0; i < newDbRecords.length; i += batchSize) {
                    const batch = newDbRecords.slice(i, i + batchSize);
                    const { error: insertError } = await supabase
                        .from('yuri_images')
                        .insert(batch);
                        
                    if (insertError) {
                        console.error("[YURI SYNC] Error al insertar lote en 'yuri_images':", insertError.message);
                    } else {
                        registeredCount += batch.length;
                    }
                }
                console.log(`[YURI SYNC] Metadatos de ${registeredCount} imágenes insertados correctamente en Supabase.`);
            } else {
                console.log("[YURI SYNC] Todos los metadatos de imágenes ya están al día en la tabla 'yuri_images'.");
            }
        }

    } catch (e) {
        console.error("[YURI SYNC] Error general durante la sincronización de imágenes:", e);
    }
}

module.exports = { syncYuriImages, parseYuriFilename, sanitizeStorageKey };
