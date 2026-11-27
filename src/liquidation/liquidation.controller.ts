import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Render,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { TransactionType } from '@prisma/client';
import { LiquidationService } from './liquidation.service';
import { CreateTransactionDto } from './dto/transaction.dto';

@Controller('liquidation')
export class LiquidationController {
  constructor(private readonly liquidation: LiquidationService) {}

  @Get()
  @Render('liquidation/index')
  async index(@Query('type') type?: TransactionType, @Query('eventId') eventId?: string) {
    const [transactions, ledger, events] = await Promise.all([
      this.liquidation.listTransactions({ type, eventId: eventId || undefined }),
      this.liquidation.employeeLedger(),
      this.liquidation.listEventsForSelect(),
    ]);
    return {
      title: 'Liquidation',
      transactions,
      ledger,
      typeFilter: type || '',
      eventFilter: eventId || '',
      events,
      transactionTypes: Object.values(TransactionType),
    };
  }

  @Get('new')
  @Render('liquidation/new')
  async newPage(@Query('type') type?: TransactionType, @Query('eventId') eventId?: string) {
    const events = await this.liquidation.listEventsForSelect();
    return {
      title: 'Record transaction',
      events,
      transactionTypes: Object.values(TransactionType),
      selectedType: type || TransactionType.INCOME,
      selectedEventId: eventId || '',
    };
  }

  @Post()
  async create(
    @Body() dto: CreateTransactionDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.liquidation.create(dto);
    (req as any).flash('success', 'Transaction recorded.');
    return res.redirect('/liquidation');
  }

  @Post(':id/delete')
  async remove(
    @Param('id') id: string,
    @Body('redirectTo') redirectTo: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.liquidation.remove(id);
    (req as any).flash('success', 'Transaction removed.');
    const safe = redirectTo && /^\/events\/[\w-]+$/.test(redirectTo);
    return res.redirect(safe ? redirectTo! : '/liquidation');
  }
}
