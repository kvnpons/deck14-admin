import { Body, Controller, Get, Param, Post, Query, Render, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ClientsService } from './clients.service';
import { ClientDto } from './dto/client.dto';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @Render('clients/index')
  async index(@Query('q') q?: string) {
    const clients = await this.clients.list(q);
    return { title: 'Clients', clients, q: q ?? '', total: clients.length };
  }

  @Get('new')
  @Render('clients/new')
  newPage() {
    return { title: 'New client' };
  }

  @Post()
  async create(@Body() dto: ClientDto, @Req() req: Request, @Res() res: Response) {
    const client = await this.clients.create(dto);
    (req as any).flash('success', `Client ${client.name} created.`);
    return res.redirect(`/clients/${client.id}`);
  }

  @Get(':id')
  @Render('clients/show')
  async show(@Param('id') id: string) {
    const client = await this.clients.findOrThrow(id);
    return { title: client.name, client };
  }

  @Get(':id/edit')
  @Render('clients/edit')
  async editPage(@Param('id') id: string) {
    const client = await this.clients.findOrThrow(id);
    return { title: `Edit — ${client.name}`, client };
  }

  @Post(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: ClientDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.clients.update(id, dto);
    (req as any).flash('success', 'Client updated.');
    return res.redirect(`/clients/${id}`);
  }

  @Post(':id/delete')
  async remove(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    try {
      await this.clients.remove(id);
    } catch (e: any) {
      (req as any).flash('error', e?.response?.message ?? 'Could not delete client');
      return res.redirect(`/clients/${id}`);
    }
    (req as any).flash('success', 'Client deleted.');
    return res.redirect('/clients');
  }
}
