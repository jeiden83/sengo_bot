const axios = require('axios');
const { EmbedBuilder } = require('discord.js');

function cleanString(str) {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formatCurrency(val, fiat) {
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    let symbol = '';
    if (fiat === 'VES') symbol = 'Bs. ';
    else if (fiat === 'USD') symbol = '$';
    else if (fiat === 'COP') symbol = 'COP$ ';
    else symbol = `${fiat} `;
    return `${symbol}${num.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function run(messages, args) {
    const { message } = messages;

    let tradeType = 'SELL';
    let crypto = 'USDT';
    let fiat = 'VES';
    let amount = '500000';
    let methodsRaw = null;
    let verifiedFilter = 'all'; // 'all', 'verified', 'unverified'
    let sendEmbed = false;

    // Parsear flags y argumentos
    for (let i = 0; i < args.length; i++) {
        if (!args[i] || typeof args[i] !== 'string') continue;
        const arg = args[i].toLowerCase();
        if (arg === '-buy') {
            tradeType = 'BUY';
        } else if (arg === '-sell') {
            tradeType = 'SELL';
        } else if (arg === '-cripto' || arg === '-crypto') {
            if (i + 1 < args.length && args[i + 1] && typeof args[i + 1] === 'string') {
                crypto = args[i + 1].toUpperCase();
                i++;
            }
        } else if (arg === '-fiat') {
            if (i + 1 < args.length && args[i + 1] && typeof args[i + 1] === 'string') {
                fiat = args[i + 1].toUpperCase();
                i++;
            }
        } else if (arg === '-amount') {
            if (i + 1 < args.length && args[i + 1]) {
                amount = String(args[i + 1]);
                i++;
            }
        } else if (arg === '-methods') {
            if (i + 1 < args.length) {
                let tempMethods = [];
                let j = i + 1;
                while (j < args.length && args[j] && typeof args[j] === 'string' && !args[j].startsWith('-')) {
                    tempMethods.push(args[j]);
                    j++;
                }
                methodsRaw = tempMethods.join(' ');
                i = j - 1;
            }
        } else if (arg === '-verified') {
            verifiedFilter = 'verified';
        } else if (arg === '-unverified' || arg === '-nonverified') {
            verifiedFilter = 'unverified';
        } else if (arg === '-d') {
            sendEmbed = true;
        }
    }

    // Resolver tipos de pago (payTypes)
    const payTypes = [];
    const matchedNames = [];
    if (methodsRaw) {
        const userMethods = methodsRaw.split(',').map(m => m.trim()).filter(m => m.length > 0);
        try {
            const methodsUrl = `https://www.binance.com/bapi/c2c/v1/public/c2c/agent/trade-methods?fiat=${fiat}`;
            const resMethods = await axios.get(methodsUrl);
            if (resMethods.data && resMethods.data.data) {
                const available = resMethods.data.data;
                for (const userM of userMethods) {
                    const cleanedUser = cleanString(userM);
                    const match = available.find(item => {
                        const cleanedId = cleanString(item.identifier || '');
                        const cleanedName = cleanString(item.tradeMethodName || '');
                        const cleanedShort = cleanString(item.tradeMethodShortName || '');
                        return cleanedId.includes(cleanedUser) || cleanedName.includes(cleanedUser) || cleanedShort.includes(cleanedUser);
                    });
                    if (match) {
                        payTypes.push(match.identifier);
                        matchedNames.push(match.tradeMethodName);
                    }
                }
            }
        } catch (err) {
            console.error('Error fetching trade methods:', err.message);
        }
    }

    try {
        const resSearch = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
            asset: crypto,
            fiat: fiat,
            tradeType: tradeType,
            page: 1,
            rows: 20,
            payTypes: payTypes,
            transAmount: amount,
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
            return `❌ No se encontraron anuncios en Binance P2P que coincidan con la búsqueda para \`${crypto}/${fiat}\`.`;
        }

        // Filtrar anuncios según verificación
        let filtered = ads.filter(item => {
            const isVerified = item.advertiser.userType === 'merchant' || item.advertiser.userType === 'pro_merchant';
            const isTradable = item.adv.isTradable !== false;
            if (!isTradable) return false;

            if (verifiedFilter === 'verified') {
                return isVerified;
            } else if (verifiedFilter === 'unverified') {
                return !isVerified;
            }
            return true; // 'all'
        });

        let usedFallback = false;
        if (filtered.length === 0) {
            // Fallback a los verificados / todos los disponibles si no hay coincidencias
            filtered = ads.filter(item => item.adv.isTradable !== false);
            usedFallback = true;
        }

        // Obtener los 3 anuncios más altos / mejores (la API ya los entrega ordenados)
        const topAds = filtered.slice(0, 3);
        if (topAds.length === 0) {
            return `❌ No se encontraron anuncios que coincidan con los filtros aplicados.`;
        }

        // Calcular promedio
        let sum = 0;
        topAds.forEach(item => {
            sum += parseFloat(item.adv.price);
        });
        const average = sum / topAds.length;

        // Crear Embed
        const roleColor = message.member?.roles?.highest?.color || '#F0B90B';
        const embed = new EmbedBuilder()
            .setAuthor({
                name: `Binance P2P — Tasa Promedio`,
                iconURL: 'https://jeiden.s-ul.eu/3ssHl9Gd'
            })
            .setColor(roleColor)
            .setThumbnail('https://jeiden.s-ul.eu/3ssHl9Gd')
            .setDescription(`Tasa promedio obtenida a partir de los mejores anuncios elegibles.`)
            .addFields(
                {
                    name: '📈 Promedio Calculado',
                    value: `\`\`\`ansi\n[1;33m${formatCurrency(average, fiat)}[0m por [1;32m${crypto}[0m\n\`\`\``,
                    inline: false
                },
                {
                    name: '⚙️ Filtros Aplicados',
                    value: [
                        `• **Operación:** ${tradeType === 'BUY' ? 'Compra 🟢' : 'Venta 🔴'}`,
                        `• **Par:** \`${crypto}/${fiat}\``,
                        `• **Monto de Referencia:** \`${formatCurrency(amount, fiat)}\``,
                        `• **Métodos de pago:** \`${matchedNames.length > 0 ? matchedNames.join(', ') : 'Todos'}\``,
                        `• **Filtrado:** \`${verifiedFilter === 'verified' ? 'Solo Verificados' : (verifiedFilter === 'unverified' ? 'Solo No Verificados' : 'Todos (Verificados y No Verificados)')}\`${usedFallback ? ' *(Fallback a todos los anuncios debido a pocos resultados)*' : ''}`
                    ].join('\n'),
                    inline: false
                }
            );



        embed.setFooter({
            text: `SengoBot • Solicitado por ${message.author.username}`,
            iconURL: message.author.displayAvatarURL({ dynamic: true, size: 512 })
        }).setTimestamp();

        if (sendEmbed) {
            return { embeds: [embed] };
        } else {
            return `**Tasa Binance P2P (Promedio):** \`${formatCurrency(average, fiat)}\` por *${crypto}* (${tradeType === 'BUY' ? 'Compra 🟢' : 'Venta 🔴'})\n- **Filtros**: Monto: \`${formatCurrency(amount, fiat)}\` | Pago: \`${matchedNames.length > 0 ? matchedNames.join(', ') : 'Todos'}\` | \`${verifiedFilter === 'verified' ? 'Solo Verificados' : (verifiedFilter === 'unverified' ? 'Solo No Verificados' : 'Verificados y No Verificados')}\`${usedFallback ? ' *(Fallback a todos los anuncios)*' : ''}`;
        }

    } catch (error) {
        console.error('❌ Error Binance P2P:', error.message);
        return `Ocurrió un error al obtener las tasas de Binance P2P: ${error.message}`;
    }
}

