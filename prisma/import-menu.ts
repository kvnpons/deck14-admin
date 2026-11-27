/**
 * One-time import of the legacy "Quotation Matrix" menu CSVs.
 *
 *   npm run import:menu                 # dry run, prints summary only
 *   npm run import:menu -- --apply      # write to the database
 *   npm run import:menu -- --dir path/to/csv-folder
 *
 * Files (in data-migration/):
 *   Quotation Matrix - CocktailList.csv   -> COCKTAIL         (incl. mocktails)
 *   Quotation Matrix - ShootersList.csv   -> COCKTAIL_SHOOTER
 *   Quotation Matrix - Highend Spirits.csv-> HARD_DRINK
 *
 * Mapping
 *  - name        <- "Cocktail name" / "Shooter name"
 *  - description <- Ingredients (plus the serving style for non-standard shooters)
 *  - price       <- 0. The CSVs have no prices; set them in the menu admin UI.
 *  - "Availability" is ignored (the schema has no such field and it is blank on
 *    some rows).
 *
 * Idempotent: ids are deterministic (`menu-<category>-<slug>`) and inserted with
 * skipDuplicates, so re-running never duplicates items.
 *
 * Highend Spirits: the file currently in the repo is a copy of the cocktail list,
 * not a spirits list. Any Highend row that duplicates a cocktail is skipped, so
 * nothing is imported from it until the file is replaced with real spirits data.
 */
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { MenuCategory, PrismaClient } from '@prisma/client';
import { parseCsv } from './csv';

const DEFAULT_DIR = 'data-migration';

// Order matters: Highend is checked against the cocktails loaded before it.
const SOURCES: { file: string; category: MenuCategory }[] = [
  { file: 'Quotation Matrix - CocktailList.csv', category: MenuCategory.COCKTAIL },
  { file: 'Quotation Matrix - ShootersList.csv', category: MenuCategory.COCKTAIL_SHOOTER },
  { file: 'Quotation Matrix - Highend Spirits.csv', category: MenuCategory.HARD_DRINK },
];

// Serving styles that are worth keeping in the description.
const SERVING_NOTES = new Set(['flaming lamborghini']);

interface Item {
  id: string;
  name: string;
  description: string;
  category: MenuCategory;
}

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const slug = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');

function load(dir: string) {
  const items: Item[] = [];
  const warnings: string[] = [];
  const cocktailNames = new Set<string>();

  for (const { file, category } of SOURCES) {
    const path = join(dir, file);
    if (!existsSync(path)) {
      warnings.push(`Missing file, skipped: ${file}`);
      continue;
    }
    const rows = parseCsv(readFileSync(path, 'utf-8')).slice(1); // drop header
    const seen = new Set<string>();
    let imported = 0;

    rows.forEach((raw, idx) => {
      if (!raw.some((c) => c.trim())) return;
      const line = idx + 2;
      const name = clean(raw[0]);
      const ingredients = clean(raw[1]);
      const style = clean(raw[2]);
      if (!name) return void warnings.push(`${file} line ${line}: empty name, skipped`);

      const key = name.toLowerCase();
      if (seen.has(key)) return void warnings.push(`${file} line ${line}: duplicate "${name}", skipped`);
      seen.add(key);

      if (category === MenuCategory.HARD_DRINK && cocktailNames.has(key)) {
        return void warnings.push(`${file} line ${line}: "${name}" is a cocktail, skipped`);
      }
      if (category === MenuCategory.COCKTAIL) cocktailNames.add(key);

      const note = SERVING_NOTES.has(style.toLowerCase()) ? ` (${style})` : '';
      items.push({
        id: `menu-${category.toLowerCase()}-${slug(name)}`,
        name,
        description: `${ingredients}${note}`,
        category,
      });
      imported++;
    });

    if (imported === 0) warnings.push(`${file}: nothing to import`);
  }
  return { items, warnings };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dirArg = args.indexOf('--dir');
  const dir = resolve(dirArg >= 0 ? args[dirArg + 1] : DEFAULT_DIR);

  const { items, warnings } = load(dir);
  console.log(`Directory: ${dir}`);
  for (const c of Object.values(MenuCategory)) {
    const n = items.filter((i) => i.category === c).length;
    if (n) console.log(`${c}: ${n}`);
  }
  console.log(`Total: ${items.length} (price set to 0 for all)`);
  if (warnings.length) {
    console.log(`Warnings (${warnings.length}):`);
    warnings.forEach((w) => console.log(`  ${w}`));
  }

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to write to the database.');
    return;
  }

  const prisma = new PrismaClient();
  try {
    const res = await prisma.menuItem.createMany({
      skipDuplicates: true,
      data: items.map((i) => ({ ...i, price: 0 })),
    });
    console.log(`\nInserted ${res.count} menu items (already-present items were skipped).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
