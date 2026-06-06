const fetch = require('node-fetch');
const { parseOSR } = require("../../utils/osr_parser.js");
const { t } = require("../../../utils/i18n.js");
const OrdrModel = require("../../../models/OrdrModel.js");
const { doQueueEmbed, doProgressEmbed, doDoneEmbed, doErrorEmbed } = require("../../../views/ordrEmbeds.js");

async function run(messages, args) {
    const { message, reply } = messages;
    const locale = message.locale || 'es';

    // Comprobar si se solicitó el flag -config
    const hasConfigFlag = args.some(arg => arg.toLowerCase() === '-config');
    if (hasConfigFlag) {
        try {
            await message.channel.sendTyping();
            const preset = await OrdrModel.getUserPreset(message.author.id);
            if (!preset) {
                return t(locale, 'render.no_preset_found');
            }

            const name = preset.presetName || "Sin nombre";
            const lastSaved = preset.lastSavedOn ? new Date(preset.lastSavedOn).toLocaleDateString(locale) : "N/A";
            
            const embed = {
                title: "⚙️ Tu Configuración en o!rdr",
                description: `Tienes un preset enlazado a tu cuenta de Discord en o!rdr.\n\n` +
                             `**Nombre del Preset**: \`${name}\`\n` +
                             `**Última actualización**: \`${lastSaved}\`\n\n` +
                             `🔗 **¿Quieres cambiar tu configuración?**\n` +
                             `Por seguridad, debes hacerlo desde la página oficial de o!rdr iniciando sesión con Discord y guardando tus cambios allí:\n` +
                             `https://ordr.issou.best/`,
                color: 0x3498db,
                footer: {
                    text: `Sengo Bot • o!rdr presets`,
                    icon_url: message.client?.user?.displayAvatarURL() || ""
                }
            };
            return { embeds: [embed] };
        } catch (err) {
            console.error("Error al obtener la configuración de o!rdr:", err);
            return t(locale, 'render.err_config_fetch');
        }
    }

    // 1. Buscar el archivo adjunto .osr en el mensaje o en el mensaje respondido
    let attachment = message.attachments.find(a => a.name.endsWith('.osr'));
    if (!attachment && reply && reply.attachments) {
        attachment = reply.attachments.find(a => a.name.endsWith('.osr'));
    }

    if (!attachment) {
        return t(locale, 'render.err_no_attachment');
    }

    try {
        await message.channel.sendTyping();

        // 2. Descargar el buffer del replay
        const response = await fetch(attachment.url);
        if (!response.ok) {
            throw new Error(`Failed to fetch attachment: ${response.statusText}`);
        }
        const replayBuffer = await response.buffer();

        // 3. Parsear el replay para validar que sea de osu!standard (modo 0)
        const replayData = parseOSR(replayBuffer);
        if (!replayData) {
            return t(locale, 'replay.err_invalid_replay');
        }

        // o!rdr y Sengo solo soportan osu!standard (modo 0)
        if (replayData.gameMode !== 0) {
            return t(locale, 'render.err_only_std');
        }

        // 4. Parsear parámetros opcionales -skin y -res
        let skin = 'Default';
        let resolution = '1280x720';

        for (let i = 0; i < args.length; i++) {
            const arg = args[i].toLowerCase();
            if (arg === '-skin' && i + 1 < args.length) {
                skin = args[i + 1];
                i++;
            } else if ((arg === '-res' || arg === '-resolution') && i + 1 < args.length) {
                resolution = args[i + 1];
                i++;
            }
        }

        // 5. Iniciar el flujo de renderizado asíncronamente
        await startRenderFlow(messages, replayBuffer, attachment.name, { skin, resolution }, locale);
        return;

    } catch (err) {
        console.error("Error en s.render:", err);
        return t(locale, 'general.error_unexpected');
    }
}

/**
 * Inicia el flujo completo de renderizado: encolamiento, WebSocket y embeds.
 * @param {object} messages Objeto conteniendo message y reply
 * @param {Buffer} replayBuffer Buffer del archivo replay .osr
 * @param {string} fileName Nombre del archivo replay
 * @param {object} options Opciones de skin y resolución
 * @param {string} locale Código de idioma
 * @returns {Promise<number>} ID del render
 */
async function startRenderFlow(messages, replayBuffer, fileName, options = {}, locale = 'es') {
    const { message } = messages;
    const skin = options.skin || 'Default';
    const resolution = options.resolution || '1280x720';

    // Enviar solicitud de renderizado a o!rdr
    const renderData = await OrdrModel.requestRender({
        replayBuffer,
        fileName,
        skin,
        resolution,
        discordUserId: message?.author?.id,
        ...options
    });

    const renderId = renderData.renderID;
    const skinName = renderData.skin || skin;

    // Enviar embed de encolado inicial
    const queueEmbed = doQueueEmbed(message, renderId, { skin: skinName, resolution }, locale);
    const sentMessage = await message.channel.send({ embeds: [queueEmbed] });

    // Variables para control de actualizaciones (throttling) y evitar límites de rate de Discord
    let lastEditTime = Date.now();
    let lastState = '';
    let lastProgress = -1;

    // Iniciar el tracking de progreso en tiempo real mediante WebSockets
    OrdrModel.trackProgress(renderId, {
        onAdded: (data) => {
            console.log(`[o!rdr] Render #${renderId} agregado a la cola.`);
        },
        onProgress: async (data) => {
            const now = Date.now();
            const stateChanged = data.state !== lastState;
            const progressChanged = data.progress !== lastProgress;
            
            if (stateChanged || (progressChanged && (now - lastEditTime > 2500))) {
                lastState = data.state;
                lastProgress = data.progress;
                lastEditTime = now;

                const progressEmbed = doProgressEmbed(
                    message,
                    renderId,
                    data.progress,
                    data.state,
                    options.customDescription || data.description,
                    { skin: skinName, resolution },
                    locale
                );
                
                try {
                    await sentMessage.edit({ embeds: [progressEmbed] });
                } catch (err) {
                    console.error(`[o!rdr] Error al editar mensaje de progreso para #${renderId}:`, err);
                }
            }
        },
        onDone: async (data) => {
            console.log(`[o!rdr] Render #${renderId} finalizado correctamente.`);
            const { embed, components } = doDoneEmbed(
                message,
                renderId,
                data.videoUrl,
                options.customDescription || data.description,
                { skin: skinName, resolution },
                locale
            );
            
            try {
                let files = [];
                let content = data.videoUrl;
                
                try {
                    console.log(`📥 [o!rdr] Comprobando tamaño del video final en ${data.videoUrl}...`);
                    const headResponse = await fetch(data.videoUrl, { method: 'HEAD' });
                    if (headResponse.ok) {
                        const contentLength = parseInt(headResponse.headers.get('content-length') || '0');
                        const maxLimit = 25 * 1024 * 1024; // 25 MB
                        
                        if (contentLength > 0 && contentLength <= maxLimit) {
                            console.log(`📥 [o!rdr] Descargando video (${(contentLength / 1024 / 1024).toFixed(2)} MB)...`);
                            const videoResponse = await fetch(data.videoUrl);
                            if (videoResponse.ok) {
                                const videoBuffer = await videoResponse.buffer();
                                files.push({
                                    attachment: videoBuffer,
                                    name: `sengo_render_${renderId}.mp4`
                                });
                                content = '';
                            }
                        } else {
                            console.log(`⚠️ [o!rdr] Video demasiado grande para adjuntar (${(contentLength / 1024 / 1024).toFixed(2)} MB).`);
                        }
                    }
                } catch (fetchErr) {
                    console.error(`[o!rdr] Error al descargar/comprobar el video:`, fetchErr.message);
                }

                await sentMessage.edit({
                    content: content || null,
                    embeds: [embed],
                    components,
                    files
                });
            } catch (err) {
                console.error(`[o!rdr] Error al editar mensaje final para #${renderId}:`, err);
            }
        },
        onError: async (errorMessage) => {
            console.error(`[o!rdr] Render #${renderId} falló: ${errorMessage}`);
            const errorEmbed = doErrorEmbed(message, renderId, errorMessage, locale);
            
            try {
                await sentMessage.edit({ embeds: [errorEmbed], components: [] });
            } catch (err) {
                console.error(`[o!rdr] Error al editar mensaje de error para #${renderId}:`, err);
            }
        }
    }, locale);

    return renderId;
}

run.alias = {
    "render": { "args": "" }
};

run.description = {
    'header': t('es', 'commands.render.header'),
    'body': t('es', 'commands.render.body'),
    'usage': t('es', 'commands.render.usage')
};

module.exports = { run, startRenderFlow, description: run.description };
