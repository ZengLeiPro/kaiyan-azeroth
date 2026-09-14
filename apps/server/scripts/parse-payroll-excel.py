import json
import math
import os
import re
import sys
import zipfile
from datetime import datetime, date
from decimal import Decimal, ROUND_HALF_UP
from openpyxl import load_workbook

path = sys.argv[1]
display_name = sys.argv[2] if len(sys.argv) > 2 else path

MAX_ARCHIVE_ENTRIES = 5000
MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
MAX_ENTRY_BYTES = 32 * 1024 * 1024
MAX_COMPRESSION_RATIO = 100
MAX_SHEETS = 24
MAX_ROWS = 10000
MAX_COLUMNS = 200


def preflight_xlsx(file_path):
    with zipfile.ZipFile(file_path, 'r') as archive:
        entries = archive.infolist()
        if not entries or len(entries) > MAX_ARCHIVE_ENTRIES:
            raise ValueError('XLSX archive entry count exceeds safety budget')
        total_size = 0
        for entry in entries:
            if entry.flag_bits & 0x1:
                raise ValueError('Encrypted XLSX is not supported')
            if entry.file_size > MAX_ENTRY_BYTES:
                raise ValueError('XLSX archive entry exceeds safety budget')
            total_size += entry.file_size
            if total_size > MAX_UNCOMPRESSED_BYTES:
                raise ValueError('XLSX uncompressed size exceeds safety budget')
            if entry.file_size > 1024 and entry.file_size > max(entry.compress_size, 1) * MAX_COMPRESSION_RATIO:
                raise ValueError('XLSX compression ratio exceeds safety budget')

HEADER_MAP = {
    '应发工资/基本工资': 'grossBaseSalary',
    '应发工资/绩效': 'grossPerformance',
    '应发工资/提成': 'grossCommission',
    '应发工资/其他': 'grossOther',
    '缺勤扣款/天数': 'absenceDays',
    '缺勤扣款/扣款': 'absenceDeductionAmount',
    '其他应扣/迟到扣款': 'lateDeductionAmount',
    '其他应扣/行政扣款': 'adminDeductionAmount',
    '其他应扣/五险扣款': 'socialSecurityPersonalAmount',
    '其他应扣/一金扣款': 'housingFundPersonalAmount',
    '公司承担/五险扣款': 'socialSecurityCompanyAmount',
    '公司承担/一金扣款': 'housingFundCompanyAmount',
    '公司代扣/五险扣款': 'socialSecurityCompanyAmount',
    '公司代扣/一金扣款': 'housingFundCompanyAmount',
    '年终奖': 'grossBonusYearEnd',
    '实发工资': 'netSalary',
    '总人工成本': 'totalLaborCost',
    '公司人工成本': 'totalLaborCost',
    '银行': 'bankNameSnapshot',
    '银行卡号': 'bankCardNoSnapshot',
    '备注': 'remarkSnapshot',
    '序号': 'serialNo',
    '部门': 'departmentNameSnapshot',
    '职位': 'positionSnapshot',
    '姓名': 'employeeNameSnapshot',
    '入职时间': 'entryDateSnapshot',
    '实际出勤天数': 'actualAttendanceDays',
}


def clean(v):
    if v is None:
        return None
    if isinstance(v, str):
        v = v.replace('\n', '').replace('\t', '').strip()
        return v or None
    return v


def parse_date(v):
    if v in (None, ''):
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    text = str(v).strip().replace('/', '.').replace('-', '.')
    m = re.match(r'^(\d{4})\.(\d{1,2})\.(\d{1,2})$', text)
    if m:
        y, mo, d = m.groups()
        return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
    return None


def parse_number(v):
    if v in (None, ''):
        return None
    if isinstance(v, bool):
        return None
    try:
        num = float(v)
        if math.isnan(num):
            return None
        return num
    except Exception:
        text = str(v).replace(',', '').strip()
        if not text:
            return None
        try:
            return float(text)
        except Exception:
            return None


