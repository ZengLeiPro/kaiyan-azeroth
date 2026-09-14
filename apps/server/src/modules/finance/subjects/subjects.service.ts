import type { FinanceSubjectResponseOutput } from '@ky-azeroth/shared/schemas';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PaginatedResponse } from '../../../common/interfaces/pagination.interface';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { auditCreate, auditUpdate } from '../../../common/utils/audit-helper';
import { calculatePagination, serializeEntity } from '../../../common/utils/response-helpers';
import { CreateFinanceSubjectDto } from './dto/create-subject.dto';
import { QueryFinanceSubjectDto } from './dto/query-subject.dto';
import { UpdateFinanceSubjectDto } from './dto/update-subject.dto';

type CurrentUser = { id: string; employeeId?: string | null };

interface SubjectWithParent {
  id: string;
  code: string;
  name: string;
  category: string;
  level: number;
  parentId: string | null;
  parent?: { name: string } | null;
  displayOrder: number;
  status: string;
  remark: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

@Injectable()
export class FinanceSubjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: QueryFinanceSubjectDto
  ): Promise<PaginatedResponse<FinanceSubjectResponseOutput>> {
    const { page = 1, pageSize = 100, keyword, category, level, parentId, status } = query;
    const { skip, take } = calculatePagination(page, pageSize);

    const where: Prisma.FinanceSubjectWhereInput = { deletedAt: null };
    if (keyword) {
      where.OR = [
        { code: { contains: keyword, mode: 'insensitive' } },
        { name: { contains: keyword, mode: 'insensitive' } },
      ];
    }
    if (category?.length) where.category = { in: category };
    if (typeof level === 'number') where.level = level;
    if (parentId) where.parentId = parentId;
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      this.prisma.financeSubject.findMany({
        where,
        skip,
        take,
        orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
        include: { parent: { select: { name: true } } },
      }),
      this.prisma.financeSubject.count({ where }),
    ]);

    return {
      items: items.map((item) => this.serialize(item as SubjectWithParent)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string): Promise<FinanceSubjectResponseOutput> {
    const row = await this.prisma.financeSubject.findFirst({
      where: { id, deletedAt: null },
      include: { parent: { select: { name: true } } },
    });
    if (!row) throw new NotFoundException(`科目 ${id} 不存在`);
    return this.serialize(row as SubjectWithParent);
  }

  async create(
    dto: CreateFinanceSubjectDto,
    user: CurrentUser
  ): Promise<FinanceSubjectResponseOutput> {
    // level=2 叶子必须有 parentId（除非是独立挂大类下的叶子，那种情况 parentId 可以为 null）
    // 这里不强制——业务允许独立叶子
    const created = await this.prisma.financeSubject.create({
      data: {
        ...dto,
        ...auditCreate(user),
      },
      include: { parent: { select: { name: true } } },
    });
    return this.serialize(created as SubjectWithParent);
  }

  // @no-optimistic-lock: 财务科目字典仅 admin 单用户维护，并发冲突场景不存在
  async update(
    id: string,
    dto: UpdateFinanceSubjectDto,
    user: CurrentUser
  ): Promise<FinanceSubjectResponseOutput> {
    await this.findOne(id);
    // 防止设置 parent 为自己（环）
    if (dto.parentId === id) {
      throw new BadRequestException('科目的 parent 不能指向自己');
    }

    const { version: _v, ...rest } = dto;
    const updated = await this.prisma.financeSubject.update({
      where: { id },
      data: {
        ...rest,
        ...auditUpdate(user),
      },
      include: { parent: { select: { name: true } } },
    });
    return this.serialize(updated as SubjectWithParent);
  }

  async remove(id: string, user: CurrentUser): Promise<void> {
    await this.findOne(id);
    // 软删前检查：level=1 分组若仍有未删除的 children，拒绝删除
    const childCount = await this.prisma.financeSubject.count({
      where: { parentId: id, deletedAt: null },
    });
    if (childCount > 0) {
      throw new BadRequestException(
        `该科目下仍有 ${childCount} 个子科目，请先删除或迁移子科目后再删除`
      );
    }
    await this.prisma.financeSubject.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        ...auditUpdate(user),
      },
    });
  }

  private serialize(row: SubjectWithParent): FinanceSubjectResponseOutput {
    const base = serializeEntity<Record<string, unknown>>({ ...row });
    return {
      ...base,
      parentName: row.parent?.name ?? null,
    } as FinanceSubjectResponseOutput;
  }
}
