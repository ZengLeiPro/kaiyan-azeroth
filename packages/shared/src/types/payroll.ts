import type { DecimalNumber } from './common';

export interface IPayrollPeriodSummary {
  id: string;
  periodKey: string;
  year: number;
  month: number;
  sheetName?: string | null;
  companyName?: string | null;
  /** @precision Decimal */
  expectedWorkDays?: DecimalNumber | null;
  statementDate?: string | null;
  sourceFileName?: string | null;
  importBatchId?: string | null;
  status: string;
  rowCount: number;
  remark?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface IPayrollEmployeeInfo {
  id: string;
  name: string;
  serialNumber?: string | null;
}

export interface IPayrollDepartmentInfo {
  id: string;
  name: string;
}

export interface IPayroll {
  id: string;
  payrollPeriodId: string;
  periodKey: string;
  employeeId?: string | null;
  departmentId?: string | null;
  employeeNameSnapshot: string;
  departmentNameSnapshot?: string | null;
  positionSnapshot?: string | null;
  entryDateSnapshot?: string | null;
  bankNameSnapshot?: string | null;
  bankCardNoSnapshot?: string | null;
  remarkSnapshot?: string | null;
  /** @precision Decimal */
  actualAttendanceDays?: DecimalNumber | null;
  /** @precision Decimal */
  absenceDays?: DecimalNumber | null;
  /** @precision Decimal */
  grossBaseSalary?: DecimalNumber | null;
  /** @precision Decimal */
  grossPerformance?: DecimalNumber | null;
  /** @precision Decimal */
  grossCommission?: DecimalNumber | null;
  /** @precision Decimal */
  grossOther?: DecimalNumber | null;
  /** @precision Decimal */
  grossBonusYearEnd?: DecimalNumber | null;
  /** @precision Decimal */
  grossTotal?: DecimalNumber | null;
  /** @precision Decimal */
  absenceDeductionAmount?: DecimalNumber | null;
  /** @precision Decimal */
  lateDeductionAmount?: DecimalNumber | null;
  /** @precision Decimal */
  adminDeductionAmount?: DecimalNumber | null;
  /** @precision Decimal */
  socialSecurityPersonalAmount?: DecimalNumber | null;
  /** @precision Decimal */
  housingFundPersonalAmount?: DecimalNumber | null;
  /** @precision Decimal */
  deductionOtherTotal?: DecimalNumber | null;
  /** @precision Decimal */
  deductionTotal?: DecimalNumber | null;
  /** @precision Decimal */
  socialSecurityCompanyAmount?: DecimalNumber | null;
  /** @precision Decimal */
  housingFundCompanyAmount?: DecimalNumber | null;
  /** @precision Decimal */
  companyBurdenTotal?: DecimalNumber | null;
  /** @precision Decimal */
  netSalary?: DecimalNumber | null;
  /** @precision Decimal */
  totalLaborCost?: DecimalNumber | null;
  sourceSheetName?: string | null;
  sourceRowIndex?: number | null;
  sourceRawJson?: unknown;
  importBatchId?: string | null;
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}

export interface IPayrollResponse extends IPayroll {
  payrollPeriod?: IPayrollPeriodSummary;
  employee?: IPayrollEmployeeInfo | null;
  department?: IPayrollDepartmentInfo | null;
}

export interface ICreatePayroll {
  periodKey: string;
  employeeId: string | null;
  departmentId: string | null;
  employeeNameSnapshot: string;
  departmentNameSnapshot: string | null;
  positionSnapshot: string | null;
  entryDateSnapshot: string | null;
  bankNameSnapshot: string | null;
  bankCardNoSnapshot: string | null;
  remarkSnapshot: string | null;
  /** @precision Decimal */
  actualAttendanceDays: DecimalNumber | null;
  /** @precision Decimal */
  absenceDays: DecimalNumber | null;
  /** @precision Decimal */
  grossBaseSalary: DecimalNumber | null;
  /** @precision Decimal */
  grossPerformance: DecimalNumber | null;
  /** @precision Decimal */
  grossCommission: DecimalNumber | null;
  /** @precision Decimal */
  grossOther: DecimalNumber | null;
  /** @precision Decimal */
  grossBonusYearEnd: DecimalNumber | null;
  /** @precision Decimal */
  grossTotal: DecimalNumber | null;
  /** @precision Decimal */
  absenceDeductionAmount: DecimalNumber | null;
  /** @precision Decimal */
  lateDeductionAmount: DecimalNumber | null;
  /** @precision Decimal */
  adminDeductionAmount: DecimalNumber | null;
  /** @precision Decimal */
  socialSecurityPersonalAmount: DecimalNumber | null;
  /** @precision Decimal */
  housingFundPersonalAmount: DecimalNumber | null;
  /** @precision Decimal */
  deductionOtherTotal: DecimalNumber | null;
  /** @precision Decimal */
  deductionTotal: DecimalNumber | null;
  /** @precision Decimal */
  socialSecurityCompanyAmount: DecimalNumber | null;
  /** @precision Decimal */
  housingFundCompanyAmount: DecimalNumber | null;
  /** @precision Decimal */
  companyBurdenTotal: DecimalNumber | null;
  /** @precision Decimal */
  netSalary: DecimalNumber | null;
  /** @precision Decimal */
  totalLaborCost: DecimalNumber | null;
}

export type IUpdatePayroll = Partial<ICreatePayroll> & {
  version: number;
};

export interface IBatchPayrollDelete {
  ids: string[];
  versions: Record<string, number>;
}

export interface IPayrollImportIssue {
  sheetName?: string | null;
  rowIndex?: number | null;
  level: 'warning' | 'error';
  message: string;
}

export interface IPayrollImportPreviewRecord {
  employeeNameSnapshot: string;
  departmentNameSnapshot?: string | null;
  positionSnapshot?: string | null;
  /** @precision Decimal */
  netSalary?: DecimalNumber | null;
  /** @precision Decimal */
  totalLaborCost?: DecimalNumber | null;
}

export interface IPayrollImportPreviewPeriod extends IPayrollPeriodSummary {
  sampleRecords: IPayrollImportPreviewRecord[];
  warnings: IPayrollImportIssue[];
}

export interface IPayrollImportPreviewResponse {
  sourceFileName: string;
  totalSheets: number;
  parsedSheets: number;
  totalRows: number;
  periods: IPayrollImportPreviewPeriod[];
  warnings: IPayrollImportIssue[];
  errors: IPayrollImportIssue[];
}

export interface IPayrollImportBatch {
  id: string;
  sourceFileName?: string | null;
  totalSheets: number;
  parsedSheets: number;
  totalRows: number;
  successRows: number;
  failedRows: number;
  skippedRows: number;
  strategy: string;
  status: string;
  summaryJson?: unknown;
  errorReportJson?: unknown;
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
  periods?: IPayrollPeriodSummary[];
}

export interface IPayrollImportCommitResponse {
  batch: IPayrollImportBatch;
  replacedPeriods: string[];
  createdRecords: number;
}

// Prisma model 命名对齐
export type IPayrollPeriod = IPayrollPeriodSummary;
export type IPayrollRecord = IPayrollResponse;
