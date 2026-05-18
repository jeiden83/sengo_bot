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

// Para revisar el estatus del beatmap.osu en Supabase
// Principalmente para revisar si un unranked cambio de estatus, entonces para remplazar el .osu
async function localBeatmapStatus(beatmap_osu_id, beatmap_metadata){
	const { getSupabaseClient } = require("../../db/database.js");
	const supabase = getSupabaseClient();

	if (!supabase) {
		console.warn("⚠️ Supabase no está conectado.");
		return null;
	}

	// Si le pasamos datos al beatmap_metadata
	// Forma de remplazar los datos en Supabase
	if(beatmap_metadata){
		const name = `${beatmap_metadata.beatmapset.artist} - ${beatmap_metadata.beatmapset.title} [${beatmap_metadata.version}]`;

		const { error } = await supabase
			.from('local_beatmaps')
			.upsert({
				beatmap_id: beatmap_osu_id.toString(),
				status: beatmap_metadata.status,
				last_updated: beatmap_metadata.last_updated,
				name: name
			}, { onConflict: 'beatmap_id' });

		if (error) {
			console.error(`❌ Error actualizando beatmap ${beatmap_osu_id} en Supabase:`, error.message);
		}

		return {
			status: beatmap_metadata.status,
			last_updated: beatmap_metadata.last_updated,
			name: name
		};
	}

	// Obtener los datos desde Supabase
	const { data, error } = await supabase
		.from('local_beatmaps')
		.select('*')
		.eq('beatmap_id', beatmap_osu_id.toString())
		.maybeSingle();

	if (error) {
		console.error(`❌ Error obteniendo beatmap ${beatmap_osu_id} de Supabase:`, error.message);
		return null;
	}

	return data;
}


module.exports = {
	localBeatmapStatus,
    colorear
}