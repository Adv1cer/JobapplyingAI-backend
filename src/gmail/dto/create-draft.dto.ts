import { IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateDraftDto {
  @IsEmail()
  to: string;

  @IsString()
  subject: string;

  @IsString()
  body: string;

  @IsOptional()
  @IsUUID()
  jobMatchId?: string;
}
