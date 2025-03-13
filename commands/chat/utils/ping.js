const ping = require('ping');

async function run(message, args) {
    const startTime = Date.now();
    const sentMessage = await message.message.channel.send("Ping!");
    const latency = Date.now() - startTime;
    
    await sentMessage.edit(`Ping! en ${latency} ms`);
}
module.exports = { run }