import type { EmployeeLeaveResponseOutput } from '@ky-azeroth/shared/schemas/employee-leave';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { FilterApplierService } from '../../common/filter-scheme';
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { calculatePagination, serializeEntity } from '../../common/utils/response-helpers';
import { QueryEmployeeLeaveDto } from './dto/query-employee-leave.dto';
import { EMPLOYEE_LEAVE_FILTER_REGISTRY } from './employee-leaves.filter-registry';

@Injectable()
export class EmployeeLeavesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filterApplier: FilterApplierService
  ) {}

  async findAll(
    query: QueryEmployeeLeaveDto,
    rawQuery?: unknown
  ): Promise<PaginatedResponse<EmployeeLeaveResponseOutput>> {
    const { page = 1, pageSize = 20 } = query;
    const { skip } = calculatePagination(page, pageSize);

    const where = await this.filterApplier.buildWhere<Prisma.EmployeeLeaveWhereInput>({
      registry: EMPLOYEE_LEAVE_FILTER_REGISTRY,
      rawQuery,
      legacyKeyword: query.keyword,
      legacyFilters: { dingtalkUserId: query.dingtalkUserId },
      chargerScope: null,
      baseWhere: {},
    });

    const [total, items] = await Promise.all([
      this.prisma.employeeLeave.count({ where }),
      this.prisma.employeeLeave.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { leaveTime: 'desc' },
      }),
    ]);

    return {
      items: items.map((item) =>
        serializeEntity<EmployeeLeaveResponseOutput>(item as Record<string, unknown>)
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string): Promise<EmployeeLeaveResponseOutput> {
    const leave = await this.prisma.employeeLeave.findUnique({
      where: { id },
    });

    if (!leave) {
      throw new NotFoundException('员工离职记录不存在');
    }

    return serializeEntity<EmployeeLeaveResponseOutput>(leave as Record<string, unknown>);
  }
}
