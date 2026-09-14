import type { PrismaClient } from '@prisma/client';

/**
 * 财务账户字典种子数据
 *
 * 6 行账户：
 *  - company_total（虚拟主账户）：所有 ledger 流水都挂这里
 *  - 招行 / 支付宝 / 兴业 / 微信 / 现金：真实账户字典，作为「账户余额快照」参考（不挂 ledger）
 *
 * 设计背景：外部回款表明细 sheet 不区分账户维度，所有流水统一计入 E 列单一累计余额。
 * 账户余额快照在 sheet 顶部 G-H 列单独维护，与流水解耦。
 * 我们沿用这个模型：流水统一挂 company_total，5 个真实账户保留为余额参考字典。
 *
 * 幂等：按 code 唯一键 upsert，反复跑只创建不存在的、不覆盖已有数据
 */

interface AccountSeed {
  code: string;
  name: string;
  kind: string;
  displayOrder: number;
  remark?: string;
}

const ACCOUNTS: AccountSeed[] = [
  // 虚拟主账户：importer 把所有钉钉明细流水挂在这里
  {
    code: 'company_total',
    name: '公司总账户',
    kind: 'virtual',
    displayOrder: 1,
    remark: '外部回款表明细不区分账户维度，所有流水统一计入此虚拟账户',
  },
  // 真实账户字典（用于账户余额快照参考，不挂 ledger）
  { code: 'cmb', name: '招商银行', kind: 'bank', displayOrder: 10 },
  { code: 'alipay', name: '支付宝', kind: 'alipay', displayOrder: 20 },
  { code: 'cib', name: '兴业银行', kind: 'bank', displayOrder: 30 },
  { code: 'wechat', name: '微信', kind: 'wechat', displayOrder: 40 },
  { code: 'cash', name: '现金', kind: 'cash', displayOrder: 50 },
];

export async function seedFinanceAccounts(prisma: PrismaClient): Promise<void> {
  console.log('  → 财务账户字典...');
  let created = 0;
  let skipped = 0;
  for (const a of ACCOUNTS) {
    const existing = await prisma.financeAccount.findUnique({ where: { code: a.code } });
    if (existing) {
      skipped += 1;
      continue;
    }
    await prisma.financeAccount.create({
      data: {
        code: a.code,
        name: a.name,
        kind: a.kind,
        displayOrder: a.displayOrder,
        remark: a.remark,
      },
    });
    created += 1;
  }
  console.log(`    finance_accounts: 新建 ${created}, 已存在跳过 ${skipped}`);
}
