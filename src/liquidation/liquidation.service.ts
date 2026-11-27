import { BadRequestException, Injectable } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionDto } from './dto/transaction.dto';

export interface EmployeeLedger {
  employeeName: string;
  loans: number;
  pettyCash: number;
  total: number;
}

@Injectable()
export class LiquidationService {
  constructor(private readonly prisma: PrismaService) {}

  listTransactions(filter: { type?: TransactionType; eventId?: string } = {}) {
    return this.prisma.transaction.findMany({
      where: {
        ...(filter.type && { type: filter.type }),
        ...(filter.eventId && { eventId: filter.eventId }),
      },
      orderBy: { occurredAt: 'desc' },
      include: { event: true },
    });
  }

  listEventsForSelect() {
    return this.prisma.event.findMany({
      orderBy: { eventDate: 'desc' },
      select: { id: true, clientName: true, eventDate: true, status: true },
    });
  }

  async create(dto: CreateTransactionDto) {
    const eventOnly =
      dto.type === TransactionType.INCOME || dto.type === TransactionType.EXPENSE;
    const employeeOnly =
      dto.type === TransactionType.LOAN || dto.type === TransactionType.PETTY_CASH;

    if (eventOnly) {
      const event = await this.prisma.event.findUnique({ where: { id: dto.eventId } });
      if (!event) throw new BadRequestException('Selected event does not exist');
    }

    return this.prisma.transaction.create({
      data: {
        type: dto.type,
        amount: dto.amount,
        description: dto.description,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
        eventId: eventOnly ? dto.eventId : null,
        employeeName: employeeOnly ? dto.employeeName : null,
      },
    });
  }

  remove(id: string) {
    return this.prisma.transaction.delete({ where: { id } });
  }

  async employeeLedger(): Promise<EmployeeLedger[]> {
    const rows = await this.prisma.transaction.groupBy({
      by: ['employeeName', 'type'],
      where: {
        type: { in: [TransactionType.LOAN, TransactionType.PETTY_CASH] },
        employeeName: { not: null },
      },
      _sum: { amount: true },
    });

    const map = new Map<string, EmployeeLedger>();
    for (const row of rows) {
      const name = row.employeeName!;
      const entry = map.get(name) || { employeeName: name, loans: 0, pettyCash: 0, total: 0 };
      const amount = Number(row._sum.amount ?? 0);
      if (row.type === TransactionType.LOAN) entry.loans = amount;
      if (row.type === TransactionType.PETTY_CASH) entry.pettyCash = amount;
      entry.total = entry.loans + entry.pettyCash;
      map.set(name, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }
}
