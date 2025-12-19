import { IsEmail, IsEnum } from "class-validator";
import { WorkspaceRole } from "@famfinance/db";

export class CreateInviteDto {
  @IsEmail()
  email!: string;

  @IsEnum(WorkspaceRole)
  role!: WorkspaceRole;
}

