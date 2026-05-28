-- Migración para crear la tabla de estadísticas de Ranked Play
CREATE TABLE IF NOT EXISTS public.user_ranked_stats (
    osu_id text PRIMARY KEY,
    discord_id text,
    username text NOT NULL,
    country_code text,
    rating integer DEFAULT 0,
    wins integer DEFAULT 0,
    plays integer DEFAULT 0,
    is_provisional boolean DEFAULT false,
    updated_at timestamp with time zone DEFAULT now()
);

-- Habilitar RLS (Row Level Security) y configurar políticas si es necesario.
-- Nota: La API key de service_role del bot omite las políticas de RLS automáticamente.
ALTER TABLE public.user_ranked_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir lectura pública de estadísticas de ranked" ON public.user_ranked_stats
    FOR SELECT USING (true);

CREATE POLICY "Permitir inserción/actualización de estadísticas de ranked para service_role" ON public.user_ranked_stats
    FOR ALL USING (true) WITH CHECK (true);
