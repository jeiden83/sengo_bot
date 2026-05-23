const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

async function run(messages, args) {
    const { message } = messages;

    try {
        // 1. Obtener la tasa oficial del BCV
        const agent = new https.Agent({ rejectUnauthorized: false });
        const { data: bcvHtml } = await axios.get('https://www.bcv.org.ve/', { 
            httpsAgent: agent, 
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const $ = cheerio.load(bcvHtml);
        const valorElemento = $('#dolar strong');
        
        if (!valorElemento.length) {
            return '❌ No se pudo encontrar la tasa del Dólar en el sitio del BCV.';
        }

        const bcvPriceStr = valorElemento.text().trim();
        const bcvPrice = parseFloat(bcvPriceStr.replace(',', '.'));

        // 2. Obtener la tasa de Binance P2P (Promedio de las 3 mejores tasas de venta)
        const resSearch = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
            asset: 'USDT',
            fiat: 'VES',
            tradeType: 'SELL',
            page: 1,
            rows: 20,
            payTypes: [],
            transAmount: '500000',
            publisherType: null,
            merchantCheck: false
        }, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 8000
        });

        const ads = (resSearch.data && resSearch.data.data) || [];
        if (ads.length === 0) {
            return '❌ No se encontraron anuncios en Binance P2P para calcular la tasa de USDT.';
        }

        const filtered = ads.filter(item => item.adv.isTradable !== false);
        const topAds = filtered.slice(0, 3);
        if (topAds.length === 0) {
            return '❌ No se encontraron anuncios válidos en Binance P2P para calcular la tasa de USDT.';
        }

        let sum = 0;
        topAds.forEach(item => {
            sum += parseFloat(item.adv.price);
        });
        const binancePrice = sum / topAds.length;

        // 3. Calcular la brecha
        const brecha = binancePrice - bcvPrice;

        const formatVE = (val) => val.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        return `**La brecha es de: **\`Bs. ${formatVE(brecha)}\` \n- **BCV:** \`Bs. ${formatVE(bcvPrice)}\`\n- **USDT:** \`Bs. ${formatVE(binancePrice)}\``;

    } catch (error) {
        console.error('❌ Error al calcular la brecha:', error.message);
        return `Ocurrió un error al obtener las tasas de cambio: ${error.message}`;
    }
}

run.description = {
    header: 'Calcula la brecha cambiaria en Venezuela',
    body: 'Compara la tasa oficial del Dólar estadounidense del Banco Central de Venezuela (BCV) con el promedio del mercado de Binance P2P (USDT/VES) para mostrar la diferencia en bolívares.',
    usage: 's.brecha'
};

module.exports = { run };