-- Happy hour widget (Charleston / Mount Pleasant) for the morning digest.
-- One shared table (not tenant-scoped) written by the daily happy-hour-scan
-- cron; upserts key on dedupeKey so re-runs converge.

-- CreateTable
CREATE TABLE "concierge"."HappyHourSpecial" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "deal" TEXT NOT NULL,
    "details" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'recurring',
    "source" TEXT,
    "sourceUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HappyHourSpecial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HappyHourSpecial_dedupeKey_key" ON "concierge"."HappyHourSpecial"("dedupeKey");

-- CreateIndex
CREATE INDEX "HappyHourSpecial_active_lastSeenAt_idx" ON "concierge"."HappyHourSpecial"("active", "lastSeenAt");
