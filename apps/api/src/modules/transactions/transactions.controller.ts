import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { KeycloakToken } from "../../common/auth/keycloak-jwt.guard";
import { WorkspaceMemberGuard } from "../../tenancy/workspace-member.guard";
import { UsersService } from "../users/users.service";
import { CreateTransactionDto } from "./dto/create-transaction.dto";
import { ListTransactionsQuery } from "./dto/list-transactions.query";
import { UpdateTransactionDto } from "./dto/update-transaction.dto";
import { TransactionsService } from "./transactions.service";

type AuthedRequest = Request & { user: KeycloakToken };

@Controller("/workspaces/:workspaceId/transactions")
@UseGuards(WorkspaceMemberGuard)
export class TransactionsController {
  constructor(
    private readonly txns: TransactionsService,
    private readonly users: UsersService,
  ) {}

  @Get()
  async list(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Query() query: ListTransactionsQuery,
  ) {
    await this.users.getOrCreateFromToken(req.user);
    return this.txns.listTransactions({
      workspaceId,
      from: query.from,
      to: query.to,
      categoryId: query.categoryId,
      merchantId: query.merchantId,
      source: query.source,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Post()
  async create(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Body() body: CreateTransactionDto,
  ) {
    await this.users.getOrCreateFromToken(req.user);
    return this.txns.createManualTransaction({
      workspaceId,
      occurredAt: body.occurredAt,
      amountCents: body.amountCents,
      currency: body.currency,
      description: body.description,
      merchantName: body.merchantName,
      categoryName: body.categoryName,
    });
  }

  @Patch(":transactionId")
  async update(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("transactionId") transactionId: string,
    @Body() body: UpdateTransactionDto,
  ) {
    await this.users.getOrCreateFromToken(req.user);
    return this.txns.updateTransaction({
      workspaceId,
      transactionId,
      merchantId: body.merchantId,
      categoryId: body.categoryId,
      description: body.description,
    });
  }

  @Delete(":transactionId")
  @HttpCode(200)
  async remove(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("transactionId") transactionId: string,
  ) {
    await this.users.getOrCreateFromToken(req.user);
    await this.txns.softDelete({ workspaceId, transactionId });
    return { deleted: true };
  }
}
