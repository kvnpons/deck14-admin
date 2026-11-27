import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClientDto } from './dto/client.dto';

const blank = (s?: string) => s?.trim() || null;

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q?: string) {
    const term = q?.trim();
    const clients = await this.prisma.client.findMany({
      where: term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { email: { contains: term, mode: 'insensitive' } },
              { phone: { contains: term } },
              { company: { contains: term, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { name: 'asc' },
      include: { _count: { select: { events: true } } },
    });
    return clients;
  }

  async findOrThrow(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        events: { orderBy: { eventDate: 'desc' } },
        invoices: { orderBy: { serial: 'desc' } },
      },
    });
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  private data(dto: ClientDto) {
    return {
      name: dto.name.trim(),
      email: blank(dto.email),
      phone: blank(dto.phone),
      company: blank(dto.company),
      notes: blank(dto.notes),
    };
  }

  create(dto: ClientDto) {
    return this.prisma.client.create({ data: this.data(dto) });
  }

  async update(id: string, dto: ClientDto) {
    await this.findOrThrow(id);
    return this.prisma.client.update({ where: { id }, data: this.data(dto) });
  }

  async remove(id: string) {
    const [events, invoices] = await Promise.all([
      this.prisma.event.count({ where: { clientId: id } }),
      this.prisma.invoice.count({ where: { clientId: id } }),
    ]);
    if (events > 0 || invoices > 0) {
      throw new BadRequestException(
        `Cannot delete: client has ${events} event(s) and ${invoices} invoice(s). Reassign or delete them first.`,
      );
    }
    return this.prisma.client.delete({ where: { id } });
  }
}
