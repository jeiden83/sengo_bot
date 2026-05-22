
async function run(message, args) {
    const startTime = Date.now();
    const sentMessage = await message.message.channel.send("Ping!");
    const latency = Date.now() - startTime;
    
    await sentMessage.edit(`Ping! en ${latency} ms`);
}

run.description = {
    'header': 'Muestra la latencia del bot',
    'body': 'Calcula el tiempo de respuesta en milisegundos desde Discord.',
    'usage': 's.ping'
};

module.exports = { run, description: run.description }