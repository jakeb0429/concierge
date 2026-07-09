-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "concierge";

-- CreateTable
CREATE TABLE "concierge"."Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "voiceGuide" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge"."Channel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "supportAddress" TEXT NOT NULL,
    "cursor" TEXT,
    "watchExpiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge"."KnowledgeItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "triggerPhrases" TEXT[],
    "tags" TEXT[],
    "category" TEXT,
    "conditions" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "ownerId" TEXT,
    "sourceRef" TEXT,
    "embedding" extensions.vector(1024),
    "avoidNotes" TEXT[],
    "exemplar" BOOLEAN NOT NULL DEFAULT false,
    "timesCited" INTEGER NOT NULL DEFAULT 0,
    "lastCitedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge"."LearningSignal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "knowledgeItemId" TEXT,
    "proposedText" TEXT,
    "proposedTarget" TEXT NOT NULL DEFAULT 'answer',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "evidence" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "category" TEXT,
    "assigneeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "LearningSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge"."Customer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT,
    "handle" TEXT,
    "displayName" TEXT,
    "purchaseChannel" TEXT,
    "channelName" TEXT,
    "insight" TEXT,
    "insightAt" TIMESTAMP(3),
    "insightBasis" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge"."Ticket" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "channelId" TEXT,
    "subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "category" TEXT,
    "assigneeId" TEXT,
    "tags" TEXT[],
    "folder" TEXT,
    "providerThreadId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge"."Message" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "fromEmail" TEXT,
    "fromHandle" TEXT,
    "subject" TEXT,
    "text" TEXT NOT NULL,
    "html" TEXT,
    "attachments" JSONB,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge"."Draft" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "editedBody" TEXT,
    "coverage" TEXT NOT NULL,
    "coverageNote" TEXT,
    "policyFlags" TEXT[],
    "steerNotes" TEXT,
    "regenOf" TEXT,
    "status" TEXT NOT NULL DEFAULT 'prepared',
    "reviewNote" TEXT,
    "sentMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge"."DraftCitation" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "knowledgeItemId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "DraftCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge"."Rule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge"."User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'agent',
    "specialties" TEXT[],
    "magicLinkToken" TEXT,
    "magicLinkExpires" TIMESTAMP(3),
    "passwordHash" TEXT,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge"."AnalyticsInquiry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "fromEmail" TEXT,
    "subject" TEXT,
    "category" TEXT NOT NULL,
    "endSentiment" TEXT NOT NULL,
    "threadCreatedAt" TIMESTAMP(3) NOT NULL,
    "daysSincePurchase" INTEGER,
    "productFamily" TEXT,
    "frameColor" TEXT,
    "lensColor" TEXT,
    "productStyle" TEXT,
    "productGender" TEXT,

    CONSTRAINT "AnalyticsInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge"."ProductFamily" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "frameColors" TEXT[],
    "lensColors" TEXT[],
    "style" TEXT,
    "gender" TEXT,
    "isSunglasses" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge"."CustomerOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "email" TEXT NOT NULL,
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "orderRef" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "refunded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CustomerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge"."SalesSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "lastCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge"."StockistSale" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "itemName" TEXT NOT NULL,
    "sku" TEXT,
    "productFamily" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "closedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockistSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge"."SalesMonthly" (
    "month" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "orders" INTEGER NOT NULL,
    "revenue" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "SalesMonthly_pkey" PRIMARY KEY ("month","source")
);

-- CreateTable
CREATE TABLE "concierge"."ContextNote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "ticketId" TEXT,
    "productFamily" TEXT,
    "body" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContextNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge"."AuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "concierge"."Tenant"("slug");

-- CreateIndex
CREATE INDEX "Channel_tenantId_idx" ON "concierge"."Channel"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_tenantId_provider_supportAddress_key" ON "concierge"."Channel"("tenantId", "provider", "supportAddress");

-- CreateIndex
CREATE INDEX "KnowledgeItem_tenantId_status_idx" ON "concierge"."KnowledgeItem"("tenantId", "status");

-- CreateIndex
CREATE INDEX "KnowledgeItem_tenantId_category_idx" ON "concierge"."KnowledgeItem"("tenantId", "category");

-- CreateIndex
CREATE INDEX "KnowledgeItem_tenantId_exemplar_idx" ON "concierge"."KnowledgeItem"("tenantId", "exemplar");

-- CreateIndex
CREATE INDEX "LearningSignal_tenantId_status_idx" ON "concierge"."LearningSignal"("tenantId", "status");

-- CreateIndex
CREATE INDEX "LearningSignal_tenantId_kind_idx" ON "concierge"."LearningSignal"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "LearningSignal_tenantId_assigneeId_status_idx" ON "concierge"."LearningSignal"("tenantId", "assigneeId", "status");

-- CreateIndex
CREATE INDEX "Customer_tenantId_handle_idx" ON "concierge"."Customer"("tenantId", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_email_key" ON "concierge"."Customer"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Ticket_tenantId_status_idx" ON "concierge"."Ticket"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Ticket_tenantId_assigneeId_idx" ON "concierge"."Ticket"("tenantId", "assigneeId");

-- CreateIndex
CREATE INDEX "Ticket_tenantId_category_idx" ON "concierge"."Ticket"("tenantId", "category");

-- CreateIndex
CREATE INDEX "Ticket_customerId_idx" ON "concierge"."Ticket"("customerId");

-- CreateIndex
CREATE INDEX "Ticket_tenantId_createdAt_idx" ON "concierge"."Ticket"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_tenantId_providerThreadId_key" ON "concierge"."Ticket"("tenantId", "providerThreadId");

-- CreateIndex
CREATE INDEX "Message_ticketId_sentAt_idx" ON "concierge"."Message"("ticketId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_tenantId_providerMessageId_key" ON "concierge"."Message"("tenantId", "providerMessageId");

-- CreateIndex
CREATE INDEX "Draft_ticketId_idx" ON "concierge"."Draft"("ticketId");

-- CreateIndex
CREATE INDEX "Draft_tenantId_status_idx" ON "concierge"."Draft"("tenantId", "status");

-- CreateIndex
CREATE INDEX "DraftCitation_draftId_idx" ON "concierge"."DraftCitation"("draftId");

-- CreateIndex
CREATE INDEX "Rule_tenantId_priority_idx" ON "concierge"."Rule"("tenantId", "priority");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "concierge"."User"("email");

-- CreateIndex
CREATE INDEX "User_magicLinkToken_idx" ON "concierge"."User"("magicLinkToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "concierge"."User"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsInquiry_threadId_key" ON "concierge"."AnalyticsInquiry"("threadId");

-- CreateIndex
CREATE INDEX "AnalyticsInquiry_tenantId_threadCreatedAt_idx" ON "concierge"."AnalyticsInquiry"("tenantId", "threadCreatedAt");

-- CreateIndex
CREATE INDEX "AnalyticsInquiry_tenantId_category_idx" ON "concierge"."AnalyticsInquiry"("tenantId", "category");

-- CreateIndex
CREATE INDEX "AnalyticsInquiry_tenantId_productFamily_idx" ON "concierge"."AnalyticsInquiry"("tenantId", "productFamily");

-- CreateIndex
CREATE INDEX "AnalyticsInquiry_fromEmail_idx" ON "concierge"."AnalyticsInquiry"("fromEmail");

-- CreateIndex
CREATE UNIQUE INDEX "ProductFamily_name_key" ON "concierge"."ProductFamily"("name");

-- CreateIndex
CREATE INDEX "CustomerOrder_email_idx" ON "concierge"."CustomerOrder"("email");

-- CreateIndex
CREATE INDEX "CustomerOrder_tenantId_source_idx" ON "concierge"."CustomerOrder"("tenantId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_source_orderRef_key" ON "concierge"."CustomerOrder"("source", "orderRef");

-- CreateIndex
CREATE UNIQUE INDEX "SalesSource_tenantId_key_key" ON "concierge"."SalesSource"("tenantId", "key");

-- CreateIndex
CREATE INDEX "StockistSale_tenantId_productFamily_closedAt_idx" ON "concierge"."StockistSale"("tenantId", "productFamily", "closedAt");

-- CreateIndex
CREATE INDEX "StockistSale_tenantId_state_idx" ON "concierge"."StockistSale"("tenantId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "StockistSale_dealId_itemName_key" ON "concierge"."StockistSale"("dealId", "itemName");

-- CreateIndex
CREATE INDEX "ContextNote_tenantId_customerId_idx" ON "concierge"."ContextNote"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "ContextNote_tenantId_ticketId_idx" ON "concierge"."ContextNote"("tenantId", "ticketId");

-- CreateIndex
CREATE INDEX "ContextNote_tenantId_productFamily_idx" ON "concierge"."ContextNote"("tenantId", "productFamily");

-- CreateIndex
CREATE INDEX "ContextNote_tenantId_expiresAt_idx" ON "concierge"."ContextNote"("tenantId", "expiresAt");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_createdAt_idx" ON "concierge"."AuditEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_action_idx" ON "concierge"."AuditEvent"("tenantId", "action");

-- AddForeignKey
ALTER TABLE "concierge"."Channel" ADD CONSTRAINT "Channel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "concierge"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "concierge"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."LearningSignal" ADD CONSTRAINT "LearningSignal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "concierge"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "concierge"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."Ticket" ADD CONSTRAINT "Ticket_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "concierge"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."Ticket" ADD CONSTRAINT "Ticket_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "concierge"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."Ticket" ADD CONSTRAINT "Ticket_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "concierge"."Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."Ticket" ADD CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "concierge"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."Message" ADD CONSTRAINT "Message_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "concierge"."Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."Draft" ADD CONSTRAINT "Draft_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "concierge"."Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."DraftCitation" ADD CONSTRAINT "DraftCitation_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "concierge"."Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."DraftCitation" ADD CONSTRAINT "DraftCitation_knowledgeItemId_fkey" FOREIGN KEY ("knowledgeItemId") REFERENCES "concierge"."KnowledgeItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."Rule" ADD CONSTRAINT "Rule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "concierge"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "concierge"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."SalesSource" ADD CONSTRAINT "SalesSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "concierge"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."ContextNote" ADD CONSTRAINT "ContextNote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "concierge"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge"."AuditEvent" ADD CONSTRAINT "AuditEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "concierge"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

