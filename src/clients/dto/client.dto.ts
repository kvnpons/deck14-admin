import { IsEmail, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

export class ClientDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  // Forms post empty strings for blank inputs; those are treated as "not set".
  @ValidateIf((o) => o.email !== undefined && o.email !== '')
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
