const { EmbedBuilder, PermissionsBitField, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const axios = require("axios");
const path = require("path");
const sharp = require("sharp");

let list_order = [];

async function ensureBucketExists(supabase) {
    try {
        const { data: buckets, error: listError } = await supabase.storage.listBuckets();
        if (listError) return;
        const fumoBucket = buckets?.find(b => b.name === 'fumo');
        if (!fumoBucket) {
            await supabase.storage.createBucket('fumo', {
                public: true,
                fileSizeLimit: 10485760 // 10MB
            });
        }
    } catch (err) {
        console.error("[FUMO] Error al verificar/crear bucket:", err);
    }
}

async function compressImage(fileBuffer, ext) {
    if (ext === '.gif') {
        const compressed = await sharp(fileBuffer, { animated: true })
            .gif({ colours: 192 })
            .toBuffer();
        return {
            buffer: compressed,
            ext: '.gif',
            mime: 'image/gif'
        };
    }
    
    const compressed = await sharp(fileBuffer)
        .webp({ quality: 80 })
        .toBuffer();
    return {
        buffer: compressed,
        ext: '.webp',
        mime: 'image/webp'
    };
}

function parseFumoFilename(filename) {
    // Formato: ID - fumo - username - userId - guildId - hash.ext
    const ext = path.extname(filename).toLowerCase();
    const nameWithoutExt = path.basename(filename, ext).trim();
    const parts = nameWithoutExt.split(' - ');
    if (parts.length >= 5 && parts[1].toLowerCase() === 'fumo') {
        return {
            id: parseInt(parts[0]) || 0,
            username: parts[2],
            userId: parts[3],
            guildId: parts[4],
            hash: parts[5] || null,
            ext: ext
        };
    }
    // Fallback parser
    const idMatch = nameWithoutExt.match(/^(\d+)\s*-\s*fumo/i);
    return {
        id: idMatch ? parseInt(idMatch[1]) : 0,
        username: 'Desconocido',
        userId: 'Desconocido',
        guildId: 'Desconocido',
        hash: null,
        ext: ext
    };
}

function isAdmin(author, member) {
    if (process.env.OWNER_ID && author.id === process.env.OWNER_ID) return true;
    if (member && member.permissions && member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
    return false;
}

function validateAttachment(attachment) {
    const name = attachment.name || "";
    const ext = path.extname(name).toLowerCase();
    const allowedExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    if (!allowedExts.includes(ext)) {
        return { valid: false, reason: "Solo se permiten imágenes (.png, .jpg, .jpeg, .gif, .webp)" };
    }
    const contentType = attachment.contentType || "";
    if (contentType && !contentType.startsWith("image/")) {
        return { valid: false, reason: "El archivo no tiene un tipo MIME de imagen válido." };
    }
    if (contentType.toLowerCase().includes("svg") || ext === ".svg") {
        return { valid: false, reason: "No se permiten archivos SVG por razones de seguridad." };
    }
    if (attachment.size > 10 * 1024 * 1024) {
        return { valid: false, reason: "La imagen supera el límite de 10 MB." };
    }
    return { valid: true, ext };
}

async function handleUpload(supabase, author, guild, attachments, messageOrInteraction) {
    const isInteraction = messageOrInteraction && typeof messageOrInteraction.editReply === 'function';
    const updateStatus = async (text) => {
        if (isInteraction) {
            try {
                await messageOrInteraction.editReply({ content: text });
            } catch (e) {
                console.error("[FUMO] Error actualizando estado en slash command:", e);
            }
        }
        if (messageOrInteraction && messageOrInteraction.logger) {
            messageOrInteraction.logger.process(text);
        }
    };

    // Verificar blacklist
    const { data: blacklistRecord } = await supabase
        .from('fumo_blacklist')
        .select('discord_id')
        .eq('discord_id', author.id)
        .maybeSingle();
    
    if (blacklistRecord) {
        const errEmbed = new EmbedBuilder()
            .setColor("#ff3333")
            .setDescription("❌ No tienes permitido subir imágenes de fumo porque estás en la blacklist.");
        return { content: "", embeds: [errEmbed] };
    }

    if (!attachments || attachments.length === 0) {
        return "❌ Debes adjuntar al menos una imagen.";
    }

    await updateStatus(`⏳ Iniciando procesamiento de **${attachments.length}** imágenes...`);

    const successes = [];
    const failures = [];

    // Obtener el ID máximo actual del bucket
    const { data: files, error: listError } = await supabase.storage.from('fumo').list('', { limit: 10000 });
    if (listError) {
        return `❌ Error al listar archivos del storage: ${listError.message}`;
    }

    let maxId = 0;
    if (files && files.length > 0) {
        files.forEach(f => {
            const parsed = parseFumoFilename(f.name);
            if (parsed.id > maxId) {
                maxId = parsed.id;
            }
        });
    }

    const cleanUsername = author.username.replace(/[^a-zA-Z0-9_]/g, '_');
    const guildId = guild ? guild.id : 'DM';

    for (let index = 0; index < attachments.length; index++) {
        const attachment = attachments[index];
        const val = validateAttachment(attachment);
        if (!val.valid) {
            failures.push({ name: attachment.name, reason: val.reason });
            continue;
        }

        try {
            await updateStatus(`📥 Descargando imagen **${index + 1}/${attachments.length}**...`);
            const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
            const fileBuffer = Buffer.from(response.data);

            await updateStatus(`⚡ Comprimiendo imagen **${index + 1}/${attachments.length}**...`);
            const compressedResult = await compressImage(fileBuffer, val.ext);

            const crypto = require("crypto");
            const hash = crypto.createHash("md5").update(compressedResult.buffer).digest("hex");

            const existingDuplicate = files?.find(f => {
                const parsed = parseFumoFilename(f.name);
                return parsed.hash === hash;
            });

            if (existingDuplicate) {
                const parsed = parseFumoFilename(existingDuplicate.name);
                failures.push({ name: attachment.name, reason: `Esta imagen ya existe con el ID **${parsed.id}**` });
                continue;
            }

            await updateStatus(`📤 Subiendo imagen **${index + 1}/${attachments.length}** a la base de datos...`);
            maxId++;
            const newFilename = `${maxId} - fumo - ${cleanUsername} - ${author.id} - ${guildId} - ${hash}${compressedResult.ext}`;

            const { error: uploadError } = await supabase.storage.from('fumo').upload(newFilename, compressedResult.buffer, {
                contentType: compressedResult.mime,
                upsert: true
            });

            if (uploadError) {
                failures.push({ name: attachment.name, reason: `Error al subir: ${uploadError.message}` });
                maxId--;
            } else {
                const { data } = supabase.storage.from('fumo').getPublicUrl(newFilename);
                successes.push({ id: maxId, url: data.publicUrl, filename: newFilename });
            }
        } catch (err) {
            failures.push({ name: attachment.name, reason: `Error en descarga/compresión: ${err.message}` });
            maxId--;
        }
    }

    // Vaciar el orden aleatorio cacheado para forzar que las nuevas fotos se incluyan en la mezcla
    list_order = [];

    const embed = new EmbedBuilder()
        .setTitle("🧸 Registro de Fumos")
        .setColor(successes.length > 0 ? "#00ff88" : "#ff3333")
        .setTimestamp();

    if (successes.length > 0) {
        const successList = successes.map(s => `• **ID ${s.id}**`).join('\n');
        embed.addFields({ name: "✅ Fotos Subidas Correctamente", value: successList });
        embed.setImage(successes[0].url);
    }

    if (failures.length > 0) {
        const failureList = failures.map(f => `• **${f.name}**: ${f.reason}`).join('\n');
        embed.addFields({ name: "❌ Errores de Subida", value: failureList });
    }

    if (isInteraction) {
        await messageOrInteraction.editReply({ content: "", embeds: [embed] });
    }

    return { content: "", embeds: [embed] };
}

async function handleList(supabase, author, member, pageArg) {
    if (!isAdmin(author, member)) {
        return "❌ Este comando está reservado para los administradores.";
    }

    const { data: files, error } = await supabase.storage.from('fumo').list('', {
        limit: 10000,
        sortBy: { column: 'name', order: 'asc' }
    });

    if (error) {
        return `❌ Error al listar archivos: ${error.message}`;
    }

    const fumos = (files || [])
        .map(f => ({ name: f.name, parsed: parseFumoFilename(f.name) }))
        .filter(item => item.parsed.id > 0)
        .sort((a, b) => a.parsed.id - b.parsed.id);

    if (fumos.length === 0) {
        return "🧸 No hay fotos de fumo registradas en la base de datos.";
    }

    let page = parseInt(pageArg) || 1;
    if (isNaN(page) || page < 1) page = 1;
    const pageSize = 10;
    const totalPages = Math.ceil(fumos.length / pageSize);
    if (page > totalPages) page = totalPages;

    const pageFumos = fumos.slice((page - 1) * pageSize, page * pageSize);

    const embed = new EmbedBuilder()
        .setTitle("🧸 Lista de Fumos Registrados")
        .setColor("#bf4080")
        .setDescription(`Total registrados: **${fumos.length}** • Página **${page}** de **${totalPages}**`)
        .setTimestamp();

    const fields = [];
    for (const item of pageFumos) {
        const { id, username, userId, guildId } = item.parsed;
        fields.push(`**ID ${id}**\n👤 **Subido por:** ${username} (\`${userId}\`)\n🏰 **Servidor:** ${guildId === 'DM' ? 'Mensaje Privado' : `\`${guildId}\``}`);
    }

    embed.addFields({ name: "Resultados", value: fields.join('\n\n') });
    return { embeds: [embed] };
}

async function handleDelete(supabase, author, member, targetId) {
    if (!isAdmin(author, member)) {
        return "❌ Este comando está reservado para los administradores.";
    }

    if (!targetId || isNaN(parseInt(targetId))) {
        return "❌ Especifica un ID numérico de fumo válido para eliminar. Ejemplo: `.fumo delete 5`";
    }

    const id = parseInt(targetId);

    const { data: files, error } = await supabase.storage.from('fumo').list('', { limit: 10000 });
    if (error) return `❌ Error al listar archivos: ${error.message}`;

    const target = files?.find(f => {
        const parsed = parseFumoFilename(f.name);
        return parsed.id === id;
    });

    if (!target) {
        return `❌ No se encontró ningún fumo con el ID ${id}.`;
    }

    const { error: removeError } = await supabase.storage.from('fumo').remove([target.name]);
    if (removeError) {
        return `❌ Error al eliminar el archivo: ${removeError.message}`;
    }

    list_order = []; // limpiar caché para reflejar cambios

    return `✅ El fumo con ID **${id}** ha sido eliminado correctamente del storage.`;
}

async function handleEdit(supabase, author, member, targetId, attachments, messageOrInteraction) {
    if (!isAdmin(author, member)) {
        return "❌ Este comando está reservado para los administradores.";
    }

    if (!targetId || isNaN(parseInt(targetId))) {
        return "❌ Especifica un ID numérico de fumo válido para editar. Ejemplo: `.fumo edit 5` (y adjunta una imagen)";
    }

    if (!attachments || attachments.length === 0) {
        return "❌ Adjunta la nueva imagen para reemplazar la anterior.";
    }

    const id = parseInt(targetId);

    const isInteraction = messageOrInteraction && typeof messageOrInteraction.editReply === 'function';
    const updateStatus = async (text) => {
        if (isInteraction) {
            try {
                await messageOrInteraction.editReply({ content: text });
            } catch (e) {
                console.error("[FUMO] Error actualizando estado en edit:", e);
            }
        }
        if (messageOrInteraction && messageOrInteraction.logger) {
            messageOrInteraction.logger.process(text);
        }
    };

    await updateStatus("🔍 Buscando fumo en la base de datos...");

    const { data: files, error } = await supabase.storage.from('fumo').list('', { limit: 10000 });
    if (error) return `❌ Error al listar archivos: ${error.message}`;

    const target = files?.find(f => {
        const parsed = parseFumoFilename(f.name);
        return parsed.id === id;
    });

    if (!target) {
        return `❌ No se encontró ningún fumo con el ID ${id}.`;
    }

    const attachment = attachments[0];
    const val = validateAttachment(attachment);
    if (!val.valid) {
        return `❌ Archivo inválido: ${val.reason}`;
    }

    try {
        await updateStatus("📥 Descargando la nueva imagen...");
        const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
        const fileBuffer = Buffer.from(response.data);

        await updateStatus("⚡ Comprimiendo la nueva imagen...");
        const compressedResult = await compressImage(fileBuffer, val.ext);

        const crypto = require("crypto");
        const hash = crypto.createHash("md5").update(compressedResult.buffer).digest("hex");

        const existingDuplicate = files?.find(f => {
            const parsed = parseFumoFilename(f.name);
            return parsed.hash === hash && parsed.id !== id;
        });

        if (existingDuplicate) {
            const parsed = parseFumoFilename(existingDuplicate.name);
            return `❌ Esta imagen ya existe registrada con el ID **${parsed.id}**.`;
        }

        await updateStatus("📤 Subiendo y reemplazando la imagen...");
        const parsedOld = parseFumoFilename(target.name);
        const newTargetName = `${parsedOld.id} - fumo - ${parsedOld.username} - ${parsedOld.userId} - ${parsedOld.guildId} - ${hash}${compressedResult.ext}`;

        if (target.name !== newTargetName) {
            await supabase.storage.from('fumo').remove([target.name]);
        }

        const { error: uploadError } = await supabase.storage.from('fumo').upload(newTargetName, compressedResult.buffer, {
            contentType: compressedResult.mime,
            upsert: true
        });

        if (uploadError) {
            return `❌ Error al subir la nueva imagen: ${uploadError.message}`;
        }

        const { data } = supabase.storage.from('fumo').getPublicUrl(newTargetName);

        const embed = new EmbedBuilder()
            .setTitle(`✅ Fumo #${id} Reemplazado`)
            .setColor("#00ff88")
            .setDescription(`Se ha reemplazado la imagen del fumo ID **${id}** con éxito.`)
            .setImage(data.publicUrl)
            .setTimestamp();

        if (isInteraction) {
            await messageOrInteraction.editReply({ content: "", embeds: [embed] });
        }

        return { content: "", embeds: [embed] };
    } catch (err) {
        return `❌ Error al descargar/subir: ${err.message}`;
    }
}

async function handleBlacklist(supabase, author, member, action, targetUser) {
    if (!isAdmin(author, member)) {
        return "❌ Este comando está reservado para los administradores.";
    }

    if (action === 'list' || action === 'listar' || !action) {
        const { data, error } = await supabase
            .from('fumo_blacklist')
            .select('*');

        if (error) {
            return `❌ Error al consultar la blacklist: ${error.message}`;
        }

        if (!data || data.length === 0) {
            return "🖤 La blacklist de fumos está vacía.";
        }

        const listText = data.map((row, idx) => `${idx + 1}. <@${row.discord_id}> (\`${row.discord_id}\`) - Por: <@${row.added_by || 'Desconocido'}> el ${new Date(row.created_at).toLocaleDateString()}`).join('\n');
        
        const embed = new EmbedBuilder()
            .setTitle("🖤 Lista Negra de Fumos")
            .setColor("#2f3136")
            .setDescription(listText)
            .setTimestamp();

        return { embeds: [embed] };
    }

    if (!targetUser) {
        return "❌ Especifica el ID o mención del usuario. Ejemplo: `.fumo blacklist add <ID>`";
    }

    const targetUserId = targetUser.replace(/[^0-9]/g, '');
    if (!targetUserId || targetUserId.length < 17) {
        return "❌ ID de usuario inválido.";
    }

    if (action === 'add' || action === 'agregar') {
        const { error } = await supabase
            .from('fumo_blacklist')
            .upsert({ discord_id: targetUserId, added_by: author.id });

        if (error) {
            return `❌ Error al agregar a la blacklist: ${error.message}`;
        }

        return `✅ El usuario <@${targetUserId}> (\`${targetUserId}\`) ha sido agregado a la blacklist de fumos.`;
    }

    if (action === 'remove' || action === 'quitar' || action === 'delete') {
        const { error } = await supabase
            .from('fumo_blacklist')
            .delete()
            .eq('discord_id', targetUserId);

        if (error) {
            return `❌ Error al remover de la blacklist: ${error.message}`;
        }

        return `✅ El usuario <@${targetUserId}> (\`${targetUserId}\`) ha sido removido de la blacklist de fumos.`;
    }

    return "❌ Acción inválida. Usa: `add`, `remove` o `list`";
}

function getFumoButtonsRow(currentIndex, totalFumos) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('fumo_first')
            .setEmoji('⏮️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentIndex <= 0),
        new ButtonBuilder()
            .setCustomId('fumo_prev')
            .setEmoji('◀️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentIndex <= 0),
        new ButtonBuilder()
            .setCustomId('fumo_random')
            .setEmoji('🎲')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('fumo_next')
            .setEmoji('▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentIndex >= totalFumos - 1),
        new ButtonBuilder()
            .setCustomId('fumo_last')
            .setEmoji('⏭️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentIndex >= totalFumos - 1)
    );
}

async function handleShow(supabase, author, targetId, messageOrInteraction) {
    const { data: files, error } = await supabase.storage.from('fumo').list('', {
        limit: 10000,
        sortBy: { column: 'name', order: 'asc' }
    });

    if (error) {
        return `❌ Error al obtener los fumos de Supabase Storage: ${error.message}`;
    }

    const fumos = (files || [])
        .map(f => ({ name: f.name, parsed: parseFumoFilename(f.name) }))
        .filter(item => item.parsed.id > 0)
        .sort((a, b) => a.parsed.id - b.parsed.id);

    if (fumos.length === 0) {
        return "🧸 No hay fotos de fumo registradas. ¡Adjunta una imagen para subir la primera!";
    }

    let currentIndex = -1;

    if (targetId) {
        const id = parseInt(targetId);
        currentIndex = fumos.findIndex(f => f.parsed.id === id);
        if (currentIndex === -1) {
            return `❌ No se encontró ningún fumo con el ID **${id}**.`;
        }
    } else {
        if (list_order.length === 0) {
            list_order = shuffleArray([...fumos]);
        }
        const current = list_order.shift();
        if (current) {
            currentIndex = fumos.findIndex(f => f.parsed.id === current.parsed.id);
        }
        if (currentIndex === -1) {
            currentIndex = Math.floor(Math.random() * fumos.length);
        }
    }

    const getEmbed = (idx) => {
        const currentFumo = fumos[idx];
        const { data } = supabase.storage.from('fumo').getPublicUrl(currentFumo.name);
        return new EmbedBuilder()
            .setTitle(`🧸 Fumo #${currentFumo.parsed.id}`)
            .setColor("#bf4080")
            .setImage(data.publicUrl)
            .setFooter({ text: `Subido por: ${currentFumo.parsed.username} | Total Fumos: ${fumos.length}` });
    };

    const isInteraction = !!(messageOrInteraction && messageOrInteraction.editReply);
    const row = getFumoButtonsRow(currentIndex, fumos.length);

    let sentMessage;
    if (isInteraction) {
        sentMessage = await messageOrInteraction.editReply({
            embeds: [getEmbed(currentIndex)],
            components: [row]
        });
    } else if (messageOrInteraction) {
        sentMessage = await messageOrInteraction.channel.send({
            embeds: [getEmbed(currentIndex)],
            components: [row]
        });
    } else {
        return { embeds: [getEmbed(currentIndex)], components: [row] };
    }

    const filter = btnInt => btnInt.user.id === author.id;
    const collector = sentMessage.createMessageComponentCollector({
        filter,
        idle: 120000 // 2 minutos (120,000 ms)
    });

    collector.on('collect', async i => {
        try {
            await i.deferUpdate();

            if (i.customId === 'fumo_first') {
                currentIndex = 0;
            } else if (i.customId === 'fumo_prev') {
                currentIndex = Math.max(0, currentIndex - 1);
            } else if (i.customId === 'fumo_random') {
                currentIndex = Math.floor(Math.random() * fumos.length);
            } else if (i.customId === 'fumo_next') {
                currentIndex = Math.min(fumos.length - 1, currentIndex + 1);
            } else if (i.customId === 'fumo_last') {
                currentIndex = fumos.length - 1;
            }

            const newEmbed = getEmbed(currentIndex);
            const newRow = getFumoButtonsRow(currentIndex, fumos.length);

            await i.editReply({
                embeds: [newEmbed],
                components: [newRow]
            });
        } catch (err) {
            console.error("Error al navegar fumos:", err);
        }
    });

    collector.on('end', async () => {
        try {
            await sentMessage.edit({ components: [] });
        } catch (e) {}
    });
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

async function run(messages, args) {
    const { message } = messages;
    const logger = messages.logger;
    if (logger) {
        message.logger = logger;
    }
    const { getSupabaseClient } = require("../../../db/database.js");
    const supabase = getSupabaseClient();

    if (!supabase) {
        return "❌ Error: La base de datos no está disponible.";
    }

    await ensureBucketExists(supabase);

    const author = message.author;
    const member = message.member;
    const guild = message.guild;

    const sub = args[0] ? args[0].toLowerCase() : "";

    // Upload directe si adjunta archivos sin subcomando admin
    if (message.attachments && message.attachments.size > 0 && !['list', 'listar', 'delete', 'borrar', 'edit', 'editar', 'blacklist'].includes(sub)) {
        const attachments = Array.from(message.attachments.values());
        return await handleUpload(supabase, author, guild, attachments, message);
    }

    if (sub === 'upload' || sub === 'subir') {
        const attachments = Array.from(message.attachments.values());
        return await handleUpload(supabase, author, guild, attachments, message);
    }

    if (sub === 'list' || sub === 'listar') {
        return await handleList(supabase, author, member, args[1]);
    }

    if (sub === 'delete' || sub === 'borrar') {
        return await handleDelete(supabase, author, member, args[1]);
    }

    if (sub === 'edit' || sub === 'editar') {
        const attachments = Array.from(message.attachments.values());
        return await handleEdit(supabase, author, member, args[1], attachments, message);
    }

    if (sub === 'blacklist') {
        const action = args[1] ? args[1].toLowerCase() : "";
        const targetUser = args[2];
        return await handleBlacklist(supabase, author, member, action, targetUser);
    }

    // Mostrar fumo específico o aleatorio
    if (args[0] && !isNaN(parseInt(args[0]))) {
        return await handleShow(supabase, author, args[0], message);
    }

    return await handleShow(supabase, author, null, message);
}

run.description = {
    header: "Fumo",
    body: "Muestra imágenes de fumos aleatorias o específicas, y permite a los usuarios subir nuevas imágenes al repositorio.",
    usage: "s.fumo [id | subir | listar | borrar | editar | blacklist]"
};

module.exports = {
    run,
    handleUpload,
    handleList,
    handleDelete,
    handleEdit,
    handleBlacklist,
    handleShow,
    ensureBucketExists
};
