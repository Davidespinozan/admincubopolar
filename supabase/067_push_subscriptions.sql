-- 067: Web Push (Tanda 30)
-- Suscripciones de dispositivos + marca de "ya se pusheó" en
-- notificaciones. Correr en el SQL Editor de Supabase.

-- Cada fila = un dispositivo que activó avisos. Solo las Netlify
-- Functions (service_role) la tocan: RLS habilitado SIN policies =
-- deny-all para anon/authenticated, siguiendo la convención del repo
-- (flows privilegiados via netlify/functions, mig 015/031).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  BIGINT REFERENCES usuarios(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- El cron reparte las notificaciones nuevas; esta marca evita
-- reenviar la misma dos veces.
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS push_enviada BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_notif_push ON notificaciones (push_enviada, created_at DESC);

-- Backfill: lo que ya existía no debe inundar los teléfonos en la
-- primera corrida del cron.
UPDATE notificaciones SET push_enviada = true WHERE push_enviada = false;
