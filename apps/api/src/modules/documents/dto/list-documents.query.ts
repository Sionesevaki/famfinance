import { IsEnum, IsInt, IsOptional, Min } from "class-validator";
import { Type } from "class-transformer";
import { DocumentType } from "@famfinance/db";

export class ListDocumentsQuery {
  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

