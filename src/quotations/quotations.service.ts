import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { QuotationKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from '../invoices/invoices.service';

export const ORIGIN = 'Tunasan, Muntinlupa';
export const TRANSPORT_RATE = 2000; // pesos per block
export const TRANSPORT_BLOCK_KM = 30;
export const BASE_FEE = 5000;
export const DEFAULT_PRICE_PER_PAX = 80;

export const formatQuoteNumber = (serial: number) => `QUO-${String(serial).padStart(6, '0')}`;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Transport is charged pro-rata: ₱2,000 per 30 km from Tunasan, Muntinlupa. */
export const transportFeeFor = (km: number) => round2((km / TRANSPORT_BLOCK_KM) * TRANSPORT_RATE);

export interface QuotationInput {
  distanceKm?: number;
  pax?: number;
  pricePerPax?: number;
  notes?: string;
  items: { description: string; quantity: number; unitPrice: number }[];
}

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
  ) {}

  async findEvent(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { client: true },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async findOrThrow(id: string) {
    const q = await this.prisma.quotation.findUnique({
      where: { id },
      include: {
        items: { orderBy: { position: 'asc' } },
        event: { include: { client: true } },
        invoice: true,
      },
    });
    if (!q) throw new NotFoundException('Quotation not found');
    return { ...q, number: formatQuoteNumber(q.serial) };
  }

  async listForEvent(eventId: string) {
    const rows = await this.prisma.quotation.findMany({
      where: { eventId },
      orderBy: { serial: 'asc' },
      include: { invoice: { select: { id: true, serial: true } } },
    });
    return rows.map((r) => ({ ...r, number: formatQuoteNumber(r.serial) }));
  }

  hasMain(eventId: string, exceptId?: string) {
    return this.prisma.quotation.count({
      where: { eventId, kind: 'MAIN', ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
  }

  private build(kind: QuotationKind, input: QuotationInput) {
    const items = input.items
      .filter((it) => it.description.trim() || it.unitPrice || it.quantity !== 1) // ignore untouched blank rows
      .map((it, i) => {
        const description = it.description.trim();
        if (!description) throw new BadRequestException(`Add-on ${i + 1}: description is required`);
        if (!Number.isFinite(it.quantity) || it.quantity <= 0)
          throw new BadRequestException(`Add-on ${i + 1}: quantity must be greater than 0`);
        if (!Number.isFinite(it.unitPrice) || it.unitPrice < 0)
          throw new BadRequestException(`Add-on ${i + 1}: price per unit is invalid`);
        return { position: i, description, quantity: it.quantity, unitPrice: it.unitPrice, amount: round2(it.quantity * it.unitPrice) };
      });
    const addons = round2(items.reduce((s, it) => s + it.amount, 0));

    if (kind === 'ADDITIONAL') {
      if (!items.length) throw new BadRequestException('Add at least one add-on');
      return { items, total: addons, distanceKm: 0, pax: 0, pricePerPax: 0, baseFee: 0, transportFee: 0, paxAmount: 0 };
    }

    const distanceKm = Number(input.distanceKm ?? 0);
    const pax = Number(input.pax ?? 0);
    const pricePerPax = Number(input.pricePerPax ?? DEFAULT_PRICE_PER_PAX);
    if (!Number.isFinite(distanceKm) || distanceKm < 0) throw new BadRequestException('Distance is invalid');
    if (!Number.isInteger(pax) || pax < 0) throw new BadRequestException('Pax must be a whole number');
    if (!Number.isFinite(pricePerPax) || pricePerPax < 0) throw new BadRequestException('Price per pax is invalid');

    const transportFee = transportFeeFor(distanceKm);
    const paxAmount = round2(pax * pricePerPax);
    const total = round2(BASE_FEE + transportFee + paxAmount + addons);
    return { items, total, distanceKm, pax, pricePerPax, baseFee: BASE_FEE, transportFee, paxAmount };
  }

  async create(eventId: string, kind: QuotationKind, input: QuotationInput) {
    await this.findEvent(eventId);
    if (kind === 'MAIN' && (await this.hasMain(eventId)))
      throw new BadRequestException('This event already has a main quotation');
    const { items, ...rest } = this.build(kind, input);
    return this.prisma.quotation.create({
      data: { eventId, kind, notes: input.notes?.trim() || null, ...rest, items: { create: items } },
    });
  }

  async update(id: string, input: QuotationInput) {
    const q = await this.findOrThrow(id);
    if (q.invoiceId) throw new BadRequestException('Already converted to an invoice — it can no longer be edited');
    const { items, ...rest } = this.build(q.kind, input);
    return this.prisma.$transaction(async (tx) => {
      await tx.quotationItem.deleteMany({ where: { quotationId: id } });
      return tx.quotation.update({
        where: { id },
        data: { notes: input.notes?.trim() || null, ...rest, items: { create: items } },
      });
    });
  }

  async remove(id: string) {
    const q = await this.findOrThrow(id);
    await this.prisma.quotation.delete({ where: { id } });
    return q;
  }

  /** Invoice lines for a quotation: fee lines (skipping zero amounts) followed by its add-ons. */
  invoiceLines(q: Awaited<ReturnType<QuotationsService['findOrThrow']>>) {
    const lines: { description: string; quantity: number; unitPrice: number }[] = [];
    if (q.kind === 'MAIN') {
      if (Number(q.baseFee) > 0) lines.push({ description: 'Service base fee', quantity: 1, unitPrice: Number(q.baseFee) });
      if (q.pax > 0 && Number(q.pricePerPax) > 0)
        lines.push({ description: 'Per-pax charge', quantity: q.pax, unitPrice: Number(q.pricePerPax) });
      if (Number(q.transportFee) > 0)
        lines.push({
          description: `Transportation fee (${Number(q.distanceKm)} km from ${ORIGIN})`,
          quantity: 1,
          unitPrice: Number(q.transportFee),
        });
    }
    for (const it of q.items)
      lines.push({ description: it.description, quantity: Number(it.quantity), unitPrice: Number(it.unitPrice) });
    return lines;
  }

  async convertToInvoice(id: string) {
    const q = await this.findOrThrow(id);
    if (q.invoiceId) throw new BadRequestException('Already converted to an invoice');
    const ev = q.event;
    return this.invoices.create({
      customerName: ev.client?.name ?? ev.clientName,
      customerCompany: ev.client?.company ?? undefined,
      clientId: ev.clientId ?? undefined,
      customerAddress: ev.venue ?? undefined,
      notes: `${q.kind === 'MAIN' ? 'Quotation' : 'Additional quotation'} ${q.number} · ${ev.clientName} · ${ev.eventDate.toISOString().slice(0, 10)}`,
      quotationId: id,
      items: this.invoiceLines(q),
    });
  }
}
