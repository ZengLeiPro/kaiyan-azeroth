import type { FinanceAccountResponseOutput } from '@ky-azeroth/shared/schemas';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PaginatedResponse } from '../../../common/interfaces/pagination.interface';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { auditCreate, auditUpdate } from '../../../common/utils/audit-helper';
import { calculatePagination, serializeEntity } from '../../../common/utils/response-helpers';
import { CreateFinanceAccountDto } from './dto/create-account.dto';
import { QueryFinanceAccountDto } from './dto/query-account.dto';
import { UpdateFinanceAccountDto } from './dto/update-account.dto';

type CurrentUser = { id: string; employeeId?: string | null };

@Injectable()
export class FinanceAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: QueryFinanceAccountDto
  ): Promise<PaginatedResponse<FinanceAccountResponseOutput>> {
    const { page = 1, pageSize = 100, keyword, kind, status } = query;
    const { skip, take } = calculatePagination(page, pageSize);

    const where: Prisma.FinanceAccountWhereInput = { deletedAt: null };
    if (keyword) {
      where.OR = [
        { code: { contains: keyword, mode: 'insensitive' } },
        { name: { contains: keyword, mode: 'insensitive' } },
      ];
    }
    if (kind) where.kind = kind;
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      this.prisma.financeAccount.findMany({
        where,
        skip,
        take,
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.financeAccount.count({ where }),
    ]);

    return {
      items: items.map((item) => serializeEntity<FinanceAccountResponseOutput>(item)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string): Promise<FinanceAccountResponseOutput> {
    const row = await this.prisma.financeAccount.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException(`账户 ${id} 不存在`);
    return serializeEntity<FinanceAccountResponseOutput>(row);
  }

  async create(
    dto: CreateFinanceAccountDto,
    user: CurrentUser
  ): Promise<FinanceAccountResponseOutput> {
    const created = await this.prisma.financeAccount.create({
      data: {
        ...dto,
        ...auditCreate(user),
      },
    });
    return serializeEntity<FinanceAccountResponseOutput>(created);
  }

  // @no-optimistic-lock: 财务账户字典仅 admin 单用户维护，6 行内置数据，并发冲突场景不存在
  async update(
    id: string,
    dto: UpdateFinanceAccountDto,
    user: CurrentUser
  ): Promise<FinanceAccountResponseOutput> {
    await this.findOne(id);

    const { version: _v, ...rest } = dto;
    const updated = await this.prisma.financeAccount.update({
      where: { id },
      data: {
        ...rest,
        ...auditUpdate(user),
      },
    });
    return serializeEntity<FinanceAccountResponseOutput>(updated);
  }

  async remove(id: string, user: CurrentUser): Promise<void> {
    await this.findOne(id);
    await this.prisma.financeAccount.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        ...auditUpdate(user),
      },
    });
  }
}
