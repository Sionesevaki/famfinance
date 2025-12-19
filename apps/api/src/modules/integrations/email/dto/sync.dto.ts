import { IsArray, IsISO8601, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class EmailAttachmentDto {
  @IsString()
  filename!: string;

  @IsString()
  mimeType!: string;

  @IsString()
  bodyBase64!: string;
}

export class EmailMockMessageDto {
  @IsString()
  providerMsgId!: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  fromEmail?: string;

  @IsOptional()
  @IsISO8601()
  sentAt?: string;

  @IsOptional()
  @IsString()
  snippet?: string;

  @IsOptional()
  @IsString()
  sha256?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmailAttachmentDto)
  attachments!: EmailAttachmentDto[];
}

export class EmailSyncDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmailMockMessageDto)
  mockMessages?: EmailMockMessageDto[];
}

