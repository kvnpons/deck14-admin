import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { TransactionType } from '@prisma/client';

export class CreateTransactionDto {
  @IsEnum(TransactionType)
  type!: TransactionType;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  // Required for INCOME/EXPENSE
  @ValidateIf((o) => o.type === TransactionType.INCOME || o.type === TransactionType.EXPENSE)
  @IsString()
  @IsNotEmpty({ message: 'Income/expense must be tied to an event' })
  eventId?: string;

  // Required for LOAN/PETTY_CASH
  @ValidateIf((o) => o.type === TransactionType.LOAN || o.type === TransactionType.PETTY_CASH)
  @IsString()
  @IsNotEmpty({ message: 'Loan/petty cash must name an employee' })
  employeeName?: string;
}
