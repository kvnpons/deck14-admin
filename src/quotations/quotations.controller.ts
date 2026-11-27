import { Body, Controller, Get, Param, Post, Query, Render, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { QuotationKind } from '@prisma/client';
import {
  BASE_FEE, DEFAULT_PRICE_PER_PAX, ORIGIN, TRANSPORT_BLOCK_KM, TRANSPORT_RATE,
  QuotationInput, QuotationsService, formatQuoteNumber,
} from './quotations.service';
import { formatSerial } from '../invoices/invoices.service';

const toArray = (v: unknown): string[] =>
  v === undefined ? [] : (Array.isArray(v) ? v : [v]).map(String);

const parseKind = (v: unknown): QuotationKind => (v === 'ADDITIONAL' ? 'ADDITIONAL' : 'MAIN');

function parseBody(body: Record<string, any>): QuotationInput {
  const d = toArray(body.itemDescription);
  const q = toArray(body.itemQuantity);
  const p = toArray(body.itemUnitPrice);
  return {
    distanceKm: Number(body.distanceKm || 0),
    pax: Number(body.pax || 0),
    pricePerPax: body.pricePerPax === '' || body.pricePerPax === undefined ? DEFAULT_PRICE_PER_PAX : Number(body.pricePerPax),
    notes: String(body.notes ?? ''),
    items: d.map((description, i) => ({ description, quantity: Number(q[i] || 0), unitPrice: Number(p[i] || 0) })),
  };
}

const fail = (req: Request, res: Response, e: any, back: string) => {
  (req as any).flash('error', e?.response?.message ?? e?.message ?? 'Could not save quotation');
  return res.redirect(back);
};

@Controller()
export class QuotationsController {
  constructor(private readonly quotes: QuotationsService) {}

  private rates() {
    return { origin: ORIGIN, transportRate: TRANSPORT_RATE, blockKm: TRANSPORT_BLOCK_KM, baseFee: BASE_FEE };
  }

  @Get('events/:eventId/quotations/new')
  @Render('quotations/form')
  async newPage(@Param('eventId') eventId: string, @Query('kind') kindParam?: string) {
    const event = await this.quotes.findEvent(eventId);
    const kind = parseKind(kindParam);
    return {
      title: kind === 'MAIN' ? 'New quotation' : 'New additional quotation',
      event,
      kind,
      isMain: kind === 'MAIN',
      action: `/events/${eventId}/quotations`,
      cancelHref: `/events/${eventId}`,
      q: { distanceKm: '', pax: event.pax, pricePerPax: DEFAULT_PRICE_PER_PAX, notes: '' },
      items: [],
      rates: this.rates(),
      hasMain: kind === 'MAIN' ? await this.quotes.hasMain(eventId) > 0 : false,
    };
  }

  @Post('events/:eventId/quotations')
  async create(@Param('eventId') eventId: string, @Body() body: Record<string, any>, @Req() req: Request, @Res() res: Response) {
    const kind = parseKind(body.kind);
    try {
      const q = await this.quotes.create(eventId, kind, parseBody(body));
      (req as any).flash('success', `Quotation ${formatQuoteNumber(q.serial)} saved.`);
      return res.redirect(`/quotations/${q.id}`);
    } catch (e: any) {
      return fail(req, res, e, `/events/${eventId}/quotations/new?kind=${kind}`);
    }
  }

  @Get('quotations/:id')
  @Render('quotations/show')
  async show(@Param('id') id: string) {
    const quotation = await this.quotes.findOrThrow(id);
    return {
      title: quotation.number,
      quotation,
      isMain: quotation.kind === 'MAIN',
      invoiceNumber: quotation.invoice ? formatSerial(quotation.invoice.serial) : null,
      rates: this.rates(),
    };
  }

  @Get('quotations/:id/edit')
  @Render('quotations/form')
  async editPage(@Param('id') id: string) {
    const q = await this.quotes.findOrThrow(id);
    return {
      title: `Edit ${q.number}`,
      event: q.event,
      kind: q.kind,
      isMain: q.kind === 'MAIN',
      editing: true,
      locked: !!q.invoiceId,
      action: `/quotations/${id}`,
      cancelHref: `/quotations/${id}`,
      q: { distanceKm: Number(q.distanceKm), pax: q.pax, pricePerPax: Number(q.pricePerPax), notes: q.notes ?? '' },
      items: q.items.map((i) => ({ description: i.description, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice) })),
      rates: this.rates(),
    };
  }

  @Post('quotations/:id')
  async update(@Param('id') id: string, @Body() body: Record<string, any>, @Req() req: Request, @Res() res: Response) {
    try {
      await this.quotes.update(id, parseBody(body));
      (req as any).flash('success', 'Quotation updated.');
      return res.redirect(`/quotations/${id}`);
    } catch (e: any) {
      return fail(req, res, e, `/quotations/${id}/edit`);
    }
  }

  @Post('quotations/:id/delete')
  async remove(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const q = await this.quotes.remove(id);
    (req as any).flash('success', `Quotation ${q.number} deleted.`);
    return res.redirect(`/events/${q.eventId}`);
  }

  @Post('quotations/:id/convert')
  async convert(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    try {
      const inv = await this.quotes.convertToInvoice(id);
      (req as any).flash('success', `Invoice ${formatSerial(inv.serial)} created from quotation.`);
      return res.redirect(`/invoices/${inv.id}`);
    } catch (e: any) {
      return fail(req, res, e, `/quotations/${id}`);
    }
  }
}
