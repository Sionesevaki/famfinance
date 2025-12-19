import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from "class-validator";
import { DocumentType } from "@famfinance/db";

export class PresignUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  mimeType!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;
}

