// Para colorear en ANSI
function colorear(texto, color = "blanco", negritas = 1){
	const lista_colores = {
		"negro" : 30,
		"rojo" : 31,
		"verde" : 32,
		"amarillo" : 33,
		"azul" : 34,
		"magenta" : 35,
		"cyan" : 36,
		"blanco" : 37
	};
	return `\x1b[${negritas?negritas:0};${lista_colores[color]};49m` + texto + `\x1b[0m`;
}

module.exports = {
    colorear
}