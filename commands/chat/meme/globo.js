const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');
const GIFEncoder = require('gifencoder');
const { t } = require('../../../utils/i18n.js');

const globoPath = path.join(__dirname, '../../../src/globo.png');

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

  let baseImg;
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return t(locale, 'globo.attach_image');
    const baseImgBuffer = Buffer.from(await res.arrayBuffer());
    baseImg = await loadImage(baseImgBuffer);
  } catch (err) {
    console.error('Error al cargar la imagen para globo:', err);
    return t(locale, 'globo.attach_image');
  }

  const globoBuffer = fs.readFileSync(globoPath);
  const globo = await loadImage(globoBuffer);

  // Escalar el globo al mismo ancho que la imagen base
  const canvasWidth = baseImg.width;
  const globoHeight = (globo.height / globo.width) * canvasWidth;
  const canvasHeight = globoHeight + baseImg.height;

  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');

  // Dibuja el globo en la parte superior
  ctx.drawImage(globo, 0, 0, canvasWidth, globoHeight);

  // Dibuja la imagen base debajo del globo
  ctx.drawImage(baseImg, 0, globoHeight, baseImg.width, baseImg.height);

  // Generar GIF estático
  const encoder = new GIFEncoder(canvas.width, canvas.height);
  const gifPath = path.join(__dirname, `globo_result_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.gif`);
  const stream = fs.createWriteStream(gifPath);

  encoder.createReadStream().pipe(stream);
  encoder.start();
  encoder.setRepeat(0);
  encoder.setDelay(500);
  encoder.setQuality(10);
  encoder.addFrame(ctx);
  encoder.finish();

  await new Promise(resolve => stream.on('finish', resolve));

  try {
    await message.channel.send({
      files: [gifPath]
    });
  } finally {
    fs.unlink(gifPath, (err) => {
      if (err) console.error('Error al borrar el GIF:', err);
    });
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
