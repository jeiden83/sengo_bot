-- Migración para crear la tabla de habilidades analíticas de usuarios (user_skills)
CREATE TABLE IF NOT EXISTS public.user_skills (
    osu_id text NOT NULL,
    discord_id text,
    username text NOT NULL,
    country_code varchar(2) NOT NULL,
    gamemode varchar(10) NOT NULL DEFAULT 'osu',
    pp double precision DEFAULT 0,
    global_rank integer DEFAULT 0,
    country_rank integer DEFAULT 0,
    aim double precision DEFAULT 0,
    speed double precision DEFAULT 0,
    acc double precision DEFAULT 0,
    reading double precision DEFAULT 0,
    stamina double precision DEFAULT 0,
    top_play_pp double precision DEFAULT 0,
    skills_data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    PRIMARY KEY (osu_id, gamemode)
);

-- Índices optimizados para rankings nacionales por habilidad y modo
CREATE INDEX IF NOT EXISTS idx_user_skills_country_aim ON public.user_skills (country_code, gamemode, aim DESC);
CREATE INDEX IF NOT EXISTS idx_user_skills_country_speed ON public.user_skills (country_code, gamemode, speed DESC);
CREATE INDEX IF NOT EXISTS idx_user_skills_country_acc ON public.user_skills (country_code, gamemode, acc DESC);
CREATE INDEX IF NOT EXISTS idx_user_skills_country_reading ON public.user_skills (country_code, gamemode, reading DESC);
CREATE INDEX IF NOT EXISTS idx_user_skills_country_stamina ON public.user_skills (country_code, gamemode, stamina DESC);
CREATE INDEX IF NOT EXISTS idx_user_skills_country_pp ON public.user_skills (country_code, gamemode, pp DESC);

-- Habilitar RLS (Row Level Security)
ALTER TABLE public.user_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir lectura pública de habilidades de usuarios" ON public.user_skills
    FOR SELECT USING (true);

CREATE POLICY "Permitir inserción/actualización de habilidades para service_role" ON public.user_skills
    FOR ALL USING (true) WITH CHECK (true);
