import type { SystemParamResponse } from '@ky-azeroth/shared/schemas';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { auditUpdate } from '../../common/utils/audit-helper';
import { serializeEntity } from '../../common/utils/response-helpers';
import { UpdateSystemParamDto } from './dto';

type CurrentUser = { id: string; employeeId?: string | null };

@Injectable()
export class SystemParamsService {
  constructor(private prisma: PrismaService) {}

  /**
   * 查询系统参数列表
   */
  async findAll(params: { group?: string }) {
    const { group } = params;

    const where: Prisma.SystemConfigWhereInput = {};

    if (group) {
      where.group = group;
    }

    const rawItems = await this.prisma.systemConfig.findMany({
      where,
      orderBy: [{ group: 'asc' }, { code: 'asc' }],
    });

    const items = rawItems.map((item) => serializeEntity<SystemParamResponse>(item));

    // 按组分类返回
    const grouped = items.reduce(
      (acc, item) => {
        if (!acc[item.group]) {
          acc[item.group] = [];
        }
        acc[item.group]!.push(item);
        return acc;
      },
      {} as Record<string, SystemParamResponse[]>
    );

    return {
      items,
      grouped,
      total: items.length,
    };
  }

  /**
   * 查询单个系统参数
   */
  async findOne(id: string): Promise<SystemParamResponse> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { id },
    });

    if (!config) {
      throw new NotFoundException(`系统参数 ${id} 不存在`);
    }

    return serializeEntity<SystemParamResponse>(config);
  }

  /**
   * 根据 code 查询系统参数
   */
  async findByCode(code: string): Promise<SystemParamResponse> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { code },
    });

    if (!config) {
      throw new NotFoundException(`系统参数 ${code} 不存在`);
    }

    return serializeEntity<SystemParamResponse>(config);
  }

  /**
   * 更新系统参数
   */
  async update(
    id: string,
    updateDto: UpdateSystemParamDto,
    currentUser?: CurrentUser
  ): Promise<SystemParamResponse> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { id },
    });

    if (!config) {
      throw new NotFoundException(`系统参数 ${id} 不存在`);
    }

    const { version: requestVersion } = updateDto;

    try {
      const updated = await this.prisma.systemConfig.update({
        where: {
          id,
          ...(requestVersion !== undefined ? { version: requestVersion } : {}),
        },
        data: {
          value: updateDto.value,
          description: updateDto.description ?? config.description,
          version: { increment: 1 },
          ...auditUpdate(currentUser),
        },
      });
      return serializeEntity<SystemParamResponse>(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${config.version}。请刷新后重试。`
        );
      }
      throw error;
    }
  }

  /**
   * 获取参数值（带类型转换）
   */
  async getValue(code: string): Promise<string | number | boolean | object | null> {
    try {
      const config = await this.findByCode(code);

      switch (config.type) {
        case 'number':
          return Number(config.value);
        case 'boolean':
          return config.value.toLowerCase() === 'true';
        case 'json':
          return JSON.parse(config.value);
        default:
          return config.value;
      }
    } catch {
      return null;
    }
  }
}
