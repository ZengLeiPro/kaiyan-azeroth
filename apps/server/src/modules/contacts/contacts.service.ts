import type { ContactResponseOutput } from '@ky-azeroth/shared/schemas/contact';
import type { ContactForSelection } from '@ky-azeroth/shared/types';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { FilterApplierService } from '../../common/filter-scheme';
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  applyCustomerCollabSelfScope,
  applyCustomerOwnedScope,
} from '../../common/services/data-scope.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import { resolveOrderBy } from '../../common/utils/order-by.helper';
import { calculatePagination, serializeEntity } from '../../common/utils/response-helpers';
import { CrmChangeLogService } from '../operation-logs/crm-change-log.service';
import { CONTACT_FILTER_REGISTRY } from './contacts.filter-registry';
import { CreateContactDto } from './dto/create-contact.dto';
import { QueryContactDto } from './dto/query-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

/**
 * 联系人列表允许的排序字段白名单。
 * 注：findAllForSelection 走 contactName asc 固定排序，不消费前端 sortBy。
 */
const CONTACT_SORT_WHITELIST: ReadonlySet<string> = new Set([
  'contactName',
  'createdAt',
  'updatedAt',
]);

const CONTACT_RESPONSE_INCLUDE = {
  customer: {
    select: { id: true, customerName: true, shortName: true },
  },
  creator: {
    select: { name: true },
  },
  updater: {
    select: { name: true },
  },
} satisfies Prisma.ContactInclude;

type ContactWithRelations = Prisma.ContactGetPayload<{
  include: typeof CONTACT_RESPONSE_INCLUDE;
}>;

