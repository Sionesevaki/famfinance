-- Add role to WorkspaceInvite so invites can assign roles on acceptance.

ALTER TABLE "WorkspaceInvite"
  ADD COLUMN "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER';

