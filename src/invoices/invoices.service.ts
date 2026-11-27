import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface InvoiceInput {
  customerName: string;
  customerCompany?: string;
  clientId?: string;
  customerAddress?: string;
  issueDate?: string;
  notes?: string;
  /** When set, the invoice is linked to this quotation atomically (fails if it was already converted). */
  quotationId?: string;
  items: { description: string; quantity: number; unitPrice: number }[];
}

export const formatSerial = (serial: number) => `INV-${String(serial).padStart(6, '0')}`;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.invoice.findMany({ orderBy: { serial: 'desc' } });
    return rows.map((r) => ({ ...r, number: formatSerial(r.serial) }));
  }

  async findOrThrow(id: string) {
    const inv = await this.prisma.invoice.findUnique({
      where: { id },
      include: { items: { orderBy: { position: 'asc' } }, client: true },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    return { ...inv, number: formatSerial(inv.serial) };
  }

  clientOptions() {
    return this.prisma.client.findMany({
      select: { id: true, name: true, company: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Validates input and recomputes line amounts and total server-side. */
  private async prepare(input: InvoiceInput) {
    const customerName = input.customerName.trim();
    if (!customerName) throw new BadRequestException('Customer name is required');
    if (!input.items.length) throw new BadRequestException('Add at least one line item');

    const items = input.items.map((it, i) => {
      const description = it.description.trim();
      if (!description) throw new BadRequestException(`Line ${i + 1}: details are required`);
      if (!Number.isFinite(it.quantity) || it.quantity <= 0)
        throw new BadRequestException(`Line ${i + 1}: quantity must be greater than 0`);
      if (!Number.isFinite(it.unitPrice) || it.unitPrice < 0)
        throw new BadRequestException(`Line ${i + 1}: amount per unit is invalid`);
      return {
        position: i,
        description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        amount: round2(it.quantity * it.unitPrice),
      };
    });
    const total = round2(items.reduce((s, it) => s + it.amount, 0));

    const issueDate = input.issueDate ? new Date(input.issueDate) : new Date();
    if (isNaN(issueDate.getTime())) throw new BadRequestException('Invalid date');

    if (input.clientId) {
      const exists = await this.prisma.client.count({ where: { id: input.clientId } });
      if (!exists) throw new BadRequestException('Selected client no longer exists');
    }

    return {
      customerName,
      customerCompany: input.customerCompany?.trim() || null,
      clientId: input.clientId || null,
      customerAddress: input.customerAddress?.trim() || null,
      notes: input.notes?.trim() || null,
      issueDate,
      total,
      items,
    };
  }

  /** Serial is assigned by the database on insert. */
  async create(input: InvoiceInput) {
    const { items, ...rest } = await this.prepare(input);
    const data = { ...rest, items: { create: items } };
    if (!input.quotationId) return this.prisma.invoice.create({ data });

    // Claim the quotation and create the invoice together, so a double-click can't produce two invoices.
    const quotationId = input.quotationId;
    return this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.create({ data });
      const claimed = await tx.quotation.updateMany({
        where: { id: quotationId, invoiceId: null },
        data: { invoiceId: inv.id },
      });
      if (!claimed.count) throw new BadRequestException('This quotation was already converted to an invoice');
      return inv;
    });
  }

  /** Replaces the invoice's fields and line items; the serial never changes. */
  async update(id: string, input: InvoiceInput) {
    await this.findOrThrow(id);
    const { items, ...rest } = await this.prepare(input);
    return this.prisma.$transaction(async (tx) => {
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      return tx.invoice.update({ where: { id }, data: { ...rest, items: { create: items } } });
    });
  }
}