function toContactResponse(contact: ContactWithRelations): ContactResponseOutput {
  return serializeEntity<ContactResponseOutput>({
    ...contact,
    createdBy: contact.creator?.name ?? null,
    updatedBy: contact.updater?.name ?? null,
  });
}

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filterApplier: FilterApplierService,
    private readonly changeLog?: CrmChangeLogService
  ) {}

  async findAll(
    query: QueryContactDto,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null,
    rawQuery?: unknown
  ): Promise<PaginatedResponse<ContactResponseOutput>> {
    const { page = 1, pageSize = 10, sortBy, sortOrder } = query;
    const { skip, take } = calculatePagination(page, pageSize);

    // 联系人模型自身没有 chargerId，数据范围通过关联客户的 chargerId 或 collaboratorIds 过滤。
    const baseWhere: Prisma.ContactWhereInput = { deletedAt: null };
    applyCustomerOwnedScope(baseWhere, chargerScope, currentEmployeeId);

    const where = await this.filterApplier.buildWhere<Prisma.ContactWhereInput>({
      registry: CONTACT_FILTER_REGISTRY,
      rawQuery,
      legacyKeyword: query.keyword,
      legacyFilters: this.buildLegacyFilters(query),
      chargerScope: null,
      baseWhere,
    });

    const orderBy = resolveOrderBy<Prisma.ContactOrderByWithRelationInput>(sortBy, sortOrder, {
      whitelist: CONTACT_SORT_WHITELIST,
      fallback: { createdAt: 'desc' },
    });

    const [data, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        skip,
        take,
        orderBy,
        include: CONTACT_RESPONSE_INCLUDE,
      }),
      this.prisma.contact.count({ where }),
    ]);

    return {
      items: data.map((item) => toContactResponse(item)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 查询所有联系人（用于下拉框等场景）
   */
  async findAllForSelection(
    query: {
      keyword?: string;
      customerId?: string;
    },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<ContactForSelection[]> {
    const where: Prisma.ContactWhereInput = { deletedAt: null };
    applyCustomerOwnedScope(where, chargerScope, currentEmployeeId);
    if (query.customerId) where.customerId = query.customerId;

    if (query.keyword) {
      const keywordOr = [
        { contactName: { contains: query.keyword, mode: 'insensitive' as const } },
        { phone: { contains: query.keyword, mode: 'insensitive' as const } },
      ];
      // keyword 与 scope OR 互斥 —— 用 AND 串联避免覆盖
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: keywordOr }];
        delete where.OR;
      } else {
        where.OR = keywordOr;
      }
    }

    return this.prisma.contact.findMany({
      where,
      orderBy: { contactName: 'asc' },
      select: {
        id: true,
        contactName: true,
        position: true,
        phone: true,
      },
    });
  }

  async findOne(
    id: string,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<ContactResponseOutput> {
    const where: Prisma.ContactWhereInput = { id, deletedAt: null };
    applyCustomerOwnedScope(where, chargerScope, currentEmployeeId);

    const contact = await this.prisma.contact.findFirst({
      where,
      include: CONTACT_RESPONSE_INCLUDE,
    });

    if (!contact) {
      throw new NotFoundException(`联系人 ${id} 不存在`);
    }

    return toContactResponse(contact);
  }

  /**
   * 写入前校验目标客户在调用者数据范围内且未软删。
   * 复用 customers.findOne 的范式：chargerId IN scope OR collaboratorIds @> [me]。
   * ADMIN（scope=null）由 applyCustomerCollabSelfScope 自动放行（不注入 OR）。
   */
  private async assertCustomerInScope(
    customerId: string,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<void> {
    const where: Prisma.CustomerWhereInput = { id: customerId, deletedAt: null };
    applyCustomerCollabSelfScope(where, chargerScope, currentEmployeeId);
    const customer = await this.prisma.customer.findFirst({ where, select: { id: true } });
    if (!customer) {
      // 不区分「不存在 / 越权 / 已软删」，避免泄露他人客户 id 的存在性
      throw new ForbiddenException('无权将联系人写入该客户，或客户不存在');
    }
  }

  async create(
    dto: CreateContactDto,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<ContactResponseOutput> {
    await this.assertCustomerInScope(dto.customerId, chargerScope, currentEmployeeId);

    const contact = await this.prisma.contact.create({
      data: {
        contactName: dto.contactName,
        customerId: dto.customerId,
        sex: dto.sex ?? undefined,
        mobile: dto.mobile ?? undefined,
        phone: dto.phone ?? undefined,
        email: dto.email ?? undefined,
        wechat: dto.wechat ?? undefined,
        position: dto.position ?? undefined,
        department: dto.department ?? undefined,
        // KP 标记（2026-06-20 治理引入）— 默认 false，由 prisma schema 兜底
        isKp: dto.isKp ?? undefined,
        kpRole: dto.kpRole ?? undefined,
        remark: dto.remark ?? undefined,
        ...auditCreate(currentUser),
      },
      include: CONTACT_RESPONSE_INCLUDE,
    });

    const response = toContactResponse(contact);
    await this.changeLog?.logChange({
      module: 'contacts',
      action: 'create',
      target: response.id,
      targetName: response.contactName,
      currentUser,
      after: response,
    });
    return response;
  }

  async update(
    id: string,
    dto: UpdateContactDto,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<ContactResponseOutput> {
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);

    const { version: requestVersion, ...restDto } = dto;

    // 若本次要改属到新客户，校验新 customerId 也在范围内且未软删
    // （existing.customerId 已由 findOne 保证在范围内，无需重复校验旧值）
    if (restDto.customerId !== undefined && restDto.customerId !== existing.customerId) {
      await this.assertCustomerInScope(restDto.customerId, chargerScope, currentEmployeeId);
    }

    try {
      const contact = await this.prisma.contact.update({
        where: {
          id,
          ...(requestVersion !== undefined ? { version: requestVersion } : {}),
        },
        data: {
          ...restDto,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
        include: CONTACT_RESPONSE_INCLUDE,
      });

      const response = toContactResponse(contact);
      await this.changeLog?.logChange({
        module: 'contacts',
        action: 'update',
        target: id,
        targetName: response.contactName,
        currentUser,
        before: existing,
        after: response,
      });
      return response;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
        );
      }
      throw error;
    }
  }

  async remove(
    id: string,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<void> {
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);

    const deleted = await this.prisma.contact.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        ...auditUpdate(currentUser),
      },
    });

    await this.changeLog?.logChange({
      module: 'contacts',
      action: 'delete',
      target: id,
      targetName: existing.contactName,
      currentUser,
      before: existing,
      after: deleted,
    });
  }

  private buildLegacyFilters(query: QueryContactDto): Record<string, unknown> {
    return {
      customerId: query.customerId,
      status: query.status,
    };
  }
}
