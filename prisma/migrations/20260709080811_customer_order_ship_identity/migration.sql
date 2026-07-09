-- Buyer + ship-to identity on CustomerOrder (Shopify import) — powers
-- related-customer matching: family members / alternate emails via shared
-- name or shipping address. All nullable; backfilled by a full re-import.

-- AlterTable
ALTER TABLE "concierge"."CustomerOrder"
ADD COLUMN "buyerName" TEXT,
ADD COLUMN "shipAddress1" TEXT,
ADD COLUMN "shipCity" TEXT,
ADD COLUMN "shipName" TEXT,
ADD COLUMN "shipState" TEXT,
ADD COLUMN "shipZip" TEXT;

-- CreateIndex
CREATE INDEX "CustomerOrder_shipZip_idx" ON "concierge"."CustomerOrder"("shipZip");
