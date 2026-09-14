import { createPayrollSchema } from '@ky-azeroth/shared/schemas/payroll';
import type {
  ICreatePayroll,
  IPayrollImportBatch,
  IPayrollImportPreviewResponse,
  IPayrollResponse,
} from '@ky-azeroth/shared/types/payroll';
import { z } from 'zod';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PayrollProfile extends IPayrollResponse {}

export interface PayrollFormData extends ICreatePayroll {
  version?: number;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PayrollImportPreview extends IPayrollImportPreviewResponse {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PayrollImportBatch extends IPayrollImportBatch {}

// createPayrollSchema 使用了 z.preprocess，导致 _input 类型与 PayrollFormData 不完全兼容，
// 因此需要 as unknown as 断言来满足 useCrud 的 z.ZodType<TFormData> 约束。
export const payrollFormSchema = createPayrollSchema.extend({
  version: z.number().int().optional(),
}) as unknown as z.ZodType<PayrollFormData>;

export function toPayrollProfile(data: IPayrollResponse): PayrollProfile {
  return {
    ...data,
  };
}

export function toPayrollFormData(data: PayrollProfile): PayrollFormData {
  return {
    periodKey: data.periodKey,
    employeeId: data.employeeId ?? null,
    departmentId: data.departmentId ?? null,
    employeeNameSnapshot: data.employeeNameSnapshot,
    departmentNameSnapshot: data.departmentNameSnapshot ?? null,
    positionSnapshot: data.positionSnapshot ?? null,
    entryDateSnapshot: data.entryDateSnapshot ?? null,
    bankNameSnapshot: data.bankNameSnapshot ?? null,
    bankCardNoSnapshot: data.bankCardNoSnapshot ?? null,
    remarkSnapshot: data.remarkSnapshot ?? null,
    actualAttendanceDays: data.actualAttendanceDays ?? null,
    absenceDays: data.absenceDays ?? null,
    grossBaseSalary: data.grossBaseSalary ?? null,
    grossPerformance: data.grossPerformance ?? null,
    grossCommission: data.grossCommission ?? null,
    grossOther: data.grossOther ?? null,
    grossBonusYearEnd: data.grossBonusYearEnd ?? null,
    grossTotal: data.grossTotal ?? null,
    absenceDeductionAmount: data.absenceDeductionAmount ?? null,
    lateDeductionAmount: data.lateDeductionAmount ?? null,
    adminDeductionAmount: data.adminDeductionAmount ?? null,
    socialSecurityPersonalAmount: data.socialSecurityPersonalAmount ?? null,
    housingFundPersonalAmount: data.housingFundPersonalAmount ?? null,
    deductionOtherTotal: data.deductionOtherTotal ?? null,
    deductionTotal: data.deductionTotal ?? null,
    socialSecurityCompanyAmount: data.socialSecurityCompanyAmount ?? null,
    housingFundCompanyAmount: data.housingFundCompanyAmount ?? null,
    companyBurdenTotal: data.companyBurdenTotal ?? null,
    netSalary: data.netSalary ?? null,
    totalLaborCost: data.totalLaborCost ?? null,
    version: data.version,
  };
}

export function toPayrollPayload(form: PayrollFormData) {
  // totalLaborCost 后端派生（= 应发合计 + 公司负担合计），前端 payload 不再携带
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { totalLaborCost, ...payload } = form;
  return payload;
}
