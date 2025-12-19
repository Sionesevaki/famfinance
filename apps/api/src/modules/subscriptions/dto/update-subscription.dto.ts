import { IsBoolean, IsEnum, IsOptional } from "class-validator";
import { SubscriptionInterval } from "@famfinance/db";

export class UpdateSubscriptionDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsEnum(SubscriptionInterval)
  interval?: SubscriptionInterval;
}

