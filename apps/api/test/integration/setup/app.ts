import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../../src/app.module";
import { configureApp } from "../../../src/app.configure";
import { KeycloakJwtGuard } from "../../../src/common/auth/keycloak-jwt.guard";
import { TestAuthGuard } from "./test-auth.guard";

export async function createTestApp(env: Record<string, string>): Promise<INestApplication> {
  Object.assign(process.env, env);

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(KeycloakJwtGuard)
    .useClass(TestAuthGuard)
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}
