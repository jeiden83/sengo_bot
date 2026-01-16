const axios = require('axios');
const { Currency } = require('tatsu');

async function run(messages, args) {
    const { message } = messages;

    try {

        const apiReq = `https://bronya-ts.onrender.com/api/bcv?tasa=${args[0] ?? 'dolar'}`;
        const moneda = (await axios.get(apiReq)).data;

        const respuesta = `**Tasa de ${moneda.origen.toUpperCase()}: **\`Bs. ${new Number(moneda.value.replace(',', '.')).toFixed(2)}\` por *${moneda.moneda.toUpperCase()}* \n- **Fecha valor**: \`${new Date(moneda.date).toLocaleDateString()}\``
        
        return respuesta;

    } catch (error) {

        console.error('Error al obtener la tasa de cambio:', error);
        return 'Ocurrió un error al obtener la tasa de cambio.';
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
    header: 'Consulta la tasa oficial del dólar según el mecanismo a usar',
    body: undefined,
    usage: `s.bcv || s.dolar: Muestra la tasa del USD BCV.`
};

module.exports = { run };
