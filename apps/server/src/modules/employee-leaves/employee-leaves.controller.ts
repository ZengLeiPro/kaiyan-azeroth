import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import {
  EmployeeLeaveListResponseDto,
  EmployeeLeaveResponseDto,
} from './dto/employee-leave-response.dto';
import { QueryEmployeeLeaveDto } from './dto/query-employee-leave.dto';
import { EmployeeLeavesService } from './employee-leaves.service';

@ApiTags('员工离职记录')
@ApiBearerAuth()
@Controller('employee-leaves')
export class EmployeeLeavesController {
  constructor(private readonly employeeLeavesService: EmployeeLeavesService) {}

  @Get()
  @ApiOperation({ summary: '查询员工离职记录列表' })
  @RequirePermission({ module: 'reports', menu: 'employee_leaves', action: 'view' })
  findAll(
    @Query() query: QueryEmployeeLeaveDto,
    @Req() request: Request
  ): Promise<EmployeeLeaveListResponseDto> {
    return this.employeeLeavesService.findAll(query, request.query);
  }

  @Get(':id')
  @ApiOperation({ summary: '查询员工离职记录详情' })
  @RequirePermission({ module: 'reports', menu: 'employee_leaves', action: 'view' })
  findOne(@Param('id') id: string): Promise<EmployeeLeaveResponseDto> {
    return this.employeeLeavesService.findOne(id);
  }
}
