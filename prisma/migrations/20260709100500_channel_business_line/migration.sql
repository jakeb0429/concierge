-- Business line on Channel ("d2c" | "b2b") — splits ticket reporting by
-- business. Rheos: hello@ = d2c, wholesale@ = b2b. Tenant-generic for
-- Stingray and future tenants.

-- AlterTable
ALTER TABLE "concierge"."Channel" ADD COLUMN "businessLine" TEXT NOT NULL DEFAULT 'd2c';

-- Data: the Rheos wholesale mailbox is the B2B line.
UPDATE "concierge"."Channel" SET "businessLine" = 'b2b' WHERE "supportAddress" = 'wholesale@rheosgear.com';
