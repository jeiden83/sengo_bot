const { EmbedBuilder } = require('discord.js');
const PopulationService = require('../../../services/populationService.js');
const CONFIG = require('../../../config.js');

async function run({ message, res, reply, logger }, args) {
    const arg1 = args[0] ? args[0].toLowerCase() : null;
    const ownerId = process.env.OWNER_ID || CONFIG.ownerId || CONFIG.OWNER_ID;

    // ----------------------------------------------------
    // 1. SUBCOMANDO: -lista / -l (Listar estado de países)
    // ----------------------------------------------------
    if (arg1 === '-lista' || arg1 === '-l' || arg1 === 'lista') {
        const list = await PopulationService.getCountryStatusList();

        const completed = list.filter(c => c.status === 'COMPLETED');
        const processing = list.filter(c => c.status === 'PROCESSING');
        const available = list.filter(c => c.status === 'AVAILABLE');
        const locked = list.filter(c => c.status === 'LOCKED');
        const noSupporter = list.filter(c => c.status === 'NO_SUPPORTER');

        const embed = new EmbedBuilder()
            .setTitle('🌍 Estado Global de Poblamiento de Países')
            .setColor(CONFIG.colors?.primary || 0x3498db)
            .setDescription('Consulta el estado de poblamiento de snipes por país en la base de datos `sengo-db`.\n\nPara colaborar poblando un país disponible, ejecuta: `s.populate <PAÍS>`')
            .addFields(
                {
                    name: '🟢 Poblados al 100%',
                    value: completed.length > 0 ? completed.map(c => `• **${c.code}** (Completado)`).join('\n') : '*Ninguno por ahora*'
                },
                {
                    name: '🟡 En Proceso Activo',
                    value: processing.length > 0 ? processing.map(c => `• **${c.code}** (${c.workersCount} colaborador(es) activo(s))`).join('\n') : '*Ningún país en proceso actualmente*'
                },
                {
                    name: '🔵 Habilitados y Disponibles (Supporter en Pool)',
                    value: available.length > 0 ? available.map(c => `• **${c.code}** *(Supporter: ${c.supporterUser})*`).join('\n') : '*Sin países habilitados pendientes*'
                },
                {
                    name: '🔒 Bloqueados por Administrador (Requieren s.populate -permitir)',
                    value: locked.length > 0 ? locked.map(c => `**${c.code}**`).join(', ') : '*Ningún país bloqueado*'
                },
                {
                    name: '⚪ No Disponibles (Sin Supporter)',
                    value: noSupporter.length > 0 ? noSupporter.map(c => `**${c.code}**`).join(', ') : '*Todos los países tienen supporter*'
                }
            )
            .setFooter({ text: 'SengoBot • Poblamiento Distribuido' })
            .setTimestamp();

        return { embeds: [embed] };
    }

    // ----------------------------------------------------
    // 2. SUBCOMANDO: -permitir / -allow (Permitir país - Owner)
    // ----------------------------------------------------
    if (arg1 === '-permitir' || arg1 === '-allow' || arg1 === 'permitir' || arg1 === 'allow') {
        if (message.author.id !== ownerId) {
            return '❌ Este comando de habilitación es exclusivo del propietario del bot.';
        }

        const targetCountry = args[1] ? args[1].toUpperCase() : null;
        if (!targetCountry || targetCountry.length !== 2) {
            return '⚠️ Debes especificar el código de país de 2 letras. Ejemplo: `s.populate -permitir MX`';
        }

        PopulationService.allowCountry(targetCountry);
        return `✅ **PERMISO OTORGADO**: El poblamiento de **${targetCountry}** ha sido habilitado por el Administrador. Los colaboradores ya pueden usar \`s.populate ${targetCountry}\`.`;
    }

    // ----------------------------------------------------
    // 3. SUBCOMANDO: -stop / -parar (Kill Switch del Owner)
    // ----------------------------------------------------
    if (arg1 === '-stop' || arg1 === '-parar' || arg1 === 'stop' || arg1 === 'parar') {
        if (message.author.id !== ownerId) {
            return '❌ Este comando de detención es exclusivo del propietario del bot.';
        }

        const targetCountry = args[1] ? args[1].toUpperCase() : null;
        if (!targetCountry || targetCountry.length !== 2) {
            return '⚠️ Debes especificar el código de país a detener. Ejemplo: `s.populate -stop MX`';
        }

        PopulationService.stopCountry(targetCountry);
        return `🛑 **POBLAMIENTO INHABILITADO**: El poblamiento de **${targetCountry}** ha sido detenido y su acceso bloqueado hasta que ejecutes \`s.populate -permitir ${targetCountry}\`.`;
    }

    // ----------------------------------------------------
    // 4. SUBCOMANDO: <PAÍS> (Iniciar poblamiento para un país)
    // ----------------------------------------------------
    if (arg1 && arg1.length === 2) {
        const countryCode = arg1.toUpperCase();

        // Intentar crear la sesión de trabajo
        const session = await PopulationService.createWorkerSession(message.author.id, message.author.username, countryCode);

        if (session.error === 'NOT_ALLOWED') {
            return session.message;
        }

        if (session.error === 'COMPLETED') {
            return `ℹ️ **${countryCode}** ya ha sido poblado al 100% en la base de datos. No hay mapas pendientes.`;
        }

        if (session.error === 'NO_SUPPORTER') {
            return `❌ No se puede iniciar el poblamiento de **${countryCode}**: No hay ningún token Supporter activo de ese país registrado en el pool del bot.`;
        }

        // Enviar mensaje al DM del colaborador
        try {
            const dmEmbed = new EmbedBuilder()
                .setTitle(`🎮 Poblamiento Distribuido - ${countryCode}`)
                .setColor(0x2ecc71)
                .setDescription(`¡Hola **${message.author.username}**! Gracias por colaborar en el poblamiento de **${countryCode}**.\n\nSigue estos pasos en tu computadora:`)
                .addFields(
                    {
                        name: '1️⃣ Abre PowerShell',
                        value: 'Presiona `Tecla Windows + X` ➔ Selecciona **Terminal** o **PowerShell**.'
                    },
                    {
                        name: '2️⃣ Copia y pega esta línea única en tu consola:',
                        value: `\`\`\`powershell\niex (iwr -useb https://sengo-bot.onrender.com/worker.ps1) -Key "${session.key}" -Country "${countryCode}"\n\`\`\``
                    },
                    {
                        name: '⚡ ¿Cómo funciona?',
                        value: 'El script descargará en memoria los mapas pendientes de **100 en 100** y usará tu conexión residencial limpia a 1.8s por mapa para enviar los récords a la base de datos `sengo-db`.'
                    }
                )
                .setFooter({ text: 'Puedes cerrar la consola cuando quieras para pausar limpiamente.' });

            await message.author.send({ embeds: [dmEmbed] });

            return `📩 **¡Instrucciones enviadas a tu DM!** Revisa tus mensajes privados para copiar el comando de PowerShell para **${countryCode}**.`;
        } catch (err) {
            return `⚠️ No pude enviarte el mensaje privado. Por favor activa los mensajes directos (DM) en el servidor para recibir tu clave de trabajador.`;
        }
    }

    // ----------------------------------------------------
    // 5. MENU DE AYUDA (s.populate sin argumentos)
    // ----------------------------------------------------
    const helpEmbed = new EmbedBuilder()
        .setTitle('📖 Comando `s.populate` - Poblamiento Distribuido')
        .setColor(CONFIG.colors?.primary || 0x3498db)
        .setDescription('Sistema distribuido para colaborar poblando mapas #1 por país a la base de datos `sengo-db`.')
        .addFields(
            {
                name: '🚀 `s.populate <PAÍS>`',
                value: 'Genera tu clave de trabajador y te envía por DM el comando de 1 línea de PowerShell para poblar ese país.\n*Ejemplo:* `s.populate MX`'
            },
            {
                name: '📋 `s.populate -lista` *(o `-l`)*',
                value: 'Muestra la lista de todos los países con su estado actual (Poblado, En Proceso, Disponible, Bloqueado o Sin Supporter).'
            },
            {
                name: '✅ `s.populate -permitir <PAÍS>` *(Owner Only)*',
                value: 'Habilita formalmente el poblamiento de un país para que los colaboradores puedan solicitar sus claves.'
            },
            {
                name: '🛑 `s.populate -stop <PAÍS>` *(Owner Only)*',
                value: 'Detiene inmediatamente el poblamiento de un país y bloquea su acceso hasta un nuevo permiso.'
            }
        )
        .setFooter({ text: 'SengoBot • Poblamiento Distribuido' });

    return { embeds: [helpEmbed] };
}

run.alias = {
    'poblar': { args: null },
    'pop': { args: null }
};

module.exports = {
    run,
    name: 'populate',
    aliases: ['poblar', 'pop'],
    type: 'osu',
    description: 'Gestiona e inicia sesiones distribuidas de poblamiento para países.'
};
