import { randomBytes } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus, Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto, PublicBookingDto, UpdateEventDto } from './dto/event.dto';

export const NEW_CLIENT = '__new__';
export const EVENT_SORT_FIELDS = ['clientName', 'eventDate', 'pax', 'ingressTime', 'barOpenTime', 'status'] as const;
export type EventSortField = (typeof EVENT_SORT_FIELDS)[number];

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    status?: BookingStatus | BookingStatus[],
    page = 1,
    sort: EventSortField = 'eventDate',
    dir: 'asc' | 'desc' = 'desc',
    pageSize = 20,
  ) {
    const where = status ? { status: Array.isArray(status) ? { in: status } : status } : undefined;
    const total = await this.prisma.event.count({ where });
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
    const items = await this.prisma.event.findMany({
      where,
      orderBy: [{ [sort]: dir }, { id: 'asc' }],
      skip: (current - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page: current, pages };
  }

  async findOrThrow(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        transactions: { orderBy: { occurredAt: 'desc' } },
        client: true,
        quotations: { orderBy: { serial: 'asc' }, include: { invoice: { select: { id: true, serial: true } } } },
        menu: { select: { id: true, title: true, subtitle: true, updatedAt: true } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  clientOptions() {
    return this.prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }

  async create(dto: CreateEventDto) {
    return this.prisma.$transaction(async (tx) => {
      let clientId: string | null = dto.clientId || null;
      if (clientId === NEW_CLIENT) {
        const client = await tx.client.create({
          data: {
            name: dto.clientName.trim(),
            email: dto.newClientEmail?.trim() || null,
            phone: dto.newClientPhone?.trim() || null,
            company: dto.newClientCompany?.trim() || null,
          },
        });
        clientId = client.id;
      }
      return tx.event.create({
        data: {
          clientName: dto.clientName,
          eventDate: new Date(dto.eventDate),
          pax: dto.pax,
          barOpenTime: dto.barOpenTime,
          ingressTime: dto.ingressTime,
          venue: dto.venue.trim(),
          contactName: dto.contactName.trim(),
          contactPhone: dto.contactPhone.trim(),
          notes: dto.notes,
          clientId,
          status: BookingStatus.PENDING,
          source: 'admin',
        },
      });
    });
  }

  /** True if the token exists and hasn't been used yet. */
  async isLinkUsable(token: string) {
    const link = await this.prisma.bookingLink.findUnique({ where: { token } });
    return !!link && !link.usedAt;
  }

  /**
   * Consumes a single-use booking link and creates the event in one transaction.
   * Returns null if the link is unknown or already used (nothing is created).
   */
  createPublic(token: string, dto: PublicBookingDto) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.bookingLink.updateMany({
        where: { token, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (!claimed.count) return null;
      const event = await tx.event.create({
        data: {
          clientName: dto.clientName,
          eventDate: new Date(dto.eventDate),
          pax: dto.pax,
          barOpenTime: dto.barOpenTime,
          ingressTime: dto.ingressTime,
          venue: dto.venue.trim(),
          contactName: dto.contactName.trim(),
          contactPhone: dto.contactPhone.trim(),
          notes: dto.notes,
          status: BookingStatus.PENDING,
          source: 'public',
        },
      });
      await tx.bookingLink.update({ where: { token }, data: { eventId: event.id } });
      return event;
    });
  }

  listLinks() {
    return this.prisma.bookingLink.findMany({
      orderBy: { createdAt: 'desc' },
      include: { event: { select: { id: true, clientName: true } } },
    });
  }

  createLink(label?: string) {
    return this.prisma.bookingLink.create({
      data: { token: randomBytes(24).toString('base64url'), label: label?.trim() || null },
    });
  }

  deleteLink(id: string) {
    return this.prisma.bookingLink.deleteMany({ where: { id } });
  }

  update(id: string, dto: UpdateEventDto) {
    const data: Prisma.EventUpdateInput = {
      clientName: dto.clientName,
      eventDate: new Date(dto.eventDate),
      pax: dto.pax,
      barOpenTime: dto.barOpenTime,
      ingressTime: dto.ingressTime,
      venue: dto.venue.trim(),
      contactName: dto.contactName.trim(),
      contactPhone: dto.contactPhone.trim(),
      notes: dto.notes,
      status: dto.status,
      client: dto.clientId === undefined ? undefined : dto.clientId ? { connect: { id: dto.clientId } } : { disconnect: true },
    };
    return this.prisma.event.update({ where: { id }, data });
  }

  async remove(id: string) {
    const count = await this.prisma.transaction.count({ where: { eventId: id } });
    if (count > 0) {
      throw new BadRequestException(
        `Cannot delete: ${count} transaction(s) are allocated to this event. Remove them first, or mark the event CANCELLED.`,
      );
    }
    return this.prisma.event.delete({ where: { id } });
  }

  async pnl(id: string) {
    const event = await this.findOrThrow(id);
    let income = 0;
    let expense = 0;
    for (const t of event.transactions) {
      if (t.type === TransactionType.INCOME) income += Number(t.amount);
      else if (t.type === TransactionType.EXPENSE) expense += Number(t.amount);
    }
    return { income, expense, net: Math.round((income - expense) * 100) / 100 };
  }
}
