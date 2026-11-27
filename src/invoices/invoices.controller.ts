import { Body, Controller, Get, Param, Post, Query, Render, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { InvoicesService, formatSerial } from './invoices.service';
import { InvoicePdfService, COMPANY_NAME, DISCLAIMER } from './invoice-pdf.service';

const toArray = (v: unknown): string[] =>
  v === undefined ? [] : (Array.isArray(v) ? v : [v]).map(String);

const parseBody = (body: Record<string, any>) => {
  const descriptions = toArray(body.itemDescription);
  const qtys = toArray(body.itemQuantity);
  const prices = toArray(body.itemUnitPrice);
  return {
    customerName: String(body.customerName ?? ''),
    clientId: String(body.clientId ?? ''),
    customerCompany: String(body.customerCompany ?? ''),
    customerAddress: String(body.customerAddress ?? ''),
    issueDate: String(body.issueDate ?? ''),
    notes: String(body.notes ?? ''),
    items: descriptions.map((description, i) => ({
      description,
      quantity: Number(qtys[i]),
      unitPrice: Number(prices[i]),
    })),
  };
};

@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly pdf: InvoicePdfService,
  ) {}

  @Get()
  @Render('invoices/index')
  async index() {
    return { title: 'Invoices', invoices: await this.invoices.list() };
  }

  @Get('new')
  @Render('invoices/new')
  async newPage(@Query('clientId') clientId?: string) {
    const clients = (await this.invoices.clientOptions()).map((c) => ({ ...c, selected: c.id === clientId }));
    return { title: 'New invoice', clients, today: new Date().toISOString().slice(0, 10) };
  }

  @Post()
  async create(@Body() body: Record<string, any>, @Req() req: Request, @Res() res: Response) {
    try {
      const inv = await this.invoices.create(parseBody(body));
      (req as any).flash('success', `Invoice ${formatSerial(inv.serial)} saved.`);
      return res.redirect(`/invoices/${inv.id}`);
    } catch (e: any) {
      (req as any).flash('error', e?.response?.message ?? e?.message ?? 'Could not save invoice');
      return res.redirect('/invoices/new');
    }
  }

  @Get(':id/edit')
  @Render('invoices/new')
  async editPage(@Param('id') id: string) {
    const invoice = await this.invoices.findOrThrow(id);
    const clients = (await this.invoices.clientOptions()).map((c) => ({ ...c, selected: c.id === invoice.clientId }));
    const items = invoice.items.map((i) => ({
      description: i.description,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
    }));
    return {
      title: `Edit ${invoice.number}`,
      editing: true,
      invoice,
      items,
      clients,
      today: invoice.issueDate.toISOString().slice(0, 10),
    };
  }

  @Post(':id')
  async update(@Param('id') id: string, @Body() body: Record<string, any>, @Req() req: Request, @Res() res: Response) {
    try {
      await this.invoices.update(id, parseBody(body));
      (req as any).flash('success', 'Invoice updated.');
      return res.redirect(`/invoices/${id}`);
    } catch (e: any) {
      (req as any).flash('error', e?.response?.message ?? e?.message ?? 'Could not save invoice');
      return res.redirect(`/invoices/${id}/edit`);
    }
  }

  @Get(':id')
  @Render('invoices/show')
  async show(@Param('id') id: string) {
    const invoice = await this.invoices.findOrThrow(id);
    return { title: invoice.number, invoice, companyName: COMPANY_NAME, disclaimer: DISCLAIMER };
  }

  @Get(':id/export.pdf')
  async exportPdf(@Param('id') id: string, @Res() res: Response) {
    const invoice = await this.invoices.findOrThrow(id);
    const buffer = await this.pdf.generate(invoice);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoice.number}.pdf"`,
    });
    res.send(buffer);
  }
}
