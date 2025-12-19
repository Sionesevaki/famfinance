import { SetMetadata } from "@nestjs/common";
import { WorkspaceRole } from "@famfinance/db";

export const WORKSPACE_ROLES_KEY = "workspaceRoles";

export const WorkspaceRoles = (...roles: WorkspaceRole[]) => SetMetadata(WORKSPACE_ROLES_KEY, roles);

