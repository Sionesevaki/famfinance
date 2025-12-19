import { GenericContainer, type StartedTestContainer } from "testcontainers";

export type TestInfra = {
  pg: StartedTestContainer;
  redis: StartedTestContainer;
  minio: StartedTestContainer;
  env: Record<string, string>;
};

export async function startInfra(): Promise<TestInfra> {
  const pg = await new GenericContainer("postgres:16")
    .withEnvironment({
      POSTGRES_USER: "test",
      POSTGRES_PASSWORD: "test",
      POSTGRES_DB: "testdb",
    })
    .withExposedPorts(5432)
    .start();

  const redis = await new GenericContainer("redis:7").withExposedPorts(6379).start();

  const minio = await new GenericContainer("minio/minio:latest")
    .withEnvironment({
      MINIO_ROOT_USER: "minio",
      MINIO_ROOT_PASSWORD: "minio123",
    })
    .withCommand(["server", "/data"])
    .withExposedPorts(9000)
    .start();

  const dbUrl = `postgresql://test:test@${pg.getHost()}:${pg.getMappedPort(5432)}/testdb`;
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  const s3Endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;

  return {
    pg,
    redis,
    minio,
    env: {
      DATABASE_URL: dbUrl,
      REDIS_URL: redisUrl,
      S3_ENDPOINT: s3Endpoint,
      S3_ACCESS_KEY: "minio",
      S3_SECRET_KEY: "minio123",
      S3_BUCKET: "test-bucket",
      TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      KEYCLOAK_AUDIENCE: "api",
      KEYCLOAK_ISSUER: "http://test-issuer.local",
      KEYCLOAK_JWKS_URI: "http://test-jwks.local",
    },
  };
}
