-- Internal ticket Q&A (the Simple View): a CS rep asks a teammate a targeted
-- question on a ticket; the teammate answers from a stripped-down view.
-- Plus User.preferredView — "simple" lands a user on the Q&A queue by default.

-- AlterTable
ALTER TABLE "concierge"."User" ADD COLUMN "preferredView" TEXT NOT NULL DEFAULT 'full';

-- CreateTable
CREATE TABLE "concierge"."TicketQuestion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "askedById" TEXT NOT NULL,
    "assigneeId" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge"."TicketQuestionReply" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketQuestionReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketQuestion_tenantId_assigneeId_status_idx" ON "concierge"."TicketQuestion"("tenantId", "assigneeId", "status");

-- CreateIndex
CREATE INDEX "TicketQuestion_tenantId_status_idx" ON "concierge"."TicketQuestion"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TicketQuestion_ticketId_idx" ON "concierge"."TicketQuestion"("ticketId");

-- CreateIndex
CREATE INDEX "TicketQuestionReply_questionId_createdAt_idx" ON "concierge"."TicketQuestionReply"("questionId", "createdAt");

-- AddForeignKey
ALTER TABLE "concierge"."TicketQuestion" ADD CONSTRAINT "TicketQuestion_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "concierge"."Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."TicketQuestion" ADD CONSTRAINT "TicketQuestion_askedById_fkey" FOREIGN KEY ("askedById") REFERENCES "concierge"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."TicketQuestion" ADD CONSTRAINT "TicketQuestion_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "concierge"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."TicketQuestionReply" ADD CONSTRAINT "TicketQuestionReply_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "concierge"."TicketQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."TicketQuestionReply" ADD CONSTRAINT "TicketQuestionReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "concierge"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
