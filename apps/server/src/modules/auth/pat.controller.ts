import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, CurrentUserType } from './decorators/current-user.decorator';
import { RequirePermission } from './decorators/require-permission.decorator';
import { IssuePatDto } from './dto/issue-pat.dto';
import { assertFreshJwtAuthentication } from './guards/fresh-jwt-authentication';
import { type PatIssueResult, type PatListItem, PatService } from './services/pat.service';

/**
 * 个人访问令牌（Personal Access Token）管理接口
 *
 * 走 system.user_account 权限矩阵；签发/吊销额外要求最近认证 JWT。
 * 设计要点：
 *  - 明文 token 仅在签发时返回一次，之后 DB 仅存 SHA-256 hash
 *  - 吊销采用软删除（revokedAt），方便审计
 *  - push 6: user 表已删，target 维度统一为 employeeId
 */
@ApiTags('个人访问令牌')
@ApiBearerAuth()
@Controller('personal-access-tokens')
export class PatController {
  constructor(private readonly patService: PatService) {}

  @Post()
  @RequirePermission({ module: 'system', menu: 'user_account', action: 'edit' })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '签发新 PAT（明文 token 一次性返回）' })
  async issue(
    @CurrentUser() me: CurrentUserType,
    @Body() body: IssuePatDto
  ): Promise<PatIssueResult> {
    assertFreshJwtAuthentication(me);
    const expiresAt =
      body.expiresAt === undefined || body.expiresAt === null ? null : new Date(body.expiresAt);
    return this.patService.issueByEmployeeId({
      employeeId: body.employeeId,
      name: body.name.trim(),
      expiresAt,
      currentUser: me,
    });
  }

  @Get()
  @RequirePermission({ module: 'system', menu: 'user_account', action: 'view' })
  @ApiOperation({ summary: '列出全部 PAT' })
  async listAll(@CurrentUser() _me: CurrentUserType): Promise<PatListItem[]> {
    return this.patService.listAll();
  }

  @Get('employee/:employeeId')
  @RequirePermission({ module: 'system', menu: 'user_account', action: 'view' })
  @ApiOperation({ summary: '列出指定员工的 PAT' })
  async listByEmployee(
    @CurrentUser() _me: CurrentUserType,
    @Param('employeeId') employeeId: string
  ): Promise<PatListItem[]> {
    return this.patService.listByEmployee(employeeId);
  }

  @Delete(':id')
  @RequirePermission({ module: 'system', menu: 'user_account', action: 'edit' })
  @ApiOperation({ summary: '吊销 PAT' })
  async revoke(@CurrentUser() me: CurrentUserType, @Param('id') id: string): Promise<{ ok: true }> {
    assertFreshJwtAuthentication(me);
    await this.patService.revoke(id, me);
    return { ok: true };
  }
}
