const { createCanvas, loadImage } = require('canvas');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const GIFEncoder = require('gifencoder');

const globoPath = path.join(__dirname, '../../../src/globo.png');

async function run(messages, args) {
  const { message } = messages;
  const attachment = message.attachments.first();

  if (!attachment) return `Ok pero adjunta una imagen`;

  const imageUrl = attachment.url;
  const baseImgBuffer = await (await fetch(imageUrl)).buffer();
  const globoBuffer = fs.readFileSync(globoPath);

  const baseImg = await loadImage(baseImgBuffer);
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
  const gifPath = path.join(__dirname, 'globo_result.gif');
  const stream = fs.createWriteStream(gifPath);

  encoder.createReadStream().pipe(stream);
  encoder.start();
  encoder.setRepeat(0);
  encoder.setDelay(500);
  encoder.setQuality(10);
  encoder.addFrame(ctx);
  encoder.finish();

  await new Promise(resolve => stream.on('finish', resolve));

  await message.channel.send({
    files: [gifPath]
  });

  fs.unlink(gifPath, (err) => {
    if (err) console.error('Error al borrar el GIF:', err);
  });

  return null;
}

run.alias = {
  "globodesexo": { "args": "" }
};

run.description = {
  header: 'Genera imagen con globo',
  body: undefined,
  usage: undefined
};

module.exports = { run };
