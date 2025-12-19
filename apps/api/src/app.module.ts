import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { KeycloakJwtGuard } from "./common/auth/keycloak-jwt.guard";
import { HttpLoggingInterceptor } from "./common/http/http-logging.interceptor";
import { RequestIdInterceptor } from "./common/http/request-id.interceptor";
import { HealthModule } from "./modules/health/health.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { AdminModule } from "./modules/admin/admin.module";
import { AuditModule } from "./modules/audit/audit.module";
import { CategoriesModule } from "./modules/categories/categories.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { InvitesModule } from "./modules/invites/invites.module";
import { EmailIntegrationsModule } from "./modules/integrations/email/email-integrations.module";
import { MerchantsModule } from "./modules/merchants/merchants.module";
import { SubscriptionsModule } from "./modules/subscriptions/subscriptions.module";
import { TransactionsModule } from "./modules/transactions/transactions.module";
import { UsersModule } from "./modules/users/users.module";
import { WorkspacesModule } from "./modules/workspaces/workspaces.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AdminModule,
    AuditModule,
    UsersModule,
    WorkspacesModule,
    InvitesModule,
    DocumentsModule,
    EmailIntegrationsModule,
    MerchantsModule,
    TransactionsModule,
    AnalyticsModule,
    SubscriptionsModule,
    CategoriesModule,
  ],
  providers: [
    KeycloakJwtGuard,
    { provide: APP_GUARD, useExisting: KeycloakJwtGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
    { provide: APP_INTERCEPTOR, useClass: HttpLoggingInterceptor },
  ],
})
export class AppModule {}
