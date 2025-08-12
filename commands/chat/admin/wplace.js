
const axios = require('axios');
const cheerio = require('cheerio');

async function run(messages, args) {
    const { message, res } = messages;

    return `**Activo** \n> (Mentira. La API para el status se cayo asi que deshabilite el comando).`

    // En minutos, sino cada 5 minutos
    const tiempo_espera = parseInt(args[0])*1000*60 || 1000*60*5;

    // De forma asincrona 
    revisar_status(1);
    message.reply(`**Revisando** si el wplace esta activo cada \`${tiempo_espera / 60000} minutos.\``);
    console.log("Revisando");

    async function revisar_status(intento){

        try {
            console.log(`[${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}] > Wplace revisando para usuario "${message.author.username}": ${intento} intento(s). Revisando cada ${tiempo_espera / 60000} minutos...`);

            const response = await axios.get(`https://wplacestatus.sobakintech.xyz/api/badge/15/status`);
            const svgContent = response.data;
    
            // Cargar el contenido SVG con cheerio
            const $ = cheerio.load(svgContent);
    
            // Extraer el valor del atributo aria-label
            const status = $('svg').attr('aria-label');
    
            if(!status.includes('Down')) {
                
                console.log('El wplace está activo:', status);

                // Responder al mensaje que ejecutó el comando
                message.reply(`El wplace está activo: ${status}`);
                return;
            }
    
            // Si el wplace está inactivo, esperamos 60 segundos antes de volver a revisar
            await new Promise(resolve => setTimeout(resolve, tiempo_espera));
            revisar_status(intento + 1);

    
        } catch (error) {
    
            console.error('Error al obtener el estado del canal:', error);
            console.log('No se pudo obtener el estado del canal.');
        }
    }
}

run.description = 
{
    'header' : 'wplace',
    'body' : undefined,
    'usage' : undefined
}

module.exports = { run }