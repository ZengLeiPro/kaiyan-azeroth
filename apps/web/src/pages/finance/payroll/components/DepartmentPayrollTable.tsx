import type { IPayrollResponse } from '@ky-azeroth/shared/types/payroll';
import { ChevronRight, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import type { DepartmentGroup, MonthlySummary } from '../hooks/use-monthly-payroll';

// ── Helpers ──

function fmt(value?: number | null): string {
  if (value === null || value === undefined) return '-';
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDays(value?: number | null): string {
  if (value === null || value === undefined) return '-';
  return String(Number(value));
}

// ── Props ──

interface DepartmentPayrollTableProps {
  departmentGroups: DepartmentGroup[];
  grandTotal: MonthlySummary;
  isLoading: boolean;
}

// ── Column config ──

interface ColumnDef {
  key: string;
  label: string;
  width?: number;
  align?: 'right';
}

const COLUMNS: ColumnDef[] = [
  { key: 'expand', label: '', width: 32 },
  { key: 'name', label: '姓名' },
  { key: 'position', label: '职位' },
  { key: 'attendance', label: '出勤', align: 'right' },
  { key: 'baseSalary', label: '基本工资', align: 'right' },
  { key: 'performance', label: '绩效', align: 'right' },
  { key: 'commission', label: '提成', align: 'right' },
  { key: 'otherGross', label: '其他', align: 'right' },
  { key: 'grossTotal', label: '应发合计', align: 'right' },
  { key: 'deductionTotal', label: '扣款合计', align: 'right' },
  { key: 'netSalary', label: '实发工资', align: 'right' },
];

const COL_COUNT = COLUMNS.length;

// ── Expanded detail ──

function ExpandedDetail({ record }: { record: IPayrollResponse }) {
  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={COL_COUNT} className="px-8 py-3">
        <div className="grid grid-cols-1 gap-x-12 gap-y-1 text-sm md:grid-cols-3">
          <div>
            <div className="mb-1 font-medium text-muted-foreground">扣款明细</div>
            <DetailLine label="缺勤扣款" value={fmt(record.absenceDeductionAmount)} />
            <DetailLine label="迟到扣款" value={fmt(record.lateDeductionAmount)} />
            <DetailLine label="行政扣款" value={fmt(record.adminDeductionAmount)} />
            <DetailLine label="社保个人" value={fmt(record.socialSecurityPersonalAmount)} />
            <DetailLine label="公积金个人" value={fmt(record.housingFundPersonalAmount)} />
          </div>
          <div>
            <div className="mb-1 font-medium text-muted-foreground">公司负担</div>
            <DetailLine label="社保公司" value={fmt(record.socialSecurityCompanyAmount)} />
            <DetailLine label="公积金公司" value={fmt(record.housingFundCompanyAmount)} />
            <DetailLine label="公司负担合计" value={fmt(record.companyBurdenTotal)} bold />
          </div>
          <div>
            <div className="mb-1 font-medium text-muted-foreground">汇总</div>
            <DetailLine label="年终奖" value={fmt(record.grossBonusYearEnd)} />
            <DetailLine label="人工成本" value={fmt(record.totalLaborCost)} bold />
            {record.remarkSnapshot && <DetailLine label="备注" value={record.remarkSnapshot} />}
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

function DetailLine({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`whitespace-pre-wrap break-words text-right font-mono ${bold ? 'font-semibold' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

// ── Main component ──

export function DepartmentPayrollTable({
  departmentGroups,
  grandTotal,
  isLoading,
}: DepartmentPayrollTableProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (departmentGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <p>该月份暂无薪资数据</p>
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((col) => (
              <TableHead
                key={col.key}
                className={col.align === 'right' ? 'text-right' : ''}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          {departmentGroups.map((group) => (
            <DepartmentSection
              key={group.departmentName}
              group={group}
              expandedIds={expandedIds}
              onToggleExpand={toggleExpand}
            />
          ))}
        </TableBody>

        <TableFooter>
          <TableRow className="font-bold">
            <TableCell />
            <TableCell>合计</TableCell>
            <TableCell />
            <TableCell className="text-right">{grandTotal.headcount}人</TableCell>
            <TableCell />
            <TableCell />
            <TableCell />
            <TableCell />
            <TableCell className="text-right font-mono">{fmt(grandTotal.grossTotal)}</TableCell>
            <TableCell className="text-right font-mono">{fmt(grandTotal.deductionTotal)}</TableCell>
            <TableCell className="text-right font-mono">{fmt(grandTotal.netSalaryTotal)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

// ── Department section ──

function DepartmentSection({
  group,
  expandedIds,
  onToggleExpand,
}: {
  group: DepartmentGroup;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
}) {
  return (
    <>
      {/* Department header row */}
      <TableRow className="bg-muted/50 hover:bg-muted/50">
        <TableCell colSpan={COL_COUNT} className="py-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">
              {group.departmentName}
              <span className="ml-1 font-normal text-muted-foreground">
                ({group.subtotal.headcount}人)
              </span>
            </span>
            <span className="space-x-4 text-xs text-muted-foreground">
              <span>
                应发: <span className="font-mono">{fmt(group.subtotal.grossTotal)}</span>
              </span>
              <span>
                实发: <span className="font-mono">{fmt(group.subtotal.netSalaryTotal)}</span>
              </span>
            </span>
          </div>
        </TableCell>
      </TableRow>

      {/* Employee rows */}
      {group.records.map((record) => {
        const isExpanded = expandedIds.has(record.id);
        return (
          <PayrollRow
            key={record.id}
            record={record}
            isExpanded={isExpanded}
            onToggle={() => onToggleExpand(record.id)}
          />
        );
      })}
    </>
  );
}

// ── Single row ──

function PayrollRow({
  record,
  isExpanded,
  onToggle,
}: {
  record: IPayrollResponse;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow className="cursor-pointer transition-colors hover:bg-muted/30" onClick={onToggle}>
        <TableCell className="w-8 px-2">
          <ChevronRight
            className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          />
        </TableCell>
        <TableCell className="font-medium">{record.employeeNameSnapshot}</TableCell>
        <TableCell className="text-muted-foreground">{record.positionSnapshot || '-'}</TableCell>
        <TableCell className="text-right font-mono">
          {fmtDays(record.actualAttendanceDays)}
        </TableCell>
        <TableCell className="text-right font-mono">{fmt(record.grossBaseSalary)}</TableCell>
        <TableCell className="text-right font-mono">{fmt(record.grossPerformance)}</TableCell>
        <TableCell className="text-right font-mono">{fmt(record.grossCommission)}</TableCell>
        <TableCell className="text-right font-mono">{fmt(record.grossOther)}</TableCell>
        <TableCell className="text-right font-mono font-medium">{fmt(record.grossTotal)}</TableCell>
        <TableCell className="text-right font-mono text-amber-700 dark:text-amber-400">
          {fmt(record.deductionTotal)}
        </TableCell>
        <TableCell className="text-right font-mono font-semibold">
          {fmt(record.netSalary)}
        </TableCell>
      </TableRow>
      {isExpanded && <ExpandedDetail record={record} />}
    </>
  );
}
