/**
 * One-time import of the legacy booking-form CSV (data-migration/Client_events.csv).
 * Builds Client profiles and cross-matches every row against the events that
 * already exist in the database (mostly placeholders from the liquidation import).
 *
 *   npm run import:client-events                 # dry run, prints the plan only
 *   npm run import:client-events -- --apply      # write to the database
 *   npm run import:client-events -- --file path/to.csv
 *
 * Matching rules (per event date, UTC midnight)
 *  1. A CSV row is paired with an existing event on the same date. When several
 *     candidates share a date, pairs are ranked by: already linked in a previous run,
 *     same client name, same pax, then CSV order.
 *  2. Paired event from the liquidation import (source "migration"): overwritten with
 *     the CSV data (client, pax, times, venue, type, status, notes). Any other event
 *     (admin/public): only linked to the client and filled in where venue/type/payment
 *     are empty — nothing the team typed in is overwritten.
 *  3. CSV row with no event on its date: inserted as a new event on that date.
 *  4. Existing event whose date matches no CSV row: linked to the client of the nearest
 *     CSV event date, but only within NEAREST_WINDOW_DAYS (typo'd dates, multi-day
 *     events). Further away it stays unlinked — the liquidation data goes back to 2022,
 *     long before the first CSV row, and linking those would attach the wrong client.
 *
 * Clients are de-duplicated by mobile number (falling back to email, then name), so
 * "Moses Galang" / "Moises Galang" with the same number become one profile.
 *
 * Idempotent: clients get `csv-cli-<key>` ids, inserted events `csv-evt-<csv line>`;
 * existing client profiles are never modified by a re-run.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { BookingStatus, PrismaClient } from '@prisma/client';
import { parseCsv } from './csv';

const DEFAULT_FILE = 'data-migration/Client_events.csv';
const NEAREST_WINDOW_DAYS = 3;
const DAY_MS = 86_400_000;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const STATUS_MAP: Record<string, BookingStatus> = {
  upcoming: BookingStatus.CONFIRMED,
  completed: BookingStatus.COMPLETED,
  cancelled: BookingStatus.CANCELLED,
};

interface CsvEvent {
  line: number;
  date: Date;
  clientKey: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  venue: string | null;
  eventType: string | null;
  paymentStatus: string | null;
  pax: number;
  barOpenTime: string | null;
  ingressTime: string | null;
  status: BookingStatus;
  notes: string | null;
}

interface ClientPlan {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
}

interface ExistingEvent {
  id: string;
  clientName: string;
  eventDate: Date;
  pax: number;
  source: string | null;
  clientId: string | null;
  venue: string | null;
  eventType: string | null;
  paymentStatus: string | null;
}

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim() || null;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

function parseDate(s: string): Date | null {
  const m = s.trim().match(/^([A-Za-z]{3})[a-z]* (\d{1,2}), (\d{4})$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  const d = new Date(Date.UTC(Number(m[3]), month, Number(m[2])));
  return d.getUTCDate() === Number(m[2]) ? d : null;
}

/** "05:00 PM" -> "17:00". Placeholders such as ": PM" return null. */
function parseTime(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2}):(\d\d) ?(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/** Stable identity for a mobile number: first PH mobile found, else bare digits. */
function phoneKey(raw: string | null): string | null {
  if (!raw) return null;
  const collapsed = raw.replace(/[\s\-().]/g, '');
  const ph = collapsed.match(/^(?:\+?63|0)?(9\d{9})/);
  if (ph) return ph[1];
  const digits = collapsed.replace(/\D/g, '');
  return digits.length >= 7 ? digits : null;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const nameTokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 2));

