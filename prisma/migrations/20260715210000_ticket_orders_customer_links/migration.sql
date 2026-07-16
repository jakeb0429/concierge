-- Ticket↔order links (rep-confirmed) + associated customer profiles (aliases).
ALTER TABLE "concierge"."Customer" ADD COLUMN "primaryId" TEXT;
ALTER TABLE "concierge"."Customer"
  ADD CONSTRAINT "Customer_primaryId_fkey" FOREIGN KEY ("primaryId")
  REFERENCES "concierge"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Customer_primaryId_idx" ON "concierge"."Customer"("primaryId");

CREATE TABLE "concierge"."TicketOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "customerOrderId" TEXT NOT NULL,
    "via" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TicketOrder_ticketId_customerOrderId_key"
  ON "concierge"."TicketOrder"("ticketId", "customerOrderId");
CREATE INDEX "TicketOrder_tenantId_ticketId_idx"
  ON "concierge"."TicketOrder"("tenantId", "ticketId");
ALTER TABLE "concierge"."TicketOrder"
  ADD CONSTRAINT "TicketOrder_ticketId_fkey" FOREIGN KEY ("ticketId")
  REFERENCES "concierge"."Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "concierge"."TicketOrder"
  ADD CONSTRAINT "TicketOrder_customerOrderId_fkey" FOREIGN KEY ("customerOrderId")
  REFERENCES "concierge"."CustomerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
