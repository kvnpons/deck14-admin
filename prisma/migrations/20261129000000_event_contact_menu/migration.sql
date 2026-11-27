-- AlterTable
ALTER TABLE "Event" ADD COLUMN "contactName" TEXT,
ADD COLUMN "contactPhone" TEXT;

-- CreateTable
CREATE TABLE "EventMenu" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL,
    "cocktailIds" TEXT[],
    "shooterIds" TEXT[],
    "fontFamily" TEXT NOT NULL,
    "accentColor" TEXT NOT NULL,
    "textColor" TEXT NOT NULL,
    "overlayOpacity" DOUBLE PRECISION NOT NULL,
    "background" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventMenu_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventMenu_eventId_key" ON "EventMenu"("eventId");

-- AddForeignKey
ALTER TABLE "EventMenu" ADD CONSTRAINT "EventMenu_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
