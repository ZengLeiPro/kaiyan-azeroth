import { createHash } from 'crypto';

/**
 * 单行流水解析器
 *
 * 外部回款表明细 sheet 列结构：
 *   A 列：日期（如 "1月1日"，没有年份 — 由 sheet 名提供）
 *   B 列：科目（中文名，与 FinanceSubject.name 一对一）
 *   C 列：备注
 *   D 列：金额（带千分位逗号，正=收入 负=支出，如 "69,460.00" / "-2,939.59"）
 *   E 列：运行余额（D 列连续累加结果）
 */

export interface ParsedLedgerRow {
  txDate: string; // YYYY-MM-DD
  subjectName: string; // 原始 B 列字符串（importer 用它 match FinanceSubject.name）
  remark: string | null;
  amount: number; // 带符号
  runningBalance: number; // E 列原始余额（用于对账）
  isPersonal: boolean; // B 列 trim==='个人'
  isDateInferred: boolean; // A 列为空时，从同组上一行/下一行继承日期
  sheetName: string;
  rowIndex: number; // 在 sheet 中的行号（1-based，含表头偏移）
  dingtalkRowHash: string; // SHA-256(sheetName|rowIndex|txDate|amount|remark)
}

export interface ParseRowError {
  sheetName: string;
  rowIndex: number;
  reason: string;
  rawData: Record<string, string>;
}

/**
 * 解析「1月1日」/ 「2月15日」等中文日期为 YYYY-MM-DD
 * 年份由 sheetName（'2025' / '2026'）提供
 */
export function parseChineseDate(text: string, year: number): string | null {
  if (!text) return null;
  const m = text.trim().match(/^(\d{1,2})月(\d{1,2})日$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 解析金额：去掉千分位逗号 + 空格，转为 number
 * 接受：'69,460.00' / '-2,939.59' / '0' / '0.00' / ''
 */
export function parseAmount(text: string): number | null {
  if (!text) return null;
  const cleaned = text.replace(/,/g, '').replace(/\s+/g, '').trim();
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  if (Number.isNaN(n)) return null;
  return n;
}

/** 生成防重 hash */
export function makeRowHash(
  sheetName: string,
  rowIndex: number,
  txDate: string,
  amount: number,
  remark: string | null
): string {
  return createHash('sha256')
    .update(`${sheetName}|${rowIndex}|${txDate}|${amount.toFixed(2)}|${remark ?? ''}`)
    .digest('hex');
}

/**
 * 解析一整张明细 sheet 的所有行
 *
 * 输入：原始 displayValues 二维数组（不含表头行；调用方应先剥离表头）
 *      sheet 名（如 '2025'）+ 起始行号（用于错误定位）+ 年份
 * 输出：成功解析的行 + 错误行（任意一项缺失或非法都进 errors）
 *
 * 注意：表头/空行/汇总行（如「合计」「期初」）会被识别并跳过，不进 errors。
 */
export function parseLedgerSheet(
  rows: string[][],
  sheetName: string,
  year: number,
  rowOffset = 1 // 第一行已是表头之后的第几行（默认 1，因为我们传入的 rows[0] 对应物理 row 2 — 表头是 row 1）
): { rows: ParsedLedgerRow[]; errors: ParseRowError[] } {
  const result: ParsedLedgerRow[] = [];
  const errors: ParseRowError[] = [];
  let lastResolvedTxDate: string | null = null;
  let lastTransactionIndex = -Infinity;

  for (let i = 0; i < rows.length; i += 1) {
    const physicalRow = rowOffset + i + 1; // 1-based 行号（含表头）
    const r = rows[i] ?? [];
    const aRaw = r[0] ?? '';
    const bRaw = r[1] ?? '';
    const cRaw = r[2] ?? '';
    const dRaw = r[3] ?? '';
    const eRaw = r[4] ?? '';

    // 跳过完全空行
    if (!aRaw && !bRaw && !cRaw && !dRaw && !eRaw) continue;

    // 跳过明显的汇总行（A 列空但 E 列有数字 — 通常是期初余额）
    if (!aRaw && eRaw && !bRaw && !dRaw) continue;

    const amount = parseAmount(dRaw);
    let txDate = parseChineseDate(aRaw, year);
    let isDateInferred = false;
    if (!txDate && isTransactionLikeRow(bRaw, dRaw, eRaw)) {
      txDate =
        i - lastTransactionIndex === 1
          ? lastResolvedTxDate
          : findNextExplicitDate(rows, i + 1, year);
      txDate ??= lastResolvedTxDate;
      isDateInferred = !!txDate;
    }
    if (!txDate) {
      // A 列既非日期也非空（说明是异常行）才记错误；其它情况静默跳
      if (aRaw.trim()) {
        errors.push({
          sheetName,
          rowIndex: physicalRow,
          reason: `A 列日期格式无法解析: "${aRaw}"`,
          rawData: { A: aRaw, B: bRaw, C: cRaw, D: dRaw, E: eRaw },
        });
      }
      continue;
    }

    const subjectName = bRaw.trim() || '待归类';
    if (amount === null) {
      // 钉钉表中存在“日期 + 科目 + 备注 + 余额，但金额为空”的注释行，不是交易。
      // 例如个人账备注“妈”仅延续上一行余额，应跳过，否则会制造一条不可对账的空金额流水。
      if (!dRaw.trim() && eRaw.trim()) {
        continue;
      }
      errors.push({
        sheetName,
        rowIndex: physicalRow,
        reason: `D 列金额无法解析: "${dRaw}"`,
        rawData: { A: aRaw, B: bRaw, C: cRaw, D: dRaw, E: eRaw },
      });
      continue;
    }
    if (amount === 0) {
      errors.push({
        sheetName,
        rowIndex: physicalRow,
        reason: 'D 列金额不能为 0',
        rawData: { A: aRaw, B: bRaw, C: cRaw, D: dRaw, E: eRaw },
      });
      continue;
    }
    if (!eRaw.trim()) {
      continue;
    }

    const runningBalance = parseAmount(eRaw) ?? 0;
    const remark = cRaw.trim() || null;
    const isPersonal = subjectName === '个人';

    const dingtalkRowHash = makeRowHash(sheetName, physicalRow, txDate, amount, remark);

    result.push({
      txDate,
      subjectName,
      remark,
      amount,
      runningBalance,
      isPersonal,
      isDateInferred,
      sheetName,
      rowIndex: physicalRow,
      dingtalkRowHash,
    });

    lastResolvedTxDate = txDate;
    lastTransactionIndex = i;
  }

  return { rows: result, errors };
}

function isTransactionLikeRow(subjectRaw: string, amountRaw: string, balanceRaw: string): boolean {
  const amount = parseAmount(amountRaw);
  if (amount === null || amount === 0) return false;
  return !!subjectRaw.trim() || !!balanceRaw.trim();
}

function findNextExplicitDate(rows: string[][], startIndex: number, year: number): string | null {
  for (let i = startIndex; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const aRaw = row[0] ?? '';
    const bRaw = row[1] ?? '';
    const dRaw = row[3] ?? '';
    const eRaw = row[4] ?? '';

    const txDate = parseChineseDate(aRaw, year);
    if (txDate) return txDate;

    if (isTransactionLikeRow(bRaw, dRaw, eRaw)) {
      return null;
    }
  }
  return null;
}
