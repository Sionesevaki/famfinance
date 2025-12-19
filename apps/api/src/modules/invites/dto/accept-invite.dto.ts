import { IsString, MinLength } from "class-validator";

export class AcceptInviteDto {
  @IsString()
  @MinLength(10)
  token!: string;
}

