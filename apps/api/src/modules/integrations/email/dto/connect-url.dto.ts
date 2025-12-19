import { IsOptional, IsString } from "class-validator";

export class EmailConnectUrlDto {
  @IsOptional()
  @IsString()
  redirectUri?: string;
}

