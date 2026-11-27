import { Controller, Get, Query, Render } from '@nestjs/common';
import { DashboardService, DateRange } from './dashboard.service';

const DAY = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function parseDay(v?: string): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

/** Resolve the requested range; defaults to the last year and is capped at one year. */
function resolveRange(fromQ?: string, toQ?: string): { range: DateRange; from: string; to: string; clamped: boolean } {
  const today = parseDay(iso(new Date()))!;
  let to = parseDay(toQ) ?? today;
  let from = parseDay(fromQ);
  if (!from) {
    from = new Date(to);
    from.setUTCFullYear(from.getUTCFullYear() - 1);
    from.setUTCDate(from.getUTCDate() + 1);
  }
  if (from > to) [from, to] = [to, from];
  const max = new Date(from);
  max.setUTCFullYear(max.getUTCFullYear() + 1);
  max.setUTCDate(max.getUTCDate() - 1);
  let clamped = false;
  if (to > max) {
    to = max;
    clamped = true;
  }
  return {
    range: { from, to: new Date(to.getTime() + DAY - 1) },
    from: iso(from),
    to: iso(to),
    clamped,
  };
}

@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('/')
  @Render('dashboard/index')
  async index(@Query('from') fromQ?: string, @Query('to') toQ?: string) {
    const { range, from, to, clamped } = resolveRange(fromQ, toQ);
    const [pending, funds, eventsPnL] = await Promise.all([
      this.dashboard.getTopPendingBookings(10),
      this.dashboard.getFundSummary(range),
      this.dashboard.getEventsPnL(range),
    ]);
    const chrono = [...eventsPnL.rows].reverse();
    const perMonth = new Map<string, number>();
    for (const r of chrono) {
      const k = new Date(r.eventDate).toISOString().slice(0, 7);
      perMonth.set(k, (perMonth.get(k) || 0) + 1);
    }
    const chartData = {
      months: [...perMonth.keys()],
      counts: [...perMonth.values()],
      labels: chrono.map(
        (r) => `${r.clientName} (${new Date(r.eventDate).toISOString().slice(0, 10)})`,
      ),
      income: chrono.map((r) => r.income),
    };
    return {
      title: 'Dashboard',
      from,
      to,
      clamped,
      chartData: JSON.stringify(chartData).replace(/</g, '\\u003c'),
      pending,
      funds,
      eventsPnL: eventsPnL.rows,
      eventsTotals: eventsPnL.totals,
    };
  }
}
