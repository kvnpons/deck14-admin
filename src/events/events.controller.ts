import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Render,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { BookingStatus } from '@prisma/client';
import { EVENT_SORT_FIELDS, EventSortField, EventsService } from './events.service';
import { CreateEventDto, UpdateEventDto } from './dto/event.dto';

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @Render('events/index')
  async index(
    @Query('status') statusParam?: string,
    @Query('page') page?: string,
    @Query('sort') sortParam?: string,
    @Query('dir') dirParam?: string,
  ) {
    const valid = Object.values(BookingStatus) as string[];
    const statuses = (statusParam || '').split(',').filter((v) => valid.includes(v)) as BookingStatus[];
    const status = statuses.length ? statuses.join(',') : undefined;
    const sort: EventSortField = (EVENT_SORT_FIELDS as readonly string[]).includes(sortParam || '')
      ? (sortParam as EventSortField)
      : 'eventDate';
    const dir: 'asc' | 'desc' = dirParam === 'asc' ? 'asc' : 'desc';
    const result = await this.events.list(statuses.length > 1 ? statuses : statuses[0], Number(page) || 1, sort, dir);
    const qs = (extra: Record<string, string | number>) =>
      Object.entries({ status: status || '', sort, dir, ...extra })
        .filter(([, v]) => v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&');
    const columns = Object.fromEntries(
      EVENT_SORT_FIELDS.map((f) => [
        f,
        {
          href: `/events?${qs({ sort: f, dir: sort === f && dir === 'asc' ? 'desc' : 'asc', page: 1 })}`,
          arrow: sort === f ? (dir === 'asc' ? '▲' : '▼') : '',
        },
      ]),
    );
    return {
      columns,
      sort,
      dir,
      title: 'Events',
      events: result.items,
      statusFilter: status || "",
      page: result.page,
      pages: result.pages,
      total: result.total,
      hasPrev: result.page > 1,
      hasNext: result.page < result.pages,
      prevQuery: qs({ page: result.page - 1 }),
      nextQuery: qs({ page: result.page + 1 }),
    };
  }

  @Get('new')
  @Render('events/new')
  async newPage() {
    return { title: 'Schedule event', clients: await this.events.clientOptions() };
  }

  @Post()
  async create(@Body() dto: CreateEventDto, @Req() req: Request, @Res() res: Response) {
    const event = await this.events.create(dto);
    (req as any).flash('success', `Event for ${event.clientName} scheduled.`);
    return res.redirect(`/events/${event.id}`);
  }

  @Get(':id')
  @Render('events/show')
  async show(@Param('id') id: string) {
    const event = await this.events.findOrThrow(id);
    const pnl = await this.events.pnl(id);
    const hasMainQuote = event.quotations.some((q) => q.kind === 'MAIN');
    return { title: event.clientName, event, pnl, hasMainQuote };
  }

  @Get(':id/edit')
  @Render('events/edit')
  async editPage(@Param('id') id: string) {
    const event = await this.events.findOrThrow(id);
    return {
      title: `Edit — ${event.clientName}`,
      event,
      statuses: Object.values(BookingStatus),
      clients: (await this.events.clientOptions()).map((c) => ({
        ...c,
        selected: c.id === event.clientId,
      })),
    };
  }

  @Post(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.events.update(id, dto);
    (req as any).flash('success', 'Event updated.');
    return res.redirect(`/events/${id}`);
  }

  @Post(':id/delete')
  async remove(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    await this.events.remove(id);
    (req as any).flash('success', 'Event deleted.');
    return res.redirect('/events');
  }
}
