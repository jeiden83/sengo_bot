const axios = require('axios');

async function run(messages, args) {
    const { message } = messages;

    const esEuro = args[0] == "-euro" ? true : false;

    try {
        const response = await axios.get('https://pydolarve.org/api/v2/tipo-cambio');

        const data = response.data;
        const moneda = esEuro ? data.monitors.eur : data.monitors.usd;
        const tasaActual = moneda.price; 
        const tasaVieja = moneda.price_old;
        const fecha = moneda.last_update;
        const colorCambio = moneda.color == "green" ? `:green_square:` : `:red_square:`;
        const razonCambio = moneda.change;

        const respuesta = `**Tasa oficial del BCV: **\`Bs. ${tasaActual}\` por ${esEuro ? "EUR" : "USD"} \n- **Ultima fecha**: \`${fecha}\` \n- **Cambio** de \`${razonCambio}\` ${colorCambio} \`Bs. ${tasaVieja}\` por ${esEuro ? "EUR" : "USD"} `;

        return respuesta;
    } catch (error) {

        console.error('Error al obtener la tasa de cambio:', error);
        return 'Ocurrió un error al obtener la tasa de cambio.';
    }
}

run.description = {
    header: 'Consulta la tasa oficial del dólar según el BCV',
    body: undefined,
    usage: undefined
};

module.exports = { run };
