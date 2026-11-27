import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MenuCategory } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_BG_PATH = join(__dirname, '..', 'assets', 'menu-bg.png');
let defaultBg: Buffer | undefined;
function getDefaultBackground(): Buffer | undefined {
  if (!defaultBg && existsSync(DEFAULT_BG_PATH)) defaultBg = readFileSync(DEFAULT_BG_PATH);
  return defaultBg;
}

export const BUILDER_LIMITS = {
  cocktails: { min: 5, max: 10 },
  shooters: { min: 3, max: 5 },
};

export interface BuilderInput {
  title: string;
  subtitle: string;
  cocktailIds: string[];
  shooterIds: string[];
  background?: Buffer;
  fontFamily?: string;
  accentColor?: string;
  textColor?: string;
  /** Opacity (0-1) of the dark panel behind the text when a background image is used. */
  overlayOpacity?: number;
}

/** PDFKit built-in font families (regular, bold, italic). */
export const FONT_FAMILIES: Record<string, { label: string; regular: string; bold: string; italic: string }> = {
  helvetica: { label: 'Helvetica (sans-serif)', regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique' },
  times: { label: 'Times (serif)', regular: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic' },
  courier: { label: 'Courier (monospace)', regular: 'Courier', bold: 'Courier-Bold', italic: 'Courier-Oblique' },
};

export const BUILDER_DEFAULTS = {
  title: 'Deck 14',
  subtitle: 'Cocktail Menu',
  fontFamily: 'helvetica',
  accentColor: '#c9a45c',
  textColor: '#f3e9d2',
  overlayOpacity: 0.62,
};

interface Style {
  fonts: { regular: string; bold: string; italic: string };
  accent: string;
  text: string;
  overlay: number;
}

interface MenuLine {
  name: string;
  description: string;
  price: number;
}

// A4 in PDF points
const W = 595.28;
const H = 841.89;
const CONTENT_W = 400;
const PAGE_MARGIN = 70;
const TOP_CLEARANCE = 216; // 3 inches in PDF points

const COLORS = {
  bg: '#14110f',
};

@Injectable()
export class MenuBuilderService {
  constructor(private readonly prisma: PrismaService) {}

  async listForBuilder() {
    const [cocktails, shooters] = await Promise.all([
      this.prisma.menuItem.findMany({
        where: { category: MenuCategory.COCKTAIL },
        orderBy: { name: 'asc' },
      }),
      this.prisma.menuItem.findMany({
        where: { category: MenuCategory.COCKTAIL_SHOOTER },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { cocktails, shooters };
  }

  /** Loads items for the given ids (must be of the category), keeping the submitted order. */
  private async load(ids: string[], category: MenuCategory, label: string): Promise<MenuLine[]> {
    const unique = [...new Set(ids)];
    const rows = await this.prisma.menuItem.findMany({
      where: { id: { in: unique }, category },
    });
    if (rows.length !== unique.length) {
      throw new BadRequestException(`Some selected ${label} no longer exist`);
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    return unique.map((id) => {
      const r = byId.get(id)!;
      return { name: r.name, description: r.description ?? '', price: Number(r.price) };
    });
  }

  async generate(input: BuilderInput): Promise<Buffer> {
    const { cocktails, shooters } = await this.resolveItems(input);
    return this.render(input, cocktails, shooters);
  }

  private async resolveItems(input: BuilderInput) {
    const { cocktails: cl, shooters: sl } = BUILDER_LIMITS;
    const nC = new Set(input.cocktailIds).size;
    const nS = new Set(input.shooterIds).size;
    if (nC < cl.min || nC > cl.max) {
      throw new BadRequestException(`Select ${cl.min} to ${cl.max} cocktails (selected ${nC})`);
    }
    if (nS < sl.min || nS > sl.max) {
      throw new BadRequestException(`Select ${sl.min} to ${sl.max} shooters (selected ${nS})`);
    }

    const cocktails = await this.load(input.cocktailIds, MenuCategory.COCKTAIL, 'cocktails');
    const shooters = await this.load(input.shooterIds, MenuCategory.COCKTAIL_SHOOTER, 'shooters');
    return { cocktails, shooters };
  }

  // ---- event assignment ---------------------------------------------------

  eventOptions() {
    return this.prisma.event.findMany({
      where: { status: { not: 'CANCELLED' } },
      select: { id: true, clientName: true, eventDate: true },
      orderBy: { eventDate: 'desc' },
      take: 200,
    });
  }

  getForEvent(eventId: string) {
    return this.prisma.eventMenu.findUnique({ where: { eventId } });
  }

  /**
   * Validates and saves the build against an event (one menu per event).
   * Without a new background, an existing saved background is kept.
   */
  async saveForEvent(eventId: string, input: BuilderInput) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw new NotFoundException('Event not found');
    await this.resolveItems(input);
    if (input.background) this.drawCheck(input.background);

    const st = this.resolveStyle(input);
    const fontFamily = Object.keys(FONT_FAMILIES).find((k) => FONT_FAMILIES[k] === st.fonts)!;
    const data = {
      title: input.title,
      subtitle: input.subtitle,
      cocktailIds: [...new Set(input.cocktailIds)],
      shooterIds: [...new Set(input.shooterIds)],
      fontFamily,
      accentColor: st.accent,
      textColor: st.text,
      overlayOpacity: st.overlay,
    };
    return this.prisma.eventMenu.upsert({
      where: { eventId },
      create: { eventId, ...data, background: input.background ?? null },
      update: { ...data, ...(input.background ? { background: input.background } : {}) },
    });
  }

  async generateForEvent(eventId: string): Promise<Buffer> {
    const m = await this.getForEvent(eventId);
    if (!m) throw new NotFoundException('No menu assigned to this event');
    return this.generate({
      title: m.title,
      subtitle: m.subtitle,
      cocktailIds: m.cocktailIds,
      shooterIds: m.shooterIds,
      background: m.background ? Buffer.from(m.background) : undefined,
      fontFamily: m.fontFamily,
      accentColor: m.accentColor,
      textColor: m.textColor,
      overlayOpacity: m.overlayOpacity,
    });
  }

  async removeForEvent(eventId: string) {
    await this.prisma.eventMenu.deleteMany({ where: { eventId } });
  }

  /** Rejects an unreadable background before it is persisted. */
  private drawCheck(image: Buffer) {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    doc.on('data', () => undefined);
    try {
      doc.image(image, 0, 0, { cover: [W, H] });
    } catch {
      throw new BadRequestException('Background must be a valid PNG or JPG image');
    } finally {
      doc.end();
    }
  }

  private resolveStyle(input: BuilderInput): Style {
    const hex = (v: string | undefined, d: string) => (v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
    const o = Number(input.overlayOpacity);
    return {
      fonts: FONT_FAMILIES[input.fontFamily ?? ''] ?? FONT_FAMILIES[BUILDER_DEFAULTS.fontFamily],
      accent: hex(input.accentColor, BUILDER_DEFAULTS.accentColor),
      text: hex(input.textColor, BUILDER_DEFAULTS.textColor),
      overlay: Number.isFinite(o) ? Math.min(1, Math.max(0, o)) : BUILDER_DEFAULTS.overlayOpacity,
    };
  }

  private render(input: BuilderInput, cocktails: MenuLine[], shooters: MenuLine[]): Promise<Buffer> {
    const st = this.resolveStyle(input);
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: input.title || 'Menu' } });
    const chunks: Buffer[] = [];

    return new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      try {
        const background = input.background ?? getDefaultBackground();
        const hasImage = !!background;
        this.drawBackground(doc, background, st);

        const x = (W - CONTENT_W) / 2;
        const blocks = this.buildBlocks(input, cocktails, shooters);

        // Pick the largest scale at which everything fits on the page.
        const available = H - TOP_CLEARANCE - PAGE_MARGIN;
        let scale = 1.2;
        let total = this.measure(doc, blocks, scale, st);
        while (total > available && scale > 0.5) {
          scale = Math.round((scale - 0.05) * 100) / 100;
          total = this.measure(doc, blocks, scale, st);
        }

        // Content starts below the 3-inch top clearance.
        let y = TOP_CLEARANCE;

        if (hasImage) {
          // Readability panel on top of the photo.
          const pad = 28;
          doc.save();
          doc.fillOpacity(st.overlay).roundedRect(x - pad, y - pad, CONTENT_W + pad * 2, total + pad * 2, 10).fill('#000000');
          doc.restore();
        }

        for (const b of blocks) y = this.drawBlock(doc, b, x, y, scale, st);
        doc.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  // ---- layout model -------------------------------------------------------

  private buildBlocks(input: BuilderInput, cocktails: MenuLine[], shooters: MenuLine[]): Block[] {
    const blocks: Block[] = [];
    blocks.push({ kind: 'section', text: 'COCKTAILS' });
    cocktails.forEach((i) => blocks.push({ kind: 'item', item: i }));
    blocks.push({ kind: 'rule' });
    blocks.push({ kind: 'section', text: 'SHOOTERS' });
    shooters.forEach((i) => blocks.push({ kind: 'item', item: i }));
    return blocks;
  }

  private measure(doc: PDFKit.PDFDocument, blocks: Block[], scale: number, st: Style): number {
    // Trailing gap after the last block is not visible, so drop it.
    const heights = blocks.map((b) => this.blockHeight(doc, b, scale, st));
    return heights.reduce((a, h) => a + h, 0) - this.gapAfter(blocks[blocks.length - 1], scale);
  }

  private gapAfter(b: Block, s: number): number {
    switch (b.kind) {
      case 'title': return 6 * s;
      case 'subtitle': return 10 * s;
      case 'rule': return 14 * s;
      case 'section': return 12 * s;
      case 'item': return 9 * s;
    }
  }

  private itemName(item: MenuLine): string {
    // Zero (unset) prices are intentionally hidden from the menu.
    if (item.price > 0) {
      const p = item.price.toLocaleString('en-PH', { maximumFractionDigits: 2 });
      return `${item.name}  -  PHP ${p}`;
    }
    return item.name;
  }

  private blockHeight(doc: PDFKit.PDFDocument, b: Block, s: number, st: Style): number {
    const gap = this.gapAfter(b, s);
    switch (b.kind) {
      case 'title':
        doc.font(st.fonts.bold).fontSize(30 * s);
        return doc.heightOfString(b.text, { width: CONTENT_W, align: 'center', characterSpacing: 4 * s }) + gap;
      case 'subtitle':
        doc.font(st.fonts.italic).fontSize(12 * s);
        return doc.heightOfString(b.text, { width: CONTENT_W, align: 'center' }) + gap;
      case 'rule':
        return 8 * s + 1 + gap;
      case 'section':
        doc.font(st.fonts.bold).fontSize(14 * s);
        return doc.heightOfString(b.text, { width: CONTENT_W, align: 'center', characterSpacing: 3 * s }) + gap;
      case 'item': {
        doc.font(st.fonts.bold).fontSize(12 * s);
        let h = doc.heightOfString(this.itemName(b.item), { width: CONTENT_W, align: 'center' });
        if (b.item.description) {
          doc.font(st.fonts.italic).fontSize(8.5 * s);
          h += 1.5 * s + doc.heightOfString(b.item.description, { width: CONTENT_W, align: 'center' });
        }
        return h + gap;
      }
    }
  }

  private drawBlock(doc: PDFKit.PDFDocument, b: Block, x: number, y: number, s: number, st: Style): number {
    const gap = this.gapAfter(b, s);
    switch (b.kind) {
      case 'title':
        doc.font(st.fonts.bold).fontSize(30 * s).fillColor(st.accent);
        doc.text(b.text, x, y, { width: CONTENT_W, align: 'center', characterSpacing: 4 * s });
        break;
      case 'subtitle':
        doc.font(st.fonts.italic).fontSize(12 * s).fillColor(st.text);
        doc.text(b.text, x, y, { width: CONTENT_W, align: 'center' });
        break;
      case 'rule': {
        const len = 80;
        const ry = y + 8 * s; // breathing room above the divider
        doc.moveTo(W / 2 - len / 2, ry).lineTo(W / 2 + len / 2, ry).lineWidth(1).strokeColor(st.accent).stroke();
        break;
      }
      case 'section':
        doc.font(st.fonts.bold).fontSize(14 * s).fillColor(st.accent);
        doc.text(b.text, x, y, { width: CONTENT_W, align: 'center', characterSpacing: 3 * s });
        break;
      case 'item': {
        doc.font(st.fonts.bold).fontSize(12 * s).fillColor(st.text);
        doc.text(this.itemName(b.item), x, y, { width: CONTENT_W, align: 'center' });
        if (b.item.description) {
          doc.font(st.fonts.italic).fontSize(8.5 * s).fillColor(st.text);
          doc.save().fillOpacity(0.75);
          doc.text(b.item.description, x, doc.y + 1.5 * s, { width: CONTENT_W, align: 'center' });
          doc.restore();
        }
        break;
      }
    }
    return y + this.blockHeight(doc, b, s, st);
  }

  // ---- background ---------------------------------------------------------

  private drawBackground(doc: PDFKit.PDFDocument, image: Buffer | undefined, st: Style) {
    if (image) {
      try {
        // "cover": fill the page, centred, cropping overflow.
        doc.image(image, 0, 0, { cover: [W, H], align: 'center', valign: 'center' });
        return;
      } catch {
        throw new BadRequestException('Background must be a valid PNG or JPG image');
      }
    }

    // Default generated background: dark gradient with a double gold frame.
    const grad = doc.linearGradient(0, 0, 0, H);
    grad.stop(0, '#1d1814').stop(0.5, COLORS.bg).stop(1, '#0c0a09');
    doc.rect(0, 0, W, H).fill(grad);
    doc.lineWidth(1.5).strokeColor(st.accent).rect(24, 24, W - 48, H - 48).stroke();
    doc.lineWidth(0.5).strokeColor(st.accent).rect(32, 32, W - 64, H - 64).stroke();
  }
}

type Block =
  | { kind: 'title'; text: string }
  | { kind: 'subtitle'; text: string }
  | { kind: 'rule' }
  | { kind: 'section'; text: string }
  | { kind: 'item'; item: MenuLine };
