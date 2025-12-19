import { IsOptional, IsString, Matches } from "class-validator";

export class AnalyticsSummaryQuery {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  month?: string; // YYYY-MM
}

