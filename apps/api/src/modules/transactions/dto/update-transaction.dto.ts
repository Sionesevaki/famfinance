import { IsOptional, IsString, ValidateIf } from "class-validator";

export class UpdateTransactionDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  merchantId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  description?: string | null;
}

