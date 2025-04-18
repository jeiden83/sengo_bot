async function run(messages, args) {
    const { message, reply } = messages;

    const authorName = message.author.username;
    const messageContent = message.content; 
    const currentDate = new Date().toISOString();

    console.log(`[${currentDate}] (${authorName}) : ${messageContent}`);

    const say_as_bot = `${args.join(' ')}`;
    message.delete();

    if(reply){
        reply.reply(say_as_bot);
        return;
    }

    return say_as_bot;
}

run.alias = {
    "decir" : {
        "args" : ""
    },
    "impersonar" : {
        "args" : ""
    } 
}

run.description = 
{
    'header' : "Di algo como si fuera el Sengo",
    'body' : undefined,
    'usage' : `s.say 'texto' : Sengo envia un mensaje igual al texto`
}

module.exports = { run }