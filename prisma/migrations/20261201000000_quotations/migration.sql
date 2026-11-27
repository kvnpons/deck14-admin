-- CreateEnum
CREATE TYPE "QuotationKind" AS ENUM ('MAIN', 'ADDITIONAL');

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "serial" SERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" "QuotationKind" NOT NULL,
    "distanceKm" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "pax" INTEGER NOT NULL DEFAULT 0,
    "pricePerPax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "baseFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "transportFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "total" DECIMAL(12,2) NOT NULL,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationItem" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "QuotationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_serial_key" ON "Quotation"("serial");
CREATE UNIQUE INDEX "Quotation_invoiceId_key" ON "Quotation"("invoiceId");
CREATE INDEX "Quotation_eventId_idx" ON "Quotation"("eventId");
CREATE INDEX "QuotationItem_quotationId_idx" ON "QuotationItem"("quotationId");

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
