/**
 * One-time import of the legacy Google Form liquidation CSV (Income + Expense only).
 *
 *   npm run import:liquidation                 # dry run, prints summary only
 *   npm run import:liquidation -- --apply      # write to the database
 *   npm run import:liquidation -- --file path/to.csv
 *
 * Mapping
 *  - "Income" / "Expense" rows -> Transaction (INCOME / EXPENSE). Other types
 *    (Petty Cash Assign/Expense/Return) are ignored.
 *  - "Event Code" is MMDDYYYY (the event date). One placeholder Event is created
 *    per distinct code (the CSV has no client/pax/times). Rows without a code are
 *    imported with no event (overhead such as payroll, cups, repairs).
 *  - Timestamps are dd/mm/yyyy hh:mm:ss in Philippine time (UTC+8).
 *
 * Idempotent: rows/events get deterministic ids (`liq-<csv line>` / `liq-evt-<code>`)
 * and are inserted with skipDuplicates, so re-running never duplicates data.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient, TransactionType, BookingStatus } from '@prisma/client';
import { parseCsv } from './csv';

const DEFAULT_FILE = 'data-migration/Liquidation Form (Responses) - Copy of Form responses 1.csv';

// Known typos in Event Code, verified against surrounding rows.
const EVENT_CODE_FIXES: Record<string, string> = {
  '2222024': '02222024', // missing leading zero (description says 02222024)
  '1218224': '12182024', // typo; neighbouring Agdangan rows belong to 12/18/2024
};

const TYPE_MAP: Record<string, TransactionType> = {
  income: TransactionType.INCOME,
  expense: TransactionType.EXPENSE,
};

interface ParsedTx {
  id: string;
  line: number;
  type: TransactionType;
  amount: string;
  description: string;
  occurredAt: Date;
  eventCode: string | null;
}

const isAmount = (s: string) => /^\d[\d,]*(\.\d+)?$/.test(s.trim());

function parseTimestamp(s: string): Date | null {
  const m = s.trim().match(/^(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d):(\d\d)$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+08:00`);
  return isNaN(d.getTime()) ? null : d;
}

function eventDateFromCode(code: string): Date | null {
  const m = code.match(/^(\d\d)(\d\d)(\d{4})$/);
  if (!m) return null;
  const d = new Date(`${m[3]}-${m[1]}-${m[2]}T00:00:00Z`); // UTC midnight, like the app's date input
  return isNaN(d.getTime()) || d.getUTCMonth() + 1 !== Number(m[1]) ? null : d;
}

function load(file: string) {
  const rows = parseCsv(readFileSync(file, 'utf-8'));
  const txs: ParsedTx[] = [];
  const skipped: { line: number; reason: string; row: string[] }[] = [];
  let ignoredOtherTypes = 0;

  rows.forEach((raw, idx) => {
    if (idx === 0) return; // header
    const line = idx + 1;
    const [ts, typeRaw, descRaw, amountRaw, codeRaw] = raw.map((c) => (c ?? '').trim());
    if (!raw.some((c) => c.trim())) return; // blank row

    const type = TYPE_MAP[typeRaw.toLowerCase()];
    if (!type) { ignoredOtherTypes++; return; }

    let description = descRaw;
    let amountStr = amountRaw;
    // Some rows have description and amount swapped.
    if (!isAmount(amountStr) && isAmount(description)) [description, amountStr] = [amountStr, description];

    if (!isAmount(amountStr)) return skipped.push({ line, reason: 'invalid amount', row: raw }) as unknown as void;
    const amount = Number(amountStr.replace(/,/g, ''));
    if (!(amount >= 0.01)) return skipped.push({ line, reason: 'zero amount', row: raw }) as unknown as void;
    if (!description) return skipped.push({ line, reason: 'empty description', row: raw }) as unknown as void;

    const occurredAt = parseTimestamp(ts);
    if (!occurredAt) return skipped.push({ line, reason: 'invalid timestamp', row: raw }) as unknown as void;

    let eventCode: string | null = codeRaw ? EVENT_CODE_FIXES[codeRaw] ?? codeRaw : null;
    if (eventCode && !eventDateFromCode(eventCode)) {
      return skipped.push({ line, reason: `invalid event code "${codeRaw}"`, row: raw }) as unknown as void;
    }

    txs.push({
      id: `liq-${line}`,
      line,
      type,
      amount: amount.toFixed(2),
      description,
      occurredAt,
      eventCode,
    });
  });

  return { txs, skipped, ignoredOtherTypes };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const fileArg = args.indexOf('--file');
  const file = resolve(fileArg >= 0 ? args[fileArg + 1] : DEFAULT_FILE);

  const { txs, skipped, ignoredOtherTypes } = load(file);
  const codes = [...new Set(txs.map((t) => t.eventCode).filter(Boolean))].sort() as string[];
  const sum = (type: TransactionType) =>
    txs.filter((t) => t.type === type).reduce((a, t) => a + Number(t.amount), 0);

  console.log(`File: ${file}`);
  console.log(`Income:  ${txs.filter((t) => t.type === 'INCOME').length} rows, total ${sum('INCOME').toFixed(2)}`);
  console.log(`Expense: ${txs.filter((t) => t.type === 'EXPENSE').length} rows, total ${sum('EXPENSE').toFixed(2)}`);
  console.log(`Without event: ${txs.filter((t) => !t.eventCode).length} rows`);
  console.log(`Events to create: ${codes.length}`);
  console.log(`Ignored (other transaction types): ${ignoredOtherTypes}`);
  console.log(`Skipped (bad data): ${skipped.length}`);
  skipped.forEach((s) => console.log(`  line ${s.line}: ${s.reason} -> ${JSON.stringify(s.row)}`));

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to write to the database.');
    return;
  }

  const prisma = new PrismaClient();
  try {
    const result = await prisma.$transaction(async (tx) => {
      const events = await tx.event.createMany({
        skipDuplicates: true,
        data: codes.map((code) => ({
          id: `liq-evt-${code}`,
          clientName: `Imported event ${code}`,
          eventDate: eventDateFromCode(code)!,
          pax: 0,
          barOpenTime: '00:00',
          ingressTime: '00:00',
          status: BookingStatus.COMPLETED,
          source: 'migration',
          notes: 'Placeholder created by liquidation CSV import. Update client, pax and times.',
        })),
      });
      const transactions = await tx.transaction.createMany({
        skipDuplicates: true,
        data: txs.map((t) => ({
          id: t.id,
          type: t.type,
          amount: t.amount,
          description: t.description,
          occurredAt: t.occurredAt,
          eventId: t.eventCode ? `liq-evt-${t.eventCode}` : null,
        })),
      });
      return { events: events.count, transactions: transactions.count };
    });
    console.log(
      `\nInserted ${result.events} events and ${result.transactions} transactions ` +
        `(already-present rows were skipped).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
