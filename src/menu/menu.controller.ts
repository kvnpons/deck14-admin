import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Render,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { MenuCategory } from '@prisma/client';
import { MenuService, CATEGORY_LABELS } from './menu.service';
import { MenuPdfService } from './menu-pdf.service';
import { MenuBuilderService, BUILDER_LIMITS, BUILDER_DEFAULTS, FONT_FAMILIES } from './menu-builder.service';
import { CreateMenuItemDto, UpdateMenuItemDto } from './dto/menu-item.dto';

@Controller('menu')
export class MenuController {
  constructor(
    private readonly menu: MenuService,
    private readonly pdf: MenuPdfService,
    private readonly builder: MenuBuilderService,
  ) {}

  @Get()
  @Render('menu/index')
  async index() {
    const groups = await this.menu.groupedList();
    return { title: 'Menu Catalogue', groups };
  }

  @Get('new')
  @Render('menu/new')
  newPage() {
    return {
      title: 'Add menu item',
      categories: Object.values(MenuCategory),
      categoryLabels: CATEGORY_LABELS,
    };
  }

  @Post()
  async create(@Body() dto: CreateMenuItemDto, @Req() req: Request, @Res() res: Response) {
    await this.menu.create(dto);
    (req as any).flash('success', 'Menu item added.');
    return res.redirect('/menu');
  }

  @Get('builder')
  @Render('menu/builder')
  async builderPage(@Query('eventId') eventId?: string) {
    const [{ cocktails, shooters }, events, saved] = await Promise.all([
      this.builder.listForBuilder(),
      this.builder.eventOptions(),
      eventId ? this.builder.getForEvent(eventId) : null,
    ]);
    const cSel = new Set(saved?.cocktailIds ?? []);
    const sSel = new Set(saved?.shooterIds ?? []);
    const d = {
      title: saved?.title ?? BUILDER_DEFAULTS.title,
      subtitle: saved?.subtitle ?? BUILDER_DEFAULTS.subtitle,
      fontFamily: saved?.fontFamily ?? BUILDER_DEFAULTS.fontFamily,
      accentColor: saved?.accentColor ?? BUILDER_DEFAULTS.accentColor,
      textColor: saved?.textColor ?? BUILDER_DEFAULTS.textColor,
      overlayPercent: Math.round((saved?.overlayOpacity ?? BUILDER_DEFAULTS.overlayOpacity) * 100),
    };
    return {
      title: 'Menu builder',
      cocktails: cocktails.map((c) => ({ ...c, checked: cSel.has(c.id) })),
      shooters: shooters.map((c) => ({ ...c, checked: sSel.has(c.id) })),
      limits: BUILDER_LIMITS,
      defaults: d,
      hasSavedBackground: !!saved?.background,
      events: events.map((e) => ({
        id: e.id,
        label: `${e.clientName} — ${e.eventDate.toISOString().slice(0, 10)}`,
        selected: e.id === eventId,
      })),
      fonts: Object.entries(FONT_FAMILIES).map(([value, f]) => ({
        value,
        label: f.label,
        selected: value === d.fontFamily,
      })),
    };
  }

  private builderInput(body: Record<string, any>, file?: { buffer: Buffer; mimetype: string }) {
    const toArray = (v: unknown): string[] =>
      v === undefined ? [] : (Array.isArray(v) ? v : [v]).map(String);

    if (file && !['image/png', 'image/jpeg'].includes(file.mimetype)) {
      throw new BadRequestException('Background must be a PNG or JPG image');
    }

    return {
      title: String(body.title ?? '').trim().slice(0, 60),
      subtitle: String(body.subtitle ?? '').trim().slice(0, 100),
      cocktailIds: toArray(body.cocktailIds),
      shooterIds: toArray(body.shooterIds),
      background: file?.buffer,
      fontFamily: String(body.fontFamily ?? ''),
      accentColor: String(body.accentColor ?? ''),
      textColor: String(body.textColor ?? ''),
      overlayOpacity: Number(body.overlayOpacity ?? BUILDER_DEFAULTS.overlayOpacity * 100) / 100,
    };
  }

  @Post('builder/pdf')
  @UseInterceptors(FileInterceptor('background', { limits: { fileSize: 8 * 1024 * 1024 } }))
  async builderPdf(
    @Body() body: Record<string, any>,
    @UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined,
    @Res() res: Response,
  ) {
    const buffer = await this.builder.generate(this.builderInput(body, file));
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="cocktail-menu.pdf"',
    });
    res.send(buffer);
  }

  @Post('builder/save')
  @UseInterceptors(FileInterceptor('background', { limits: { fileSize: 8 * 1024 * 1024 } }))
  async builderSave(
    @Body() body: Record<string, any>,
    @UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const eventId = String(body.eventId ?? '');
    if (!eventId) throw new BadRequestException('Choose an event to assign this menu to');
    await this.builder.saveForEvent(eventId, this.builderInput(body, file));
    (req as any).flash('success', 'Menu assigned to event.');
    return res.redirect(`/events/${eventId}`);
  }

  @Get('event/:eventId/pdf')
  async eventPdf(@Param('eventId') eventId: string, @Res() res: Response) {
    const buffer = await this.builder.generateForEvent(eventId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="event-menu.pdf"',
    });
    res.send(buffer);
  }

  @Post('event/:eventId/delete')
  async eventMenuRemove(@Param('eventId') eventId: string, @Req() req: Request, @Res() res: Response) {
    await this.builder.removeForEvent(eventId);
    (req as any).flash('success', 'Menu removed from event.');
    return res.redirect(`/events/${eventId}`);
  }

  @Get('export.pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="menu-catalogue.pdf"')
  async exportPdf(@Res() res: Response) {
    const buffer = await this.pdf.generate();
    res.send(buffer);
  }

  @Get(':id/edit')
  @Render('menu/edit')
  async editPage(@Param('id') id: string) {
    const item = await this.menu.findOrThrow(id);
    return {
      title: `Edit — ${item.name}`,
      item,
      categories: Object.values(MenuCategory),
      categoryLabels: CATEGORY_LABELS,
    };
  }

  @Post(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateMenuItemDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.menu.update(id, dto);
    (req as any).flash('success', 'Menu item updated.');
    return res.redirect('/menu');
  }

  @Post(':id/delete')
  async remove(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    await this.menu.remove(id);
    (req as any).flash('success', 'Menu item deleted.');
    return res.redirect('/menu');
  }
}
