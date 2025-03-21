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

// Para revisar el estatus del beatmap.osu en mi index localmente
// Principalmente para revisar si un unranked cambio de estatus, entonces para remplazar el .osu
function localBeatmapStatus(beatmap_osu_id, beatmap_metadata){
	const fs = require('fs');
	const path = require('path');

	const index_relative_path = "../../db/local/beatmap.osu/index.json";

	const beatmap_index = require(index_relative_path);

	// Si le pasamos datos al beatmap_index
	// Forma de remplazar los datos
	if(beatmap_metadata){

		// Solo se necesitan dos
		// El estatus para tener un cacheo local del estatus del mapa
		// La ultima modificacion para el momento de revisar si el mapa cambio
		beatmap_index[beatmap_osu_id] = {
			"status" : beatmap_metadata.status,
			"last_updated" : beatmap_metadata.last_updated
		}

		// Se guarda el id y sus datos
		fs.writeFileSync(path.join(__dirname, index_relative_path), JSON.stringify(beatmap_index, null, 2));
	}

	return beatmap_index[beatmap_osu_id];
}


module.exports = {
	localBeatmapStatus,
    colorear
}