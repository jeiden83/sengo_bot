const fetch = require('node-fetch');
const { parseOSR } = require("../../utils/osr_parser.js");
const { t } = require("../../../utils/i18n.js");
const OrdrModel = require("../../../models/OrdrModel.js");
const { doQueueEmbed, doProgressEmbed, doDoneEmbed, doErrorEmbed } = require("../../../views/ordrEmbeds.js");

// Constante de cooldown: 5 minutos en milisegundos
const RENDER_COOLDOWN_MS = 5 * 60 * 1000;

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
            
            let description = t(locale, 'render.config_desc', { name, lastSaved });

            if (preset.isDevSimulated) {
                description += t(locale, 'render.dev_mode_preset_warning') + `\n\n`;
            }

            description += t(locale, 'render.config_how_to_change');

            const embed = {
                title: t(locale, 'render.config_title'),
                description,
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
        let skin = undefined;
        let resolution = '1280x720';
        let skinSpecified = false;

        for (let i = 0; i < args.length; i++) {
            const arg = args[i].toLowerCase();
            if (arg === '-skin' && i + 1 < args.length) {
                skin = args[i + 1];
                skinSpecified = true;
                i++;
            } else if ((arg === '-res' || arg === '-resolution') && i + 1 < args.length) {
                resolution = args[i + 1];
                i++;
            }
        }

        // 5. Iniciar el flujo de renderizado asíncronamente
        await startRenderFlow(messages, replayBuffer, attachment.name, { skin, resolution, skinSpecified }, locale);
        return;

    } catch (err) {
        // Los errores de cooldown son esperados, no se loguean como error
        if (err.isCooldownError) {
            return `⏳ ${err.message}`;
        }
        console.error("Error en s.render:", err);
        if (err.message && !err.message.includes('Unexpected token') && !err.message.includes('fetch')) {
            return `❌ ${err.message}`;
        }
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
    const userId = message?.author?.id;

    // Verificar cooldown persistente del usuario (1 render cada 5 minutos)
    if (userId) {
        try {
            const lastRenderMs = await OrdrModel.getRenderCooldown(userId);

            if (lastRenderMs) {
                const timePassed = Date.now() - lastRenderMs;
                if (timePassed < RENDER_COOLDOWN_MS) {
                    const cooldownEndSeconds = Math.floor((lastRenderMs + RENDER_COOLDOWN_MS) / 1000);
                    const discordTimestamp = `<t:${cooldownEndSeconds}:R>`;

                    const errMessage = t(locale, 'render.err_cooldown', {
                        time: discordTimestamp
                    });

                    const cooldownErr = new Error(`${message.author.toString()}, ${errMessage}`);
                    cooldownErr.isCooldownError = true;
                    throw cooldownErr;
                }
            }
        } catch (err) {
            // Si es un error de cooldown lanzado por nosotros, re-lanzarlo
            if (err.isCooldownError) {
                throw err;
            }
            // Errores de DB se ignoran para no bloquear el render
            console.warn(`[startRenderFlow] Error al consultar cooldown para ${userId}:`, err.message);
        }
    }

    // Construir parámetros finales de renderizado
    const renderParams = {
        replayBuffer,
        fileName,
        discordUserId: userId,
        locale
    };

    let skinNameForEmbed = 'default';

    // 1. Obtener y mapear el preset del usuario si no especificó parámetros manuales excluyentes
    if (!options.skinSpecified) {
        try {
            const preset = await OrdrModel.getUserPreset(userId);
            if (preset && !preset.isDevSimulated) {
                // Mapear campos estéticos del preset
                renderParams.resolution = preset.resolution || '1280x720';
                
                // Skin
                if (preset.customSkin) {
                    renderParams.skin = preset.customSkin;
                    renderParams.customSkin = true;
                    // Buscar información de la skin custom
                    try {
                        const skinInfo = await OrdrModel.getCustomSkinInfo(preset.customSkin);
                        skinNameForEmbed = skinInfo && skinInfo.skinName ? `Preset (${skinInfo.skinName})` : `Preset (Custom Skin ID: ${preset.customSkin})`;
                    } catch (err) {
                        skinNameForEmbed = `Preset (Custom Skin ID: ${preset.customSkin})`;
                    }
                } else if (preset.skin) {
                    renderParams.skin = preset.skin;
                    renderParams.customSkin = false;
                    skinNameForEmbed = `Preset (${preset.skin})`;
                } else {
                    renderParams.skin = 'default';
                    renderParams.customSkin = false;
                    skinNameForEmbed = 'Preset (default)';
                }

                // Volumen
                if (preset.globalVolume !== undefined) renderParams.globalVolume = preset.globalVolume;
                if (preset.musicVolume !== undefined) renderParams.musicVolume = preset.musicVolume;
                if (preset.hitsoundVolume !== undefined) renderParams.hitsoundVolume = preset.hitsoundVolume;

                // Elementos de la interfaz (HUD)
                if (preset.showHitErrorMeter !== undefined) renderParams.showHitErrorMeter = preset.showHitErrorMeter;
                if (preset.showUnstableRate !== undefined) renderParams.showUnstableRate = preset.showUnstableRate;
                if (preset.showScore !== undefined) renderParams.showScore = preset.showScore;
                if (preset.showHPBar !== undefined) renderParams.showHPBar = preset.showHPBar;
                if (preset.showComboCounter !== undefined) renderParams.showComboCounter = preset.showComboCounter;
                if (preset.showPPCounter !== undefined) renderParams.showPPCounter = preset.showPPCounter;
                if (preset.showKeyOverlay !== undefined) renderParams.showKeyOverlay = preset.showKeyOverlay;
                if (preset.showScoreboard !== undefined) renderParams.showScoreboard = preset.showScoreboard;
                if (preset.showAvatarsOnScoreboard !== undefined) renderParams.showAvatarsOnScoreboard = preset.showAvatarsOnScoreboard;
                if (preset.showBorders !== undefined) renderParams.showBorders = preset.showBorders;
                if (preset.showMods !== undefined) renderParams.showMods = preset.showMods;
                if (preset.showResultScreen !== undefined) renderParams.showResultScreen = preset.showResultScreen;
                if (preset.showHitCounter !== undefined) renderParams.showHitCounter = preset.showHitCounter;
                if (preset.showSliderBreaks !== undefined) renderParams.showSliderBreaks = preset.showSliderBreaks;
                if (preset.showAimErrorMeter !== undefined) renderParams.showAimErrorMeter = preset.showAimErrorMeter;
                if (preset.showStrainGraph !== undefined) renderParams.showStrainGraph = preset.showStrainGraph;

                // Cursor y colores
                if (preset.useSkinCursor !== undefined) renderParams.useSkinCursor = preset.useSkinCursor;
                if (preset.useSkinHitsounds !== undefined) renderParams.useSkinHitsounds = preset.useSkinHitsounds;
                if (preset.playNightcoreSamples !== undefined) renderParams.playNightcoreSamples = preset.playNightcoreSamples;
                if (preset.cursorSize !== undefined) renderParams.cursorSize = preset.cursorSize;
                if (preset.cursorTrail !== undefined) renderParams.cursorTrail = preset.cursorTrail;
                if (preset.drawComboNumbers !== undefined) renderParams.drawComboNumbers = preset.drawComboNumbers;

                if (preset.circleColors === 'beatmap') {
                    renderParams.useBeatmapColors = true;
                    renderParams.useSkinColors = false;
                } else if (preset.circleColors === 'skin') {
                    renderParams.useBeatmapColors = false;
                    renderParams.useSkinColors = true;
                }

                // Storyboard y Video
                if (preset.loadStoryboardVideo !== undefined) {
                    renderParams.loadStoryboard = preset.loadStoryboardVideo;
                    renderParams.loadVideo = preset.loadStoryboardVideo;
                }

                // Dim de fondo
                if (preset.introBGDim !== undefined) renderParams.introBGDim = preset.introBGDim;
                if (preset.inGameBGDim !== undefined) renderParams.inGameBGDim = preset.inGameBGDim;
                if (preset.breakBGDim !== undefined) renderParams.breakBGDim = preset.breakBGDim;

                // Varios
                if (preset.showDanserLogo !== undefined) renderParams.showDanserLogo = preset.showDanserLogo;
                if (preset.ignoreFail !== undefined) renderParams.ignoreFail = preset.ignoreFail;
                if (preset.skip !== undefined) renderParams.skip = preset.skip;
                if (preset.sliderSnakingIn !== undefined) renderParams.sliderSnakingIn = preset.sliderSnakingIn;
                if (preset.sliderSnakingOut !== undefined) renderParams.sliderSnakingOut = preset.sliderSnakingOut;
            } else {
                renderParams.skin = 'default';
                renderParams.resolution = options.resolution || '1280x720';
                skinNameForEmbed = 'default';
            }
        } catch (err) {
            console.warn(`[startRenderFlow] No se pudo obtener o mapear el preset para el usuario ${userId}, usando fallback 'default':`, err.message);
            renderParams.skin = 'default';
            renderParams.resolution = options.resolution || '1280x720';
            skinNameForEmbed = 'default';
        }
    } else {
        // El usuario especificó parámetros manuales en el comando de discord
        renderParams.skin = options.skin;
        renderParams.resolution = options.resolution || '1280x720';
        
        // Si el parámetro de skin es numérico, es una skin custom
        if (/^\d+$/.test(options.skin)) {
            renderParams.customSkin = true;
            try {
                const skinInfo = await OrdrModel.getCustomSkinInfo(options.skin);
                skinNameForEmbed = skinInfo && skinInfo.skinName ? skinInfo.skinName : options.skin;
            } catch (err) {
                skinNameForEmbed = options.skin;
            }
        } else {
            renderParams.customSkin = false;
            skinNameForEmbed = options.skin;
        }
    }

    // Asegurar fallbacks finales
    if (!renderParams.skin) {
        renderParams.skin = 'default';
        renderParams.customSkin = false;
        skinNameForEmbed = 'default';
    }
    if (!renderParams.resolution) {
        renderParams.resolution = '1280x720';
    }

    console.log(`🎨 [Render] Parámetros finales: skin=${renderParams.skin} (customSkin=${renderParams.customSkin}), resolution=${renderParams.resolution}, discordUserId=${userId}`);

    // Enviar solicitud de renderizado a o!rdr
    const renderData = await OrdrModel.requestRender(renderParams);

    // Registrar cooldown del usuario en la base de datos
    if (userId) {
        await OrdrModel.setRenderCooldown(userId);
    }

    const renderId = renderData.renderID;
    const skinDisplay = skinNameForEmbed;
    const resolution = renderParams.resolution;

    // Enviar embed de encolado inicial
    const queueEmbed = doQueueEmbed(message, renderId, { skin: skinDisplay, resolution }, locale);
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
                    { skin: skinDisplay, resolution },
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
                { skin: skinDisplay, resolution },
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
