import { IsISO8601, IsOptional, IsString, MinLength } from "class-validator";

export class EmailCallbackDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  redirectUri?: string;

  @IsOptional()
  @IsString()
  providerEmail?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  accessToken?: string;

  @IsOptional()
  @IsString()
  refreshToken?: string;

  @IsOptional()
  @IsISO8601()
  tokenExpiresAt?: string;
}

