import { Injectable } from '@nestjs/common';
import { BookingStatus, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface FundSummary {
  income: number;
  expense: number;
  loans: number;
  pettyCash: number;
  mainFund: number; // income - expense - outstanding loans - petty cash
}

export interface DateRange {
  from: Date;
  to: Date; // inclusive end of day
}

export interface EventPnL {
  id: string;
  clientName: string;
  eventDate: Date;
  status: BookingStatus;
  income: number;
  expense: number;
  net: number;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getTopPendingBookings(limit = 10) {
    return this.prisma.event.findMany({
      where: { status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] } },
      orderBy: { eventDate: 'asc' },
      take: limit,
    });
  }

  async getFundSummary(range: DateRange): Promise<FundSummary> {
    const grouped = await this.prisma.transaction.groupBy({
      by: ['type'],
      where: { occurredAt: { gte: range.from, lte: range.to } },
      _sum: { amount: true },
    });

    const totals: Record<TransactionType, number> = {
      INCOME: 0,
      EXPENSE: 0,
      LOAN: 0,
      PETTY_CASH: 0,
    };
    for (const row of grouped) {
      totals[row.type] = Number(row._sum.amount ?? 0);
    }

    const mainFund = totals.INCOME - totals.EXPENSE - totals.LOAN - totals.PETTY_CASH;

    return {
      income: totals.INCOME,
      expense: totals.EXPENSE,
      loans: totals.LOAN,
      pettyCash: totals.PETTY_CASH,
      mainFund,
    };
  }

  async getEventsPnL(range: DateRange): Promise<{ rows: EventPnL[]; totals: { income: number; expense: number; net: number } }> {
    const [events, grouped] = await Promise.all([
      this.prisma.event.findMany({
        where: { eventDate: { gte: range.from, lte: range.to } },
        orderBy: { eventDate: 'desc' },
      }),
      this.prisma.transaction.groupBy({
        by: ['eventId', 'type'],
        where: {
          eventId: { not: null },
          event: { is: { eventDate: { gte: range.from, lte: range.to } } },
          type: { in: [TransactionType.INCOME, TransactionType.EXPENSE] },
        },
        _sum: { amount: true },
      }),
    ]);

    const sums = new Map<string, { income: number; expense: number }>();
    for (const g of grouped) {
      const e = sums.get(g.eventId) || { income: 0, expense: 0 };
      const v = Number(g._sum.amount ?? 0);
      if (g.type === TransactionType.INCOME) e.income = v;
      else e.expense = v;
      sums.set(g.eventId, e);
    }

    const rows = events.map((e) => {
      const { income, expense } = sums.get(e.id) || { income: 0, expense: 0 };
      return {
        id: e.id,
        clientName: e.clientName,
        eventDate: e.eventDate,
        status: e.status,
        income,
        expense,
        net: Math.round((income - expense) * 100) / 100,
      };
    });

    const income = rows.reduce((a, r) => a + r.income, 0);
    const expense = rows.reduce((a, r) => a + r.expense, 0);
    return { rows, totals: { income, expense, net: Math.round((income - expense) * 100) / 100 } };
  }
}
