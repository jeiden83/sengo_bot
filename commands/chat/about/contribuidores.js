async function run(message, args){

    const msj =`
- **Jeiden**: Creador del bot; obviamente en el top
- **Zebbyx**: La idea de crear el bot para el s.bg y quien me dio las ganas
- **Airflux**: GFX de unos embeds; el aires
- **Phingus**: el comando s.gap
- **Osulatam**: Por debugear y darme mas trabajo
- **Los de mania osulatam**: Por hacerme tener mas trabajo con el minijuego
- **Tsuhikari, Lin, Diego, Luchito, Blast, Mochilo y el resto**: Por debugear y usar el bot
`

    return msj;
}

run.description = {
    'header' : 'Lista de contribuidores del bot',
    'body' : '**Ordenados** de mayor a menor contribucion. Si aportas algo aunque sea solo una opinion y es aceptada, pues tu nombre aparecerá aquí. Probablemente.',
    'usage' : undefined
}

module.exports = { run }