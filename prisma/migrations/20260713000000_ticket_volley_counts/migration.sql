-- Volley analytics: how many exchanges a ticket took (customer + our replies).
ALTER TABLE "concierge"."Ticket"
  ADD COLUMN "customerReplyCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "repReplyCount" INTEGER NOT NULL DEFAULT 0;
