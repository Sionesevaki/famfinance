import { IsEnum } from "class-validator";
import { WorkspaceRole } from "@famfinance/db";

export class UpdateMemberRoleDto {
  @IsEnum(WorkspaceRole)
  role!: WorkspaceRole;
}

