import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { BookingStatus } from '@prisma/client';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  clientName!: string;

  @IsDateString()
  eventDate!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  pax!: number;

  @IsString()
  @Matches(TIME_REGEX, { message: 'barOpenTime must be HH:mm' })
  barOpenTime!: string;

  @IsString()
  @Matches(TIME_REGEX, { message: 'ingressTime must be HH:mm' })
  ingressTime!: string;

  @IsString()
  @IsNotEmpty()
  venue!: string;

  @IsString()
  @IsNotEmpty()
  contactName!: string;

  @IsString()
  @IsNotEmpty()
  contactPhone!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Optional client profile link; empty string means "no client".
  @IsOptional()
  @IsString()
  clientId?: string;

  // Used only when clientId === '__new__' (create a client alongside the event).
  @IsOptional()
  @IsString()
  newClientEmail?: string;

  @IsOptional()
  @IsString()
  newClientPhone?: string;

  @IsOptional()
  @IsString()
  newClientCompany?: string;
}

export class UpdateEventDto extends CreateEventDto {
  @IsEnum(BookingStatus)
  status!: BookingStatus;
}

// Public Step 1 — same first-step fields, no auth, always creates PENDING
export class PublicBookingDto {
  @IsString()
  @IsNotEmpty()
  clientName!: string;

  @IsDateString()
  eventDate!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  pax!: number;

  @IsString()
  @Matches(TIME_REGEX, { message: 'barOpenTime must be HH:mm' })
  barOpenTime!: string;

  @IsString()
  @Matches(TIME_REGEX, { message: 'ingressTime must be HH:mm' })
  ingressTime!: string;

  @IsString()
  @IsNotEmpty()
  venue!: string;

  @IsString()
  @IsNotEmpty()
  contactName!: string;

  @IsString()
  @IsNotEmpty()
  contactPhone!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
