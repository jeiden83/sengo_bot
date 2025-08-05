const axios = require('axios');

async function run(messages, args) {
    const { message } = messages;

    const dolarBCV = (await axios.get('https://pydolarve.org/api/v2/dollar?page=bcv&monitor=usd')).data;
    const dolarUSDT = (await axios.get('https://pydolarve.org/api/v2/dollar?page=binance&monitor=binance')).data;

    return `**La brecha es de: **\`${(dolarUSDT.price - dolarBCV.price).toFixed(2)}\` \n- **BCV:** \`Bs. ${dolarBCV.price}\`\n- **USDT:** \`Bs. ${dolarUSDT.price}\``;
}

run.description = {
    header: 'Brecha',
    body: undefined,
    usage: undefined
};

module.exports = { run };