-- Return/exchange lifecycle on Ticket (null = no return in play).
-- Phase A sets "requested"; later phases advance the state:
-- approved | label_sent | package_received | refunded | exchanged.

-- AlterTable
ALTER TABLE "concierge"."Ticket" ADD COLUMN "returnStatus" TEXT;