def sum_money(*values):
    total = Decimal('0')
    for value in values:
        if value is not None:
            total += Decimal(str(value))
    return float(total.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


def norm_title(v):
    return clean(v)


def build_headers(ws):
    row3 = [norm_title(ws.cell(3, c).value) for c in range(1, ws.max_column + 1)]
    row4 = [norm_title(ws.cell(4, c).value) for c in range(1, ws.max_column + 1)]
    headers = []
    prev_top = None
    for i, (top, sub) in enumerate(zip(row3, row4), start=1):
        if top:
            prev_top = top
        top = top or prev_top
        if top in ('年终奖', '实发工资', '总人工成本', '公司人工成本', '银行', '银行卡号', '备注', '序号', '部门', '职位', '姓名', '入职时间', '实际出勤天数'):
            canonical = HEADER_MAP.get(top)
        elif top and sub:
            canonical = HEADER_MAP.get(f'{top}/{sub}')
        else:
            canonical = None
        headers.append(canonical)
    return headers


def parse_period(sheet_name, title):
    text = f'{sheet_name} {title or ""}'
    m = re.search(r'(20\d{2}|\d{2})[^\d]?(\d{1,2})', text)
    if not m:
        return None
    year = int(m.group(1))
    if year < 100:
        year += 2000
    month = int(m.group(2))
    if not (1 <= month <= 12):
        return None
    if not (2020 <= year <= 2030):
        return None
    return f'{year:04d}-{month:02d}', year, month


def company_name(v):
    text = clean(v)
    if not text:
        return None
    text = str(text)
    if '单位：' in text:
        return text.split('单位：', 1)[1].strip() or None
    return text


def statement_date(row_values):
    for value in row_values:
        text = clean(value)
        if not text:
            continue
        m = re.search(r'制表日期[:：]?\s*(\d{4}[./-]\d{1,2}[./-]\d{1,2})', str(text))
        if m:
            return parse_date(m.group(1))
    return None


def expected_days(row_values):
    for idx, value in enumerate(row_values):
        text = clean(value)
        if text == '应出勤天数：' and idx + 1 < len(row_values):
            return parse_number(row_values[idx + 1])
        if isinstance(text, str) and '应出勤天数' in text:
            m = re.search(r'应出勤天数[:：]?\s*(\d+(?:\.\d+)?)', text)
            if m:
                return float(m.group(1))
    return None


preflight_xlsx(path)
wb = load_workbook(path, data_only=True, read_only=True, keep_links=False)
if len(wb.sheetnames) > MAX_SHEETS:
    raise ValueError('Workbook sheet count exceeds safety budget')
periods = []
warnings = []
errors = []
total_rows = 0
for ws in wb.worksheets:
    if ws.max_row > MAX_ROWS or ws.max_column > MAX_COLUMNS:
        raise ValueError(f'Worksheet {ws.title} dimensions exceed safety budget')
    title = clean(ws.cell(1, 1).value)
    parsed = parse_period(ws.title, title)
    if not parsed:
        warnings.append({'sheetName': ws.title, 'rowIndex': None, 'level': 'warning', 'message': '无法识别月份，已跳过该 sheet'})
        continue
    period_key, year, month = parsed
    headers = build_headers(ws)
    if 'employeeNameSnapshot' not in headers:
        errors.append({'sheetName': ws.title, 'rowIndex': 3, 'level': 'error', 'message': '缺少姓名列，无法导入'})
        continue

    carry = {'departmentNameSnapshot': None, 'positionSnapshot': None}
    records = []
    sheet_warnings = []
    for r in range(6, ws.max_row + 1):
        raw = [ws.cell(r, c).value for c in range(1, ws.max_column + 1)]
        if all(clean(v) is None for v in raw):
            continue
        employee_name = clean(raw[headers.index('employeeNameSnapshot')]) if 'employeeNameSnapshot' in headers else None
        if not employee_name or str(employee_name).startswith('合计'):
            continue

        obj = {}
        for idx, canonical in enumerate(headers):
            if not canonical:
                continue
            value = raw[idx]
            if canonical in ('employeeNameSnapshot', 'departmentNameSnapshot', 'positionSnapshot', 'bankNameSnapshot', 'bankCardNoSnapshot', 'remarkSnapshot'):
                obj[canonical] = clean(value)
            elif canonical == 'entryDateSnapshot':
                obj[canonical] = parse_date(value)
            else:
                obj[canonical] = parse_number(value)

        if not obj.get('departmentNameSnapshot'):
            obj['departmentNameSnapshot'] = carry['departmentNameSnapshot']
        else:
            carry['departmentNameSnapshot'] = obj['departmentNameSnapshot']
        if not obj.get('positionSnapshot'):
            obj['positionSnapshot'] = carry['positionSnapshot']
        else:
            carry['positionSnapshot'] = obj['positionSnapshot']

        _gross_parts = [obj.get('grossBaseSalary'), obj.get('grossPerformance'), obj.get('grossCommission'), obj.get('grossOther'), obj.get('grossBonusYearEnd')]
        obj['grossTotal'] = sum(v or 0 for v in _gross_parts) if any(v is not None for v in _gross_parts) else None

        _deduction_other_parts = [obj.get('lateDeductionAmount'), obj.get('adminDeductionAmount'), obj.get('socialSecurityPersonalAmount'), obj.get('housingFundPersonalAmount')]
        obj['deductionOtherTotal'] = sum(v or 0 for v in _deduction_other_parts) if any(v is not None for v in _deduction_other_parts) else None

        _deduction_parts = [obj.get('absenceDeductionAmount'), obj.get('deductionOtherTotal')]
        obj['deductionTotal'] = sum(v or 0 for v in _deduction_parts) if any(v is not None for v in _deduction_parts) else None

        _company_burden_parts = [obj.get('socialSecurityCompanyAmount'), obj.get('housingFundCompanyAmount')]
        obj['companyBurdenTotal'] = sum(v or 0 for v in _company_burden_parts) if any(v is not None for v in _company_burden_parts) else None

        excel_total_labor_cost = obj.get('totalLaborCost')
        obj['totalLaborCost'] = sum_money(obj.get('grossTotal'), obj.get('companyBurdenTotal'))
        if excel_total_labor_cost is not None and abs(excel_total_labor_cost - obj['totalLaborCost']) > 0.01:
            sheet_warnings.append({
                'sheetName': ws.title,
                'rowIndex': r,
                'level': 'warning',
                'message': f"人工成本已按「应发合计 + 公司负担合计」重算：Excel={excel_total_labor_cost}，系统={obj['totalLaborCost']}",
            })

        obj['sourceSheetName'] = ws.title
        obj['sourceRowIndex'] = r
        obj['sourceRawJson'] = {str(i+1): (raw[i].isoformat() if isinstance(raw[i], (datetime, date)) else raw[i]) for i in range(len(raw)) if raw[i] is not None}
        records.append(obj)

    total_rows += len(records)
    periods.append({
        'periodKey': period_key,
        'year': year,
        'month': month,
        'sheetName': ws.title,
        'companyName': company_name(ws.cell(2, 1).value),
        'expectedWorkDays': expected_days([ws.cell(2, c).value for c in range(1, ws.max_column + 1)]),
        'statementDate': statement_date([ws.cell(2, c).value for c in range(1, ws.max_column + 1)]),
        'rowCount': len(records),
        'records': records,
        'warnings': sheet_warnings,
    })

print(json.dumps({
    'sourceFileName': os.path.basename(display_name),
    'totalSheets': len(wb.sheetnames),
    'parsedSheets': len(periods),
    'totalRows': total_rows,
    'periods': periods,
    'warnings': warnings,
    'errors': errors,
}, ensure_ascii=False, default=str))
