import { IsISO8601, IsInt, IsOptional, IsString, Length } from "class-validator";

export class CreateTransactionDto {
  @IsISO8601()
  occurredAt!: string;

  @IsInt()
  amountCents!: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  merchantName?: string;

  @IsOptional()
  @IsString()
  categoryName?: string;
}

