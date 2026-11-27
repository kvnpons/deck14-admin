import { Body, Controller, Get, Param, Post, Render, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { EventsService } from './events.service';

@Controller('booking-links')
export class BookingLinksController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @Render('events/booking-links')
  async index(@Req() req: Request) {
    const proto = (req.get('x-forwarded-proto') || req.protocol).split(',')[0];
    const origin = `${proto}://${req.get('host')}`;
    const links = (await this.events.listLinks()).map((l) => ({ ...l, url: `${origin}/book/${l.token}`, used: !!l.usedAt }));
    return { title: 'Booking links', links };
  }

  @Post()
  async create(@Body('label') label: string, @Req() req: Request, @Res() res: Response) {
    await this.events.createLink(label);
    (req as any).flash('success', 'Single-use link created.');
    return res.redirect('/booking-links');
  }

  @Post(':id/delete')
  async remove(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    await this.events.deleteLink(id);
    (req as any).flash('success', 'Link removed.');
    return res.redirect('/booking-links');
  }
}
