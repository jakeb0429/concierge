-- Financial visibility flag: revenue/sales summaries render only for flagged
-- users (owners). Admin role alone is NOT enough — reps run support as
-- brand_admin without seeing the business's numbers.

-- AlterTable
ALTER TABLE "concierge"."User" ADD COLUMN "canViewSales" BOOLEAN NOT NULL DEFAULT false;

-- Data: Jake's accounts (and the dev super-admin) keep sales visibility.
UPDATE "concierge"."User" SET "canViewSales" = true
WHERE email IN ('jake@scribechs.com', 'jake@rheosgear.com', 'jacob.berton@gmail.com', 'dev@scribechs.com');