export function loadCsv(file: string) {
  const rows = parseCsv(readFileSync(file, 'utf-8'));
  const header = rows[0].map((h) => h.trim());
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Column "${name}" not found in CSV header`);
    return i;
  };
  const C = {
    date: col('Event Date'), bar: col('Bar Open'), ingress: col('Ingress Time'),
    venue: col('Venue address'), name: col('Name:'), notes: col('Other notes:'),
    type: col('Type of event'), payment: col('Payment Status'), status: col('Event Status'),
    phone: col('Mobile No.'), company: col('Company Name (Optional)'),
    pax: col('Number of Pax'), email: col('Email'),
  };

  const events: CsvEvent[] = [];
  const skipped: { line: number; reason: string }[] = [];
  rows.forEach((r, idx) => {
    if (idx === 0 || !r.some((c) => c.trim())) return;
    const line = idx + 1;
    const date = parseDate(r[C.date] ?? '');
    const name = clean(r[C.name]);
    if (!date) return void skipped.push({ line, reason: `invalid event date "${r[C.date]}"` });
    if (!name) return void skipped.push({ line, reason: 'missing name' });
    const status = STATUS_MAP[(r[C.status] ?? '').trim().toLowerCase()];
    if (!status) return void skipped.push({ line, reason: `unknown event status "${r[C.status]}"` });

    const phone = clean(r[C.phone]);
    const email = clean(r[C.email])?.toLowerCase() ?? null;
    const clientKey = phoneKey(phone) ?? email ?? slug(name);
    events.push({
      line, date, clientKey, name, email, phone,
      company: clean(r[C.company]),
      venue: clean(r[C.venue]),
      eventType: clean(r[C.type]),
      paymentStatus: clean(r[C.payment]),
      pax: Math.max(0, parseInt(r[C.pax], 10) || 0),
      barOpenTime: parseTime(r[C.bar] ?? ''),
      ingressTime: parseTime(r[C.ingress] ?? ''),
      status,
      // Many rows just repeat the event date; that carries no information.
      notes: (() => {
        const n = (r[C.notes] ?? '').trim();
        return n && isNaN(Date.parse(n)) ? n : null;
      })(),
    });
  });
  return { events, skipped };
}

/** One profile per clientKey. Most recent booking supplies the display details. */
export function buildClients(events: CsvEvent[]) {
  const newestFirst = [...events].sort((a, b) => b.date.getTime() - a.date.getTime() || b.line - a.line);
  const clients = new Map<string, ClientPlan>();
  for (const e of newestFirst) {
    const c = clients.get(e.clientKey);
    if (!c) {
      clients.set(e.clientKey, {
        id: `csv-cli-${slug(e.clientKey)}`,
        name: e.name, email: e.email, phone: e.phone, company: e.company,
      });
    } else {
      c.email ??= e.email;
      c.phone ??= e.phone;
      c.company ??= e.company;
    }
  }
  return clients;
}

interface Plan {
  updates: { event: ExistingEvent; row: CsvEvent; overwrite: boolean }[];
  inserts: CsvEvent[];
  nearest: { event: ExistingEvent; row: CsvEvent; days: number }[];
  unlinked: ExistingEvent[];
}

export function planMatches(rows: CsvEvent[], existing: ExistingEvent[], clients: Map<string, ClientPlan>): Plan {
  const plan: Plan = { updates: [], inserts: [], nearest: [], unlinked: [] };
  const rowsByDay = new Map<string, CsvEvent[]>();
  const eventsByDay = new Map<string, ExistingEvent[]>();
  const push = <T>(m: Map<string, T[]>, k: string, v: T) => m.set(k, [...(m.get(k) ?? []), v]);
  rows.forEach((r) => push(rowsByDay, dayKey(r.date), r));
  existing.forEach((e) => push(eventsByDay, dayKey(e.eventDate), e));

  const paired = new Set<string>();
  for (const [day, dayRows] of rowsByDay) {
    const dayEvents = eventsByDay.get(day) ?? [];
    const candidates = dayRows.flatMap((row) =>
      dayEvents.map((event) => {
        const clientId = clients.get(row.clientKey)!.id;
        const a = nameTokens(row.name);
        const sameName = [...nameTokens(event.clientName)].some((t) => a.has(t));
        const score =
          (event.id === `csv-evt-${row.line}` ? 8 : 0) +
          (event.clientId === clientId ? 4 : 0) +
          (sameName ? 2 : 0) +
          (event.pax === row.pax && row.pax > 0 ? 1 : 0);
        return { row, event, score };
      }),
    );
    candidates.sort((x, y) => y.score - x.score || x.row.line - y.row.line);
    const usedRows = new Set<number>();
    const usedEvents = new Set<string>();
    for (const c of candidates) {
      if (usedRows.has(c.row.line) || usedEvents.has(c.event.id)) continue;
      usedRows.add(c.row.line);
      usedEvents.add(c.event.id);
      paired.add(c.event.id);
      plan.updates.push({ event: c.event, row: c.row, overwrite: c.event.source === 'migration' });
    }
    dayRows.filter((r) => !usedRows.has(r.line)).forEach((r) => plan.inserts.push(r));
  }

  for (const event of existing) {
    if (paired.has(event.id)) continue;
    let best: { row: CsvEvent; days: number } | null = null;
    for (const row of rows) {
      const days = Math.abs(row.date.getTime() - event.eventDate.getTime()) / DAY_MS;
      if (!best || days < best.days) best = { row, days };
    }
    if (best && best.days <= NEAREST_WINDOW_DAYS) plan.nearest.push({ event, ...best });
    else plan.unlinked.push(event);
  }
  return plan;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const fileArg = args.indexOf('--file');
  const file = resolve(fileArg >= 0 ? args[fileArg + 1] : DEFAULT_FILE);

  const { events: rows, skipped } = loadCsv(file);
  const clients = buildClients(rows);

  const prisma = new PrismaClient();
  try {
    const existing: ExistingEvent[] = await prisma.event.findMany({
      select: {
        id: true, clientName: true, eventDate: true, pax: true, source: true,
        clientId: true, venue: true, eventType: true, paymentStatus: true,
      },
    });
    const plan = planMatches(rows, existing, clients);
    const fmt = (d: Date) => dayKey(d);

    console.log(`File: ${file}`);
    console.log(`CSV rows: ${rows.length} (skipped ${skipped.length})`);
    skipped.forEach((s) => console.log(`  line ${s.line}: ${s.reason}`));
    console.log(`Client profiles: ${clients.size}`);
    console.log(`Existing events in DB: ${existing.length}`);
    console.log(`  matched on date, to update:      ${plan.updates.length}`);
    console.log(`  linked to nearest date (±${NEAREST_WINDOW_DAYS}d):  ${plan.nearest.length}`);
    plan.nearest.forEach((n) =>
      console.log(`    ${fmt(n.event.eventDate)} "${n.event.clientName}" -> ${fmt(n.row.date)} ${n.row.name} (${n.days}d)`),
    );
    console.log(`  left unlinked (no CSV row close): ${plan.unlinked.length}`);
    console.log(`CSV rows with no event, to insert: ${plan.inserts.length}`);
    plan.inserts.forEach((r) => console.log(`    ${fmt(r.date)} ${r.name} (${r.status})`));

    if (!apply) {
      console.log('\nDry run only. Re-run with --apply to write to the database.');
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      for (const c of clients.values()) {
        await tx.client.upsert({
          where: { id: c.id },
          create: { id: c.id, name: c.name, email: c.email, phone: c.phone, company: c.company },
          update: {},
        });
      }
      for (const { event, row, overwrite } of plan.updates) {
        const clientId = clients.get(row.clientKey)!.id;
        await tx.event.update({
          where: { id: event.id },
          data: overwrite
            ? {
                clientId,
                clientName: row.name,
                pax: row.pax || event.pax,
                ...(row.barOpenTime && { barOpenTime: row.barOpenTime }),
                ...(row.ingressTime && { ingressTime: row.ingressTime }),
                venue: row.venue,
                eventType: row.eventType,
                paymentStatus: row.paymentStatus,
                status: row.status,
                notes: row.notes,
              }
            : {
                clientId,
                venue: event.venue ?? row.venue,
                eventType: event.eventType ?? row.eventType,
                paymentStatus: event.paymentStatus ?? row.paymentStatus,
              },
        });
      }
      for (const { event, row } of plan.nearest) {
        await tx.event.update({
          where: { id: event.id },
          data: {
            clientId: clients.get(row.clientKey)!.id,
            ...(event.source === 'migration' && { clientName: row.name }),
          },
        });
      }
      const created = await tx.event.createMany({
        skipDuplicates: true,
        data: plan.inserts.map((r) => ({
          id: `csv-evt-${r.line}`,
          clientId: clients.get(r.clientKey)!.id,
          clientName: r.name,
          eventDate: r.date,
          pax: r.pax,
          barOpenTime: r.barOpenTime ?? '00:00',
          ingressTime: r.ingressTime ?? '00:00',
          venue: r.venue,
          eventType: r.eventType,
          paymentStatus: r.paymentStatus,
          status: r.status,
          source: 'migration',
          notes: r.notes,
        })),
      });
      return created.count;
    });
    console.log(
      `\nApplied: ${clients.size} client profiles ensured, ${plan.updates.length} events updated, ` +
        `${plan.nearest.length} linked by nearest date, ${result} events inserted.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
