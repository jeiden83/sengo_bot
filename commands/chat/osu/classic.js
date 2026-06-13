const lazer = require("./lazer.js");

async function run(messages, args) {
    return lazer.run(messages, args, 'classic');
}

run.description = {
    header: "Muestra la jugada referenciada en formato clásico (Classic Score)",
    body: "Permite cambiar el embed de una jugada a puntuación clásica de osu! (1 millón de score máximo por defecto en lazer, vs clásico).",
    usage: "s.classic (como respuesta a un embed de jugada)"
};

module.exports = { run, description: run.description };
