-- Crear tabla de beatmaps clasificados/loved para el recomendador personalizado
CREATE TABLE IF NOT EXISTS public.ranked_beatmaps (
    beatmap_id BIGINT PRIMARY KEY,
    beatmapset_id BIGINT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    creator TEXT NOT NULL, -- Mapper
    version TEXT NOT NULL, -- Nombre de la dificultad
    stars NUMERIC(4,2) NOT NULL,
    mode INT NOT NULL DEFAULT 0,
    bpm NUMERIC(6,2) NOT NULL,
    total_length INT NOT NULL, -- Segundos
    hit_length INT NOT NULL,   -- Segundos de juego activo
    ar NUMERIC(4,2) NOT NULL,
    cs NUMERIC(4,2) NOT NULL,
    od NUMERIC(4,2) NOT NULL,
    hp NUMERIC(4,2) NOT NULL,
    max_combo INT,
    genre TEXT,                -- E.g., Electronic, Anime, Rock
    language TEXT,             -- E.g., Japanese, English, Instrumental
    tags TEXT[],               -- Array de tags del mapa
    user_tags TEXT[],          -- Array de tags del usuario (comunidad)
    playcount BIGINT DEFAULT 0,
    favourite_count INT DEFAULT 0,
    ranked_status INT NOT NULL, -- 1 = Ranked, 2 = Approved, 3 = Qualified, 4 = Loved
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_beatmaps_stars_mode ON public.ranked_beatmaps (stars, mode);
CREATE INDEX IF NOT EXISTS idx_beatmaps_genre_lang ON public.ranked_beatmaps (genre, language);
