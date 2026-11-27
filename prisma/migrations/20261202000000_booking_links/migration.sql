-- CreateTable
CREATE TABLE "BookingLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "eventId" TEXT,

    CONSTRAINT "BookingLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingLink_token_key" ON "BookingLink"("token");
CREATE UNIQUE INDEX "BookingLink_eventId_key" ON "BookingLink"("eventId");

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
