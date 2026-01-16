const { AttachmentBuilder, EmbedBuilder, CommandInteraction } = require("discord.js");

function extractData(jsCode) {
    const data = {};

    const verSrMatch = jsCode.match(/VER_SR\s*=\s*"([^"]+)"/);
    if (verSrMatch) data.VER_SR = verSrMatch[1];
    
    const srDatesMatch = jsCode.match(/SR_DATES\s*=\s*(\{[\s\S]*?\n\})/);

    if (srDatesMatch) {
        try {
            const cleanedDates = srDatesMatch[1].replace(/Date\.parse\s*\(([^)]+)\)/g, (match, p1) => {
                const dateString = eval(p1); 
                return `new Date('${dateString}').getTime()`;
            });
            
            // Evaluamos el objeto completo SR_DATES
            const SR_DATES_FUNC = new Function(`return ${cleanedDates.trim()}`);
            const SR_DATES = SR_DATES_FUNC();

            // 3. Creamos dos mapas de búsqueda:
            data.SR_DATES_MAP = {}; 
            data.SR_START_DATES = {}; // Contiene: { 'version siguiente': timestamp de la version siguiente }
            data.SR_NEXT_VERSIONS = []; 

            // Recorremos el SR_DATES original para popular los nuevos mapas
            for (const currentVer in SR_DATES) {
                const [nextVer, nextDateTimestamp] = SR_DATES[currentVer];
                
                // Mapa 1: Para la consulta de fechas de INICIO (siempre es la versión *siguiente* a la clave)
                data.SR_START_DATES[nextVer] = nextDateTimestamp;

                // Mapa 2: Para la consulta 'listar'
                if (!data.SR_NEXT_VERSIONS.includes(nextVer)) {
                    data.SR_NEXT_VERSIONS.push(nextVer);
                }

                // Conservamos el mapa original
                data.SR_DATES_MAP[currentVer] = SR_DATES[currentVer];
            }

        } catch (e) {
            console.error("Error al parsear SR_DATES:", e);
        }
    }

    return data;
}

function formatDiscordDate(timestamp) {
    // Generar el timestamp de Discord (en segundos)
    const discordTimestamp = Math.floor(timestamp / 1000);

    const fullDate = `<t:${discordTimestamp}:F>`;
    const relativeTime = `<t:${discordTimestamp}:R>`;
    
    return {
        discordDate: fullDate, 
        relativeTime: relativeTime
    };
}


async function run(messages, args) {
    const { message } = messages;

    const HOMDGCAT_VERSIONS_JSURL = 'https://homdgcat.wiki/javascripts/ver.js';
    let argument; 

    if(!(messages instanceof CommandInteraction)){
        argument = args[0] ? args[0].toLowerCase() : null;
    }
    
    try {
        const response = await fetch(HOMDGCAT_VERSIONS_JSURL);

        if (!response.ok) {
            return `**Error** \`[${response.status}]\` > No pude obtener la información de las versiones.`;
        }
        
        const data = await response.text();

        // 1. Extraer y crear los mapas de datos
        const { VER_SR, SR_DATES_MAP, SR_START_DATES, SR_NEXT_VERSIONS } = extractData(data);
        
        if (!VER_SR || !SR_DATES_MAP || !SR_START_DATES) {
            return `**Error**: No se pudieron extraer los datos de versión o fechas.`;
        }
        
        // 2. Lógica del comando según el argumento
        
        // SI es un slash
        if(messages instanceof CommandInteraction){

            const nextVersionData = SR_DATES_MAP[VER_SR];
            
            if (!nextVersionData || nextVersionData.length < 2) {
                return `No se encontró información de la versión beta siguiente a la actual **${VER_SR}**.`;
            }
            
            const nextVer = nextVersionData[0];
            const nextDateTimestamp = nextVersionData[1];
            const { discordDate, relativeTime } = formatDiscordDate(nextDateTimestamp);
            
            // Mensaje en el formato solicitado
            return `La versión actual de la beta es **${VER_SR}**. La **siguiente versión** (**${nextVer}**) saldrá en la fecha **${discordDate}**, que será **${relativeTime}**. 🚀`;
        }


        // Opción: 'listar'
        if (argument === 'listar') {
            if (SR_NEXT_VERSIONS.length === 0) {
                return `No se encontraron versiones siguientes para listar.`;
            }
            // Eliminamos duplicados y preparamos la lista con sus fechas
            const uniqueVersions = [...new Set(SR_NEXT_VERSIONS)];
            
            let list = '**Versiones de Star Rail con fecha de inicio:**\n';
            list += '```\n';
            
            // Creamos una lista más informativa (Versión -> Fecha de inicio)
            for (const ver of uniqueVersions) {
                const timestamp = SR_START_DATES[ver];
                // Usamos el formato de fecha corta de Discord para listar
                const shortDiscordDate = `<t:${Math.floor(timestamp / 1000)}:d>`;
                list += `${ver.padEnd(7)} -> ${shortDiscordDate}\n`;
            }
            
            list += '```\nUsa `!comando [versión]` para ver el conteo regresivo. (El tiempo relativo es la mejor opción para esto).';
            return list;
        } 
        
        // Opción: Versión específica (ej. '3.7v2')
        else if (argument && SR_START_DATES[argument]) {
            const nextDateTimestamp = SR_START_DATES[argument];
            const { discordDate, relativeTime } = formatDiscordDate(nextDateTimestamp);
            
            // Mensaje en el formato solicitado
            return `La versión **${argument}** saldrá en la fecha **${discordDate}**, que será **${relativeTime}**. 🗓️`;
        }
        
        // Opción: Sin argumento (Mostrar la siguiente versión a la actual)
        else if (!argument) {
            const nextVersionData = SR_DATES_MAP[VER_SR];
            
            if (!nextVersionData || nextVersionData.length < 2) {
                return `No se encontró información de la versión siguiente a la actual **${VER_SR}**.`;
            }
            
            const nextVer = nextVersionData[0];
            const nextDateTimestamp = nextVersionData[1];
            const { discordDate, relativeTime } = formatDiscordDate(nextDateTimestamp);
            
            // Mensaje en el formato solicitado
            return `La versión beta actual es **${VER_SR}**. La **siguiente versión** (**${nextVer}**) saldrá en la fecha **${discordDate}**, que será **${relativeTime}**. 🚀`;
        }
        
        // Opción: Argumento no reconocido (versión que no existe o error de formato)
        else {
            return `Argumento no válido: **${argument}**. Usa: \`!comando\` (siguiente versión), \`!comando listar\` (ver todas las versiones) o \`!comando [versión]\` (ver fecha de una versión específica).`;
        }

    } catch (e) {
        console.error(e);
        return `**Error** > Ocurrió un problema al procesar los datos: \`${e.message}\`.`;
    }
}

run.description = 
{
    'header' : 'Para ver las fechas de las versiones Beta de Star Rail (SR)',
    'body' : 'Sin argumentos: Muestra la **siguiente versión** de SR y su fecha de inicio en formato de Discord (hora completa y tiempo relativo).\nArgumento `listar`: Muestra todas las versiones futuras listadas y sus fechas cortas.\nArgumento `[versión]`: Muestra la fecha de **inicio** de esa versión específica (ej. `3.8v1`) con el conteo regresivo de Discord.',
    'usage' : '`s.hsr`, `s.hsr listar`, `s.hsr 3.8v1`'
}
module.exports = { run };