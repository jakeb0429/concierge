-- Nullable, additive: a human-readable line for orders that aren't commerce
-- line items (e.g. a Stingray boat registration: model, hull id, dealer).
ALTER TABLE "concierge"."CustomerOrder" ADD COLUMN "description" TEXT;
