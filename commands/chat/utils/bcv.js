const axios = require('axios');

async function run(messages, args) {
    const { message } = messages;

    try {
        const response = await axios.get('https://pydolarve.org/api/v2/tipo-cambio');

        const data = response.data;
        const tasaBCV = data.monitors.usd.price;
        const fecha = data.monitors.usd.last_update;

        const respuesta = `**Tasa oficial del BCV: **\`Bs. ${tasaBCV}\` por USD \n- **Ultima fecha**: \`${fecha}\``;

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
