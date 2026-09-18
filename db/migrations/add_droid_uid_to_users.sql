-- Migración para añadir la columna droid_uid a la tabla users
-- Permite vincular cuentas de osu!droid a usuarios de Discord en Sengo

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS droid_uid text DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_users_droid_uid ON public.users(droid_uid);
