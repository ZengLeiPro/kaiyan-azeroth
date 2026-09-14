import { Prisma, PrismaClient } from '@prisma/client';

import { toJsonValue } from '../../src/common/utils/json-type-helpers';
import { APPROVAL_FLOW_FILTER_REGISTRY } from '../../src/modules/approval-flows/approval-flows.filter-registry';
import { CONTACT_FILTER_REGISTRY } from '../../src/modules/contacts/contacts.filter-registry';
import { CRM_PRODUCT_FILTER_REGISTRY } from '../../src/modules/crm-products/crm-products.filter-registry';
import { CRM_WORK_DAILY_FILTER_REGISTRY } from '../../src/modules/crm-work-dailies/crm-work-dailies.filter-registry';
import { CUSTOMER_FILTER_REGISTRY } from '../../src/modules/customers/customers.filter-registry';
import { DEPARTMENT_FILTER_REGISTRY } from '../../src/modules/departments/departments.filter-registry';
import { DINGTALK_LOG_FILTER_REGISTRY } from '../../src/modules/dingtalk-logs/dingtalk-logs.filter-registry';
import { EFFORT_RECORD_FILTER_REGISTRY } from '../../src/modules/effort-records/effort-records.filter-registry';
import { EMPLOYEE_LEAVE_FILTER_REGISTRY } from '../../src/modules/employee-leaves/employee-leaves.filter-registry';
import { EMPLOYEE_FILTER_REGISTRY } from '../../src/modules/employees/employees.filter-registry';
import { INVOICE_FILTER_REGISTRY } from '../../src/modules/invoices/invoices.filter-registry';
import { KEEP_RECORD_FILTER_REGISTRY } from '../../src/modules/keep-records/keep-records.filter-registry';
import { OPPORTUNITY_FILTER_REGISTRY } from '../../src/modules/opportunities/opportunities.filter-registry';
import { PAYMENT_FILTER_REGISTRY } from '../../src/modules/payments/payments.filter-registry';
import { PROJECT_TICKET_FILTER_REGISTRY } from '../../src/modules/project-tickets/project-tickets.filter-registry';
import { PROJECT_FILTER_REGISTRY } from '../../src/modules/projects/projects.filter-registry';
import { ROLE_FILTER_REGISTRY } from '../../src/modules/roles/roles.filter-registry';
import { SALE_ORDER_FILTER_REGISTRY } from '../../src/modules/sale-orders/sale-orders.filter-registry';
import { VISIT_RECORD_FILTER_REGISTRY } from '../../src/modules/visit-records/visit-records.filter-registry';

/**
 * 注意：本 seed 的目的是在一个全新的库里把 registry 默认配置写入 filter_schemes。
 * 现网已有的 pageKey 记录会被 findFirst 跳过，保持 ADMIN 通过 UI 做的自定义不被覆盖。
 * 禁止在 CI/生产环境自动执行此 seed（与 plan §硬约束一致）。
 */
const FILTER_REGISTRIES = [
  CUSTOMER_FILTER_REGISTRY,
  INVOICE_FILTER_REGISTRY,
  PAYMENT_FILTER_REGISTRY,
  KEEP_RECORD_FILTER_REGISTRY,
  VISIT_RECORD_FILTER_REGISTRY,
  SALE_ORDER_FILTER_REGISTRY,
  CONTACT_FILTER_REGISTRY,
  OPPORTUNITY_FILTER_REGISTRY,
  CRM_PRODUCT_FILTER_REGISTRY,
  CRM_WORK_DAILY_FILTER_REGISTRY,
  PROJECT_FILTER_REGISTRY,
  PROJECT_TICKET_FILTER_REGISTRY,
  EFFORT_RECORD_FILTER_REGISTRY,
  EMPLOYEE_FILTER_REGISTRY,
  DEPARTMENT_FILTER_REGISTRY,
  APPROVAL_FLOW_FILTER_REGISTRY,
  DINGTALK_LOG_FILTER_REGISTRY,
  EMPLOYEE_LEAVE_FILTER_REGISTRY,
  ROLE_FILTER_REGISTRY,
];

export async function seedFilterSchemes(prisma: PrismaClient) {
  console.log('[FilterSchemes] 正在创建筛选方案默认配置...');

  for (const registry of FILTER_REGISTRIES) {
    const existing = await prisma.filterScheme.findFirst({
      where: { pageKey: registry.pageKey },
    });

    if (!existing) {
      await prisma.filterScheme.create({
        data: {
          pageKey: registry.pageKey,
          configJson: toJsonValue(registry.defaults) ?? Prisma.JsonNull,
          version: 1,
        },
      });
      console.log(`  - 创建筛选方案: ${registry.pageKey}`);
    } else {
      console.log(`  - 筛选方案已存在: ${registry.pageKey}`);
    }
  }

  console.log('[FilterSchemes] 筛选方案默认配置创建完成');
}
