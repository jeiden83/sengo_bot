const { EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const axios = require("axios");
const path = require("path");
const sharp = require("sharp");
const { t } = require("../../../utils/i18n.js");

let list_order = [];

// Cola global de promesas para asegurar procesamiento secuencial de compresión en todo el bot
let globalCompressionQueue = Promise.resolve();

async function runQueuedCompression(fn) {
    const previous = globalCompressionQueue;
    const current = (async () => {
        try {
            await previous;
        } catch {}
        return await fn();
    })();
    globalCompressionQueue = current.catch(() => {});
    return current;
}

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
    // Configurar límites de memoria y concurrencia de Sharp para evitar OOM en Render
    sharp.cache(false);
    sharp.concurrency(1);

    if (ext === '.gif') {
        // Bypaseamos la compresión de GIFs para evitar picos de memoria y CPU extremos.
        return {
            buffer: fileBuffer,
            ext: '.gif',
            mime: 'image/gif'
        };
    }
    
    // Encolar la compresión de Sharp para que solo se procese una imagen a la vez a nivel global del bot.
    return runQueuedCompression(async () => {
        try {
            let pipeline = sharp(fileBuffer);
            
            // Obtener metadatos sin decodificar completamente la imagen en memoria
            const metadata = await pipeline.metadata();
            
            // Guardia de resolución máxima (evita procesar imágenes colosales que causan OOM)
            // Si supera los 8000x8000, no la comprimimos con Sharp para evitar OOM, sino que la subimos original.
            if (metadata.width > 8000 || metadata.height > 8000) {
                console.log(`[FUMO] Imagen gigante (${metadata.width}x${metadata.height}). Bypasseando compresión.`);
                const mimeTypes = {
                    '.png': 'image/png',
                    '.gif': 'image/gif',
                    '.webp': 'image/webp',
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg'
                };
                return {
                    buffer: fileBuffer,
                    ext: ext,
                    mime: mimeTypes[ext] || 'image/jpeg'
                };
            }
            
            // Redimensionar si supera los 1280px para optimizar tamaño y RAM
            if (metadata.width > 1280 || metadata.height > 1280) {
                pipeline = pipeline.resize({
                    width: 1280,
                    height: 1280,
                    fit: 'inside',
                    withoutEnlargement: true
                });
            }

            const compressed = await pipeline
                .webp({ quality: 80 })
                .toBuffer();
                
            return {
                buffer: compressed,
                ext: '.webp',
                mime: 'image/webp'
            };
        } catch (err) {
            console.error("[FUMO] Error durante la compresión con Sharp. Subiendo original:", err);
            // Fallback: dejarla subir sin comprimir
            const mimeTypes = {
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg'
            };
            return {
                buffer: fileBuffer,
                ext: ext,
                mime: mimeTypes[ext] || 'image/jpeg'
            };
        }
    });
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

function getLocale(messageOrInteraction) {
    if (!messageOrInteraction) return 'es';
    if (messageOrInteraction.resolvedLocale) return messageOrInteraction.resolvedLocale;
    if (messageOrInteraction.locale) {
        if (typeof messageOrInteraction.locale === 'string') {
            const code = messageOrInteraction.locale.split('-')[0].toLowerCase();
            if (code === 'es' || code === 'en') return code;
        }
    }
    return messageOrInteraction.locale || 'es';
}

function validateAttachment(attachment, locale) {
    const name = attachment.name || "";
    const ext = path.extname(name).toLowerCase();
    const allowedExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    if (!allowedExts.includes(ext)) {
        return { valid: false, reason: t(locale, "fumo.val_err_ext") };
    }
    const contentType = attachment.contentType || "";
    if (contentType && !contentType.startsWith("image/")) {
        return { valid: false, reason: t(locale, "fumo.val_err_mime") };
    }
    if (contentType.toLowerCase().includes("svg") || ext === ".svg") {
        return { valid: false, reason: t(locale, "fumo.val_err_svg") };
    }
    if (attachment.size > 10 * 1024 * 1024) {
        return { valid: false, reason: t(locale, "fumo.val_err_size") };
    }
    return { valid: true, ext };
}

async function handleUpload(supabase, author, guild, attachments, messageOrInteraction) {
    const locale = getLocale(messageOrInteraction);
    const isInteraction = messageOrInteraction && typeof messageOrInteraction.editReply === 'function';
    const updateStatus = async (text) => {
        const mem = process.memoryUsage();
        const ramFormatted = `${(mem.rss / 1024 / 1024).toFixed(1)} MB`;
        const consoleText = `${text} [RAM: ${ramFormatted}]`;

        if (isInteraction) {
            try {
                await messageOrInteraction.editReply({ content: text });
            } catch (e) {
                console.error("[FUMO] Error actualizando estado en slash command:", e);
            }
        }
        if (messageOrInteraction && messageOrInteraction.logger) {
            messageOrInteraction.logger.process(consoleText);
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
            .setDescription(t(locale, "fumo.upload_err_blacklist"));
        return { content: "", embeds: [errEmbed] };
    }

    if (!attachments || attachments.length === 0) {
        return t(locale, "fumo.upload_err_no_attachments");
    }

    await updateStatus(t(locale, "fumo.upload_processing", { count: attachments.length }));

    const successes = [];
    const failures = [];

    // Obtener el ID máximo actual del bucket
    const { data: files, error: listError } = await supabase.storage.from('fumo').list('', { limit: 10000 });
    if (listError) {
        return t(locale, "fumo.upload_err_storage", { error: listError.message });
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
        const val = validateAttachment(attachment, locale);
        if (!val.valid) {
            failures.push({ name: attachment.name, reason: val.reason });
            continue;
        }

        try {
            await updateStatus(t(locale, "fumo.upload_downloading", { current: index + 1, total: attachments.length }));
            const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
            const fileBuffer = Buffer.from(response.data);

            await updateStatus(t(locale, "fumo.upload_compressing", { current: index + 1, total: attachments.length }));
            const compressedResult = await compressImage(fileBuffer, val.ext);

            const crypto = require("crypto");
            const hash = crypto.createHash("md5").update(compressedResult.buffer).digest("hex");

            const existingDuplicate = files?.find(f => {
                const parsed = parseFumoFilename(f.name);
                return parsed.hash === hash;
            });

            if (existingDuplicate) {
                const parsed = parseFumoFilename(existingDuplicate.name);
                failures.push({ name: attachment.name, reason: t(locale, "fumo.upload_err_duplicate", { id: parsed.id }) });
                continue;
            }

            await updateStatus(t(locale, "fumo.upload_uploading", { current: index + 1, total: attachments.length }));
            maxId++;
            const newFilename = `${maxId} - fumo - ${cleanUsername} - ${author.id} - ${guildId} - ${hash}${compressedResult.ext}`;

            const { error: uploadError } = await supabase.storage.from('fumo').upload(newFilename, compressedResult.buffer, {
                contentType: compressedResult.mime,
                upsert: true
            });

            if (uploadError) {
                failures.push({ name: attachment.name, reason: t(locale, "fumo.upload_err_upload", { error: uploadError.message }) });
                maxId--;
            } else {
                const { data } = supabase.storage.from('fumo').getPublicUrl(newFilename);
                successes.push({ id: maxId, url: data.publicUrl, filename: newFilename });
            }
        } catch (err) {
            failures.push({ name: attachment.name, reason: t(locale, "fumo.upload_err_generic", { error: err.message }) });
            maxId--;
        }
    }

    // Vaciar el orden aleatorio cacheado para forzar que las nuevas fotos se incluyan en la mezcla
    list_order = [];

    const embed = new EmbedBuilder()
        .setTitle(t(locale, "fumo.upload_embed_title"))
        .setColor(successes.length > 0 ? "#00ff88" : "#ff3333")
        .setTimestamp();

    if (successes.length > 0) {
        const successList = successes.map(s => `• **ID ${s.id}**`).join('\n');
        embed.addFields({ name: t(locale, "fumo.upload_success_title"), value: successList });
        embed.setImage(successes[0].url);
    }

    if (failures.length > 0) {
        const failureList = failures.map(f => `• **${f.name}**: ${f.reason}`).join('\n');
        embed.addFields({ name: t(locale, "fumo.upload_errors_title"), value: failureList });
    }

    if (isInteraction) {
        await messageOrInteraction.editReply({ content: "", embeds: [embed] });
    }

    return { content: "", embeds: [embed] };
}

async function handleList(supabase, author, member, pageArg, messageOrInteraction) {
    const locale = getLocale(messageOrInteraction);
    if (!isAdmin(author, member)) {
        return t(locale, "fumo.err_only_admin");
    }

    const { data: files, error } = await supabase.storage.from('fumo').list('', {
        limit: 10000,
        sortBy: { column: 'name', order: 'asc' }
    });

    if (error) {
        return t(locale, "fumo.upload_err_storage", { error: error.message });
    }

    const fumos = (files || [])
        .map(f => ({ name: f.name, parsed: parseFumoFilename(f.name) }))
        .filter(item => item.parsed.id > 0)
        .sort((a, b) => a.parsed.id - b.parsed.id);

    if (fumos.length === 0) {
        return t(locale, "fumo.no_registered");
    }

    let page = parseInt(pageArg) || 1;
    if (isNaN(page) || page < 1) page = 1;
    const pageSize = 10;
    const totalPages = Math.ceil(fumos.length / pageSize);
    if (page > totalPages) page = totalPages;

    const pageFumos = fumos.slice((page - 1) * pageSize, page * pageSize);

    const embed = new EmbedBuilder()
        .setTitle(t(locale, "fumo.list_title"))
        .setColor("#bf4080")
        .setDescription(t(locale, "fumo.list_desc", { total: fumos.length, page, pages: totalPages }))
        .setTimestamp();

    const fields = [];
    for (const item of pageFumos) {
        const { id, username, userId, guildId } = item.parsed;
        const guildStr = guildId === 'DM' ? t(locale, "fumo.list_guild_dm") : `\`${guildId}\``;
        fields.push(t(locale, "fumo.list_row", { id, username, userId, guild: guildStr }));
    }

    embed.addFields({ name: t(locale, "fumo.list_results_field"), value: fields.join('\n\n') });
    return { embeds: [embed] };
}

async function handleDelete(supabase, author, member, targetId, messageOrInteraction) {
    const locale = getLocale(messageOrInteraction);
    if (!isAdmin(author, member)) {
        return t(locale, "fumo.err_only_admin");
    }

    if (!targetId || isNaN(parseInt(targetId))) {
        return t(locale, "fumo.err_invalid_id_delete");
    }

    const id = parseInt(targetId);

    const { data: files, error } = await supabase.storage.from('fumo').list('', { limit: 10000 });
    if (error) return t(locale, "fumo.upload_err_storage", { error: error.message });

    const target = files?.find(f => {
        const parsed = parseFumoFilename(f.name);
        return parsed.id === id;
    });

    if (!target) {
        return t(locale, "fumo.err_not_found", { id });
    }

    const { error: removeError } = await supabase.storage.from('fumo').remove([target.name]);
    if (removeError) {
        return t(locale, "fumo.err_delete_failed", { error: removeError.message });
    }

    list_order = []; // limpiar caché para reflejar cambios

    return t(locale, "fumo.delete_success", { id });
}

async function handleEdit(supabase, author, member, targetId, attachments, messageOrInteraction) {
    const locale = getLocale(messageOrInteraction);
    if (!isAdmin(author, member)) {
        return t(locale, "fumo.err_only_admin");
    }

    if (!targetId || isNaN(parseInt(targetId))) {
        return t(locale, "fumo.err_invalid_id_edit");
    }

    if (!attachments || attachments.length === 0) {
        return t(locale, "fumo.err_no_image_edit");
    }

    const id = parseInt(targetId);

    const isInteraction = messageOrInteraction && typeof messageOrInteraction.editReply === 'function';
    const updateStatus = async (text) => {
        const mem = process.memoryUsage();
        const ramFormatted = `${(mem.rss / 1024 / 1024).toFixed(1)} MB`;
        const consoleText = `${text} [RAM: ${ramFormatted}]`;

        if (isInteraction) {
            try {
                await messageOrInteraction.editReply({ content: text });
            } catch (e) {
                console.error("[FUMO] Error actualizando estado en edit:", e);
            }
        }
        if (messageOrInteraction && messageOrInteraction.logger) {
            messageOrInteraction.logger.process(consoleText);
        }
    };

    await updateStatus(t(locale, "fumo.edit_searching"));

    const { data: files, error } = await supabase.storage.from('fumo').list('', { limit: 10000 });
    if (error) return t(locale, "fumo.upload_err_storage", { error: error.message });

    const target = files?.find(f => {
        const parsed = parseFumoFilename(f.name);
        return parsed.id === id;
    });

    if (!target) {
        return t(locale, "fumo.err_not_found", { id });
    }

    const attachment = attachments[0];
    const val = validateAttachment(attachment, locale);
    if (!val.valid) {
        return t(locale, "fumo.edit_err_generic", { error: val.reason });
    }

    try {
        await updateStatus(t(locale, "fumo.upload_downloading", { current: 1, total: 1 }));
        const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
        const fileBuffer = Buffer.from(response.data);

        await updateStatus(t(locale, "fumo.upload_compressing", { current: 1, total: 1 }));
        const compressedResult = await compressImage(fileBuffer, val.ext);

        const crypto = require("crypto");
        const hash = crypto.createHash("md5").update(compressedResult.buffer).digest("hex");

        const existingDuplicate = files?.find(f => {
            const parsed = parseFumoFilename(f.name);
            return parsed.hash === hash && parsed.id !== id;
        });

        if (existingDuplicate) {
            const parsed = parseFumoFilename(existingDuplicate.name);
            return t(locale, "fumo.edit_err_duplicate", { id: parsed.id });
        }

        await updateStatus(t(locale, "fumo.edit_uploading"));
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
            return t(locale, "fumo.edit_err_upload", { error: uploadError.message });
        }

        const { data } = supabase.storage.from('fumo').getPublicUrl(newTargetName);

        const embed = new EmbedBuilder()
            .setTitle(t(locale, "fumo.edit_success_title", { id }))
            .setColor("#00ff88")
            .setDescription(t(locale, "fumo.edit_success_desc", { id }))
            .setImage(data.publicUrl)
            .setTimestamp();

        if (isInteraction) {
            await messageOrInteraction.editReply({ content: "", embeds: [embed] });
        }

        return { content: "", embeds: [embed] };
    } catch (err) {
        return t(locale, "fumo.edit_err_generic", { error: err.message });
    }
}

async function handleBlacklist(supabase, author, member, action, targetUser, messageOrInteraction) {
    const locale = getLocale(messageOrInteraction);
    if (!isAdmin(author, member)) {
        return t(locale, "fumo.err_only_admin");
    }

    if (action === 'list' || action === 'listar' || !action) {
        const { data, error } = await supabase
            .from('fumo_blacklist')
            .select('*');

        if (error) {
            return t(locale, "fumo.blacklist_err_add", { error: error.message });
        }

        if (!data || data.length === 0) {
            return t(locale, "fumo.blacklist_empty");
        }

        const listText = data.map((row, idx) => `${idx + 1}. <@${row.discord_id}> (\`${row.discord_id}\`) - Por: <@${row.added_by || 'Desconocido'}> el ${new Date(row.created_at).toLocaleDateString()}`).join('\n');
        
        const embed = new EmbedBuilder()
            .setTitle(t(locale, "fumo.blacklist_title"))
            .setColor("#2f3136")
            .setDescription(listText)
            .setTimestamp();

        return { embeds: [embed] };
    }

    if (!targetUser) {
        return t(locale, "fumo.blacklist_err_no_user");
    }

    const targetUserId = targetUser.replace(/[^0-9]/g, '');
    if (!targetUserId || targetUserId.length < 17) {
        return t(locale, "fumo.blacklist_err_invalid_user");
    }

    if (action === 'add' || action === 'agregar') {
        const { error } = await supabase
            .from('fumo_blacklist')
            .upsert({ discord_id: targetUserId, added_by: author.id });

        if (error) {
            return t(locale, "fumo.blacklist_err_add", { error: error.message });
        }

        return t(locale, "fumo.blacklist_add_success", { userId: targetUserId });
    }

    if (action === 'remove' || action === 'quitar' || action === 'delete') {
        const { error } = await supabase
            .from('fumo_blacklist')
            .delete()
            .eq('discord_id', targetUserId);

        if (error) {
            return t(locale, "fumo.blacklist_err_remove", { error: error.message });
        }

        return t(locale, "fumo.blacklist_remove_success", { userId: targetUserId });
    }

    return t(locale, "fumo.blacklist_invalid_action");
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
    const locale = getLocale(messageOrInteraction);
    const { data: files, error } = await supabase.storage.from('fumo').list('', {
        limit: 10000,
        sortBy: { column: 'name', order: 'asc' }
    });

    if (error) {
        return t(locale, "fumo.show_err_storage", { error: error.message });
    }

    const fumos = (files || [])
        .map(f => ({ name: f.name, parsed: parseFumoFilename(f.name) }))
        .filter(item => item.parsed.id > 0)
        .sort((a, b) => a.parsed.id - b.parsed.id);

    if (fumos.length === 0) {
        return t(locale, "fumo.show_no_registered");
    }

    let currentIndex = -1;

    if (targetId) {
        const id = parseInt(targetId);
        currentIndex = fumos.findIndex(f => f.parsed.id === id);
        if (currentIndex === -1) {
            return t(locale, "fumo.err_not_found", { id });
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
            .setFooter({ text: t(locale, "fumo.show_footer", { username: currentFumo.parsed.username, total: fumos.length }) });
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
        } catch {}
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
    const locale = getLocale(message);
    if (process.env.OWNER_ID && author.id !== process.env.OWNER_ID) {
        return t(locale, "fumo.err_owner_only");
    }

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
        return await handleList(supabase, author, member, args[1], message);
    }

    if (sub === 'delete' || sub === 'borrar') {
        return await handleDelete(supabase, author, member, args[1], message);
    }

    if (sub === 'edit' || sub === 'editar') {
        const attachments = Array.from(message.attachments.values());
        return await handleEdit(supabase, author, member, args[1], attachments, message);
    }

    if (sub === 'blacklist') {
        const action = args[1] ? args[1].toLowerCase() : "";
        const targetUser = args[2];
        return await handleBlacklist(supabase, author, member, action, targetUser, message);
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
