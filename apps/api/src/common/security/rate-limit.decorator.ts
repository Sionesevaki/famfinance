import { SetMetadata } from "@nestjs/common";

export type RateLimitConfig = {
  key: string;
  windowMs: number;
  max: number;
};

export const RATE_LIMIT_KEY = "famfinance:rate_limit";

export const RateLimit = (config: RateLimitConfig) => SetMetadata(RATE_LIMIT_KEY, config);

