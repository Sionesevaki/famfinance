import { execSync } from "node:child_process";
import { GenericContainer } from "testcontainers";

it("migrations run on a fresh database", async () => {
  const pg = await new GenericContainer("postgres:16")
    .withEnvironment({
      POSTGRES_USER: "test",
      POSTGRES_PASSWORD: "test",
      POSTGRES_DB: "testdb",
    })
    .withExposedPorts(5432)
    .start();

  const dbUrl = `postgresql://test:test@${pg.getHost()}:${pg.getMappedPort(5432)}/testdb`;

  try {
    execSync("./node_modules/.bin/prisma migrate deploy --schema=prisma/schema.prisma", {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: dbUrl },
    });
  } finally {
    await pg.stop();
  }
}, 120_000);