run.alias = {
    'p2p': {
        'args': ''
    },
    'usdt': {
        'args': ''
    }
};

run.description = {
    header: 'Consulta el promedio de la tasa P2P en Binance con filtros personalizados',
    body: 'Muestra el precio promedio del mercado P2P calculado en base a los 3 anuncios más competitivos (incluyendo verificados y no verificados por defecto).\n\n**Opciones / Flags:**\n- `-buy` / `-sell` : Especifica compra o venta (Default: Venta).\n- `-cripto [siglas]` : Criptomoneda a consultar (Ej: USDT, BTC, ETH). Default: USDT.\n- `-fiat [siglas]` : Moneda local a consultar (Ej: VES, COP, USD). Default: VES.\n- `-amount [monto]` : Filtrar anuncios por límites del monto (Default: 500000).\n- `-methods [bancos]` : Filtrar por métodos de pago separados por comas (Ej: pago movil, banesco).\n- `-verified` : Filtrar solo anunciantes verificados.\n- `-unverified` : Filtrar solo anunciantes no verificados.\n- `-d` : Mostrar la información detallada en un Discord Embed en lugar de texto plano.',
    usage: 's.binance\ns.binance -sell -amount 250000\ns.binance -cripto BTC -methods banesco, pago movil\ns.binance -fiat COP -amount 100000'
};

module.exports = { run };
