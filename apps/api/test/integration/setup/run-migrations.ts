import { execSync } from "node:child_process";

export function runMigrations(databaseUrl: string) {
  execSync("pnpm --filter @famfinance/db migrate:deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

