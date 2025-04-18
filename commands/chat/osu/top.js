async function run(message, args){

    return `>top`;
}

run.alias = {
    "maniatop" : {
        "args" : "-mania"
    },
    "ctbtop" : {
        "args" : "-ctb"
    },
    "taikotop" : {
        "args" : "-taiko"
    },
    "osutop" : {
        "args" : ""
    },
}
run.description = 
{
    'header' : `Solo has >top con el owo`,
    'body' : undefined,
    'usage' : undefined
}

module.exports = { run }