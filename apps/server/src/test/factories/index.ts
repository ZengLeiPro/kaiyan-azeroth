export type { ContactData } from './contact.factory';
export { buildContact, createContact, resetContactSeq } from './contact.factory';
export type { CrmProductData } from './crm-product.factory';
export { buildCrmProduct, createCrmProduct, resetCrmProductSeq } from './crm-product.factory';
export type { CrmWorkDailyData } from './crm-work-daily.factory';
export {
  buildCrmWorkDaily,
  createCrmWorkDaily,
  resetCrmWorkDailySeq,
} from './crm-work-daily.factory';
export type { CustomerData } from './customer.factory';
export { buildCustomer, createCustomer, resetCustomerSeq } from './customer.factory';
export type { DepartmentData } from './department.factory';
export { buildDepartment, createDepartment, resetDepartmentSeq } from './department.factory';
export type { EffortRecordData } from './effort-record.factory';
export {
  buildEffortRecord,
  createEffortRecord,
  resetEffortRecordSeq,
} from './effort-record.factory';
export type { EmployeeData } from './employee.factory';
export { buildEmployee, createEmployee, resetEmployeeSeq } from './employee.factory';
export type { KeepRecordData } from './keep-record.factory';
export { buildKeepRecord, createKeepRecord, resetKeepRecordSeq } from './keep-record.factory';
export type { OpportunityData } from './opportunity.factory';
export { buildOpportunity, createOpportunity, resetOpportunitySeq } from './opportunity.factory';
export type { RoleData } from './role.factory';
export { buildRole, createRole, resetRoleSeq } from './role.factory';
export type { SaleOrderData } from './sale-order.factory';
export { buildSaleOrder, createSaleOrder, resetSaleOrderSeq } from './sale-order.factory';
export type { UserData } from './user.factory';
export { buildUser, createUser, resetUserSeq } from './user.factory';
export type { VisitRecordData } from './visit-record.factory';
export { buildVisitRecord, createVisitRecord, resetVisitRecordSeq } from './visit-record.factory';

import { resetContactSeq } from './contact.factory';
import { resetCrmProductSeq } from './crm-product.factory';
import { resetCrmWorkDailySeq } from './crm-work-daily.factory';
import { resetCustomerSeq } from './customer.factory';
import { resetDepartmentSeq } from './department.factory';
import { resetEffortRecordSeq } from './effort-record.factory';
import { resetEmployeeSeq } from './employee.factory';
import { resetKeepRecordSeq } from './keep-record.factory';
import { resetOpportunitySeq } from './opportunity.factory';
import { resetRoleSeq } from './role.factory';
import { resetSaleOrderSeq } from './sale-order.factory';
import { resetUserSeq } from './user.factory';
import { resetVisitRecordSeq } from './visit-record.factory';

/**
 * 重置所有工厂序号计数器
 */
export function resetAllFactorySeqs(): void {
  resetContactSeq();
  resetCrmProductSeq();
  resetCrmWorkDailySeq();
  resetCustomerSeq();
  resetDepartmentSeq();
  resetEffortRecordSeq();
  resetEmployeeSeq();
  resetKeepRecordSeq();
  resetOpportunitySeq();
  resetRoleSeq();
  resetSaleOrderSeq();
  resetUserSeq();
  resetVisitRecordSeq();
}
