const axios = require('axios');

async function run(messages, args) {
    const { message } = messages;

    const argumentosCurrency = {
        "dolar" : "dollar",
        "-dolar" : "dollar",
        "euro" : "euro",
        "-euro" : "euro",
        "-bcv" : "dollar"
    }

    const argumentosTipocambio = {
        "-binance" : "binance",
        "binance" : "binance",
        "-usdt" : "binance",
        "usdt" : "binance"
    }

    const tipoCambio = argumentosTipocambio[args[0]] || "bcv";
    const currency = argumentosCurrency[args[0]] || "dollar"

    try {

        const apiReq = `https://pydolarve.org/api/v2/${currency == 'euro' ? 'tipo-cambio?currency=eur' : `dollar?page=${tipoCambio == "binance" ? 'binance&monitor=binance' : 'bcv&monitor=usd'}`}`;
        const moneda = (await axios.get(apiReq)).data;

        const respuesta = `**Tasa de ${tipoCambio.toUpperCase()}: **\`Bs. ${moneda.price}\` por *${moneda.title}* \n- **Ultima fecha**: \`${moneda.last_update}\` \n- **Cambio** de \`${moneda.change}\` :${moneda.color == "neutral" ? "white_large" : moneda.color }_square: \`Bs. ${moneda.price_old}\` por *${moneda.title}*`;

        return respuesta;

    } catch (error) {

        console.error('Error al obtener la tasa de cambio:', error);
        return 'Ocurrió un error al obtener la tasa de cambio.';
    }
}

run.alias = {
    "usdt" : {
        "args" : "-binance"
    },
    "binance" : {
        "args" : "-binance"
    },
    "euro" : {
        "args" : "-euro"
    },
    "dolar" : {
        "args" : ""
    }
}

run.description = {
    header: 'Consulta la tasa oficial del dólar según el mecanismo a usar',
    body: undefined,
    usage: `s.bcv || s.dolar: Muestra la tasa del USD BCV.\ns.usdt || s.binance: Muestra la tasa del BINANCE USDT.\ns.euro: Muestra la tasa del EUR BCV`
};

module.exports = { run };
