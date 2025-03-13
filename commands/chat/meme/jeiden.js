async function run(message, args){

    const responses = [
        'Un juego es para divertirse.',
        'El que es pobre es pobre porque quiere.',
        'Presta atencion a los pequeños detalles, ya que esos son los mas importantes.',
        'No seas critico con las cosas, pues solo sentiras desagrado hacia las mismas.',
        'Suma, y trata de no restar.',
        'Escucha, y luego habla.',
        'Primero piensa un poco lo que diras.',
        'No tengas miedo de expresar tus aficiones.',
        'Aprende ingles y programacion. Te moldean tu cerebro de una manera increible y te hacen invencible.',
        'Pues que esperabas? Es el creador del bot.'
    ];

    return responses[Math.floor(Math.random() * responses.length)]
}
run.description = 
{
    'header' : 'Jeiden dandosela de misterioso. Nada nuevo',
    'body' : undefined,
    'usage' : undefined
}

module.exports = { run }