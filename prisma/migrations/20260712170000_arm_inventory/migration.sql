-- Arm (temple) replacement inventory, keyed by SKU with separate left/right counts.
CREATE TABLE "concierge"."ArmInventory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "container" INTEGER,
    "leftCount" INTEGER NOT NULL DEFAULT 0,
    "rightCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArmInventory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArmInventory_tenantId_sku_key" ON "concierge"."ArmInventory"("tenantId", "sku");
CREATE INDEX "ArmInventory_tenantId_brand_idx" ON "concierge"."ArmInventory"("tenantId", "brand");

ALTER TABLE "concierge"."ArmInventory"
    ADD CONSTRAINT "ArmInventory_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "concierge"."Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
