const fetch = require('node-fetch');
const { parseOSR } = require("../../utils/osr_parser.js");
const { t } = require("../../../utils/i18n.js");
const OrdrModel = require("../../../models/OrdrModel.js");
const { doQueueEmbed, doProgressEmbed, doDoneEmbed, doErrorEmbed } = require("../../../views/ordrEmbeds.js");

async function run(messages, args) {
    const { message, reply } = messages;
    const locale = message.locale || 'es';

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

        // 5. Enviar solicitud de renderizado a o!rdr
        const renderData = await OrdrModel.requestRender({
            replayBuffer,
            fileName: attachment.name,
            skin,
            resolution
        });

        const renderId = renderData.renderID;
        const skinName = renderData.skin || skin;

        // 6. Enviar embed de encolado inicial
        const queueEmbed = doQueueEmbed(message, renderId, { skin: skinName, resolution }, locale);
        const sentMessage = await message.channel.send({ embeds: [queueEmbed] });

        // Variables para control de actualizaciones (throttling) y evitar límites de rate de Discord
        let lastEditTime = Date.now();
        let lastState = '';
        let lastProgress = -1;

        // 7. Iniciar el tracking de progreso en tiempo real mediante WebSockets
        OrdrModel.trackProgress(renderId, {
            onAdded: (data) => {
                console.log(`[o!rdr] Render #${renderId} agregado a la cola.`);
            },
            onProgress: async (data) => {
                const now = Date.now();
                const stateChanged = data.state !== lastState;
                const progressChanged = data.progress !== lastProgress;
                
                // Actualizamos si cambia el estado del renderizador, si cambia el progreso y han pasado más de 2.5s
                if (stateChanged || (progressChanged && (now - lastEditTime > 2500))) {
                    lastState = data.state;
                    lastProgress = data.progress;
                    lastEditTime = now;

                    const progressEmbed = doProgressEmbed(
                        message,
                        renderId,
                        data.progress,
                        data.state,
                        data.description,
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
                    data.description,
                    locale
                );
                
                try {
                    await sentMessage.edit({ content: data.videoUrl, embeds: [embed], components });
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

        // Retornamos undefined para indicarle al despachador que la respuesta se gestiona asíncronamente
        return;

    } catch (err) {
        console.error("Error en s.render:", err);
        return t(locale, 'general.error_unexpected');
    }
}

run.alias = {
    "render": { "args": "" }
};

run.description = {
    'header': t('es', 'commands.render.header'),
    'body': t('es', 'commands.render.body'),
    'usage': t('es', 'commands.render.usage')
};

module.exports = { run, description: run.description };
