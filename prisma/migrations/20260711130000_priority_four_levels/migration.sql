-- Four-level priority scale (urgent | high | medium | normal), 2026-07-11.
-- The old binary scale stored "high" for what the UI rendered as URGENT —
-- rename those rows so "high" is free to mean the new second level.
-- Data-only migration; the column stays TEXT. Runs once via migrate deploy.
UPDATE "concierge"."Ticket" SET "priority" = 'urgent' WHERE "priority" = 'high';
