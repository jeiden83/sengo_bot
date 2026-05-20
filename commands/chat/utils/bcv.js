const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

async function run(messages, args) {
    const { message } = messages;

    // Soporta dolar (default), euro, yuan, lira, rublo según el sitio del BCV
    let moneda = (args[0] || 'dolar').toLowerCase();

    // Normalizar nombres comunes
    if (moneda === 'usd') moneda = 'dolar';
    if (moneda === 'eur') moneda = 'euro';
    if (moneda === 'cny') moneda = 'yuan';
    if (moneda === 'try') moneda = 'lira';
    if (moneda === 'rub') moneda = 'rublo';

    const validMonedas = ['dolar', 'euro', 'yuan', 'lira', 'rublo'];
    if (!validMonedas.includes(moneda)) {
        return `Moneda \`${moneda}\` no soportada. Opciones válidas: \`dolar\`, \`euro\`, \`yuan\`, \`lira\`, \`rublo\`.`;
    }

    try {
        const agent = new https.Agent({ rejectUnauthorized: false });
        const { data } = await axios.get('https://www.bcv.org.ve/', { 
            httpsAgent: agent, 
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const $ = cheerio.load(data);

        const valorElemento = $(`#${moneda} strong`);
        
        if (!valorElemento.length) {
            return `No se pudo encontrar la tasa para la moneda \`${moneda}\` en el sitio del BCV.`;
        }

        const valor = valorElemento.text().trim();
        const fechaAttr = $('span.date-display-single').attr('content');
        const fecha = fechaAttr ? new Date(fechaAttr) : new Date();

        const nombresMonedas = {
            'dolar': 'USD 🇺🇸',
            'euro': 'EUR 🇪🇺',
            'yuan': 'CNY 🇨🇳',
            'lira': 'TRY 🇹🇷',
            'rublo': 'RUB 🇷🇺'
        };

        const respuesta = `**Tasa Oficial del BCV: **\`Bs. ${valor}\` por *${nombresMonedas[moneda]}*\n- **Fecha valor**: \`${fecha.toLocaleDateString('es-VE')}\``;
        
        return respuesta;

    } catch (error) {
        console.error('❌ Error BCV:', error.message);
        return `Ocurrió un error al obtener la tasa de cambio desde el BCV: ${error.message}`;
    }
}

run.alias = {
    "dolar" : {
        "args" : ""
    },
    "euro" : {
        "args" : "euro"
    }
}

run.description = {
    header: 'Consulta la tasa oficial del dólar según el Banco Central de Venezuela (BCV)',
    body: undefined,
    usage: `s.bcv || s.dolar: Muestra la tasa del USD BCV.`
};

module.exports = { run };
