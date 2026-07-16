-- Crear tabla para registrar los mensajes de embeds de torneos enviados
CREATE TABLE IF NOT EXISTS public.tournament_feed_messages (
    tournament_id BIGINT NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
    PRIMARY KEY (tournament_id, guild_id)
);

-- Habilitar RLS
ALTER TABLE public.tournament_feed_messages ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
CREATE POLICY "Allow all operations for tournament_feed_messages" ON public.tournament_feed_messages
    FOR ALL
    USING (true)
    WITH CHECK (true);
