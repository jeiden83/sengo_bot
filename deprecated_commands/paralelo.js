const puppeteer = require('puppeteer');
const axios = require('axios');
let page;

async function configuracionesPorDefecto(){

    // Minimo de bolivares para los anuncios
    const valor_minimo = '15000';
    await page.type('#C2Csearchamount_searchbox_amount', valor_minimo);

    // Clickear los filtros
    await page.click('div.bn-flex.relative.h-full.w-full.items-center.justify-center');
    console.log("filtros clickeados");
    
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log("esperando por los verificados");
    // Quitamos los verificados
    // await page.waitForSelector('body > div:nth-child(4) > div > div:nth-child(2) > main > div:nth-child(2) > div:nth-child(2) > div > div:nth-child(2) > div:nth-child(1) > div:nth-child(4) > div > div > div:nth-child(2) > div:nth-child(2) > div:nth-child(2) > div:nth-child(2) > div:nth-child(2)');
    // await page.click('body > div:nth-child(4) > div > div:nth-child(2) > main > div:nth-child(2) > div:nth-child(2) > div > div:nth-child(2) > div:nth-child(1) > div:nth-child(4) > div > div > div:nth-child(2) > div:nth-child(2) > div:nth-child(2) > div:nth-child(2) > div:nth-child(2)');
    // await page.waitForSelector('div[role="switch"][aria-label="switch"]');
    // await page.click('div[role="switch"][aria-label="switch"]');
    // const contenedor = await page.waitForSelector('div.bn-flex.items-center.py-s.gap-2.justify-between');
    // const switchBtn = await contenedor.$('div[role="switch"]');
    // await switchBtn.click();

    // Esperar a que haya al menos 2 switches en la página
    await page.waitForFunction(() => {
        return document.querySelectorAll('div[role="switch"][aria-label="switch"]').length >= 2;
    });

    const switches = await page.$$('div[role="switch"][aria-label="switch"]');
    await switches[1].click();
    console.log("verificados deshabilitados");

    await new Promise(resolve => setTimeout(resolve, 500));
    // Aplicamos cambios
    await page.click('button.bn-button__primary');
    console.log("boton aplicar cambios clickeado");

    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log("configuraciones hechas");
}

async function obtenerAnuncios(){

    // // 1. Esperar a que cargue el contenedor principal
    // await page.waitForSelector('main div:nth-child(3) > div > div:nth-child(1)');

    // // 2. Seleccionar todos los bloques de anuncio dentro del contenedor
    // const anuncios = await page.$$('main div:nth-child(3) > div > div:nth-child(1)');

    const padre = await page.waitForSelector('#__APP > div > div.scroll-container.h-full.\\[\\&\\>div\\]\\:flex-shrink-0.\\[\\&\\>footer\\]\\:pt-\\[60px\\].\\[\\&\\>header\\]\\:flex-shrink-0.css-vurnku > main > div.mb-\\[60px\\].tablet\\:mb-\\[96px\\].pc\\:mb-\\[128px\\] > div.container.bg-backgroundBasic.relative > div > div.bn-flex.flex-col');
    
    const total = await padre.$$eval(':scope > div', children => children.length);
    console.log('Total de anuncios encontrados:', total);

    const bloques = await padre.$$('div');
    const resultados = [];
    
    for (const bloque of bloques) {
      const merchantName = await bloque.$eval('a.merchantName-nickname', el => el.innerText.trim());
      const precio = await bloque.$eval('div.headline5.text-primaryText', el => el.innerText.trim());
      const limites = await bloque.$$eval('div.bn-flex.body2 div.flex-wrap > div', elems => elems.map(e => e.innerText.trim()));
      const [minimo, , maximo] = limites;
    
      const metodos = await bloque.$$eval('div.PaymentMethodItem__text', elems =>
        elems.map(e => e.innerText.trim())
      );
    
      const ordYcomp = await bloque.$$eval('span.body3.text-tertiaryText', spans =>
        spans.map(s => s.innerText.trim())
      );
      const numeroOrdenes = ordYcomp[0];
      const porcentajeCompletado = ordYcomp[1];
    
      const porcentajePuntuacion = await bloque.$eval('div.span.caption', el => el.innerText.trim());
      const tiempo = await bloque.$eval('div.bn-tooltips-wrap div', el => el.innerText.trim());
    
      resultados.push({
        merchantName,
        precioAnuncio: precio,
        minimoAnuncio: minimo,
        maximoAnuncio: maximo,
        listaMetodosCompra: metodos,
        numeroOrdenes,
        porcentajeCompletados: porcentajeCompletado,
        porcentajePuntuacion,
        tiempoLiberacionMaximo: tiempo
      });
    }

    return resultados;
}

async function run(messages, args) {
    // const { message } = messages;

    // const CURRENCY = `USDT`;
    // const FIAT = `VES`; // Bolivares venezolanos
    // // const PAYMENT = `all-payments`;
    // const PAYMENT = `PagoMovil`;

    // const URL = `https://p2p.binance.com/trade/sell/${CURRENCY}?fiat=${FIAT}&payment=${PAYMENT}`;

    // // Revisamos si no es Jeiden quien ejecuta el comando
    // if (message.author.id != '395623267530047489') {
    //     return `No puedes hacer esto, solo Jeiden puede.`;
    // }

    // const browser = await puppeteer.launch({ headless: false });
    // page = await browser.newPage();
    // page.setDefaultTimeout(0);

    // await page.goto(URL, {
    //     waitUntil: 'networkidle2'
    // });

    // await configuracionesPorDefecto();
    // const lista_anuncios = await obtenerAnuncios();

    // console.log(lista_anuncios);

    let dolar;
    await axios.get('https://ve.dolarapi.com/v1/dolares/paralelo')
      .then(response => {
        dolar = response.data; 
      });

    return `**Tasa USDT: **\`Bs. ${dolar.promedio}\` por USDT`;
}

run.description = {
    header: undefined,
    body: undefined,
    usage: undefined
  };
  
module.exports = { run }