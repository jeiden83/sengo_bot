const sharp = require('sharp');
const path = require('path');
const { t } = require('../../../utils/i18n.js');

const globoPath = path.join(__dirname, '../../../src/globo.png');
const MAX_WIDTH = 800;

async function run(messages, args) {
  const { message, reply } = messages;
  const locale = message.locale || 'es';

  // Buscar mensaje citado si existe referencia y no vino en messages.reply
  let replyMsg = reply;
  if (!replyMsg && message.reference?.messageId && message.channel?.messages?.fetch) {
    try {
      replyMsg = await message.channel.messages.fetch(message.reference.messageId);
    } catch {}
  }

  // Buscar imagen en adjuntos del mensaje o del reply, embeds o argumentos
  const attachment = message.attachments?.first() || replyMsg?.attachments?.first();
  const imageUrl = attachment?.url
    || message.embeds?.[0]?.image?.url || message.embeds?.[0]?.thumbnail?.url
    || replyMsg?.embeds?.[0]?.image?.url || replyMsg?.embeds?.[0]?.thumbnail?.url
    || (args?.[0] && /^https?:\/\//i.test(args[0]) ? args[0] : null);

  if (!imageUrl) return t(locale, 'globo.attach_image');

  let normalizedBase;
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return t(locale, 'globo.attach_image');
    const baseImgBuffer = Buffer.from(await res.arrayBuffer());

    // ponytail: normalizar rotación EXIF y acotar a MAX_WIDTH para prevenir OOM en Render (512MB RAM) y descartar canvas/gifencoder
    normalizedBase = await sharp(baseImgBuffer)
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .toBuffer();
  } catch (err) {
    console.error('Error al cargar la imagen para globo:', err);
    return t(locale, 'globo.attach_image');
  }

  try {
    const meta = await sharp(normalizedBase).metadata();
    const globoMeta = await sharp(globoPath).metadata();
    const globoHeight = Math.round((globoMeta.height / globoMeta.width) * meta.width);

    const resizedGlobo = await sharp(globoPath)
      .resize({ width: meta.width, height: globoHeight, fit: 'fill' })
      .toBuffer();

    const resultBuffer = await sharp(normalizedBase)
      .extend({
        top: globoHeight,
        bottom: 0,
        left: 0,
        right: 0,
        background: { r: 255, g: 255, b: 255, alpha: 0 }
      })
      .composite([{ input: resizedGlobo, top: 0, left: 0 }])
      .gif()
      .toBuffer();

    await message.channel.send({
      files: [{ attachment: resultBuffer, name: 'globo.gif' }]
    });
  } catch (err) {
    console.error('Error al procesar el globo:', err);
    return t(locale, 'globo.attach_image');
  }

  return null;
}

run.alias = {
  "globodesexo": { "args": "" }
};

run.description = {
  header: t('es', 'commands.globo.header'),
  body: t('es', 'commands.globo.body'),
  usage: t('es', 'commands.globo.usage')
};

module.exports = { run };
