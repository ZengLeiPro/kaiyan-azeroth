import type { PrismaClient } from '@prisma/client';

/**
 * 财务科目字典种子数据
 *
 * 70 个科目（14 个 level=1 分组 + 56 个 level=2 叶子），从外部回款表2025财报 sheet 整理。
 * 已应用 4 项决策（详见 plan 文件）：
 *  - 决策1：『福利费』改为 level=1 分组，55/56 挂其下
 *  - 决策2：拆出 revenue.dingtalk 大类（含钉钉转售收入 + 钉钉佣金收入）
 *  - 决策3：non_pl.deposit『保证金缴纳』保留为独立科目
 *  - 决策4：code 英文短名沿用
 *
 * 注意：钉钉财报里的 8 个公式汇总行（营业收入/营业成本/毛利/毛利率/运营总费用/税前利润/净利润/净利率）
 *      不入此表，PnL 矩阵渲染时由前端按 category 求和派生。
 *
 * 幂等：按 code 唯一键 upsert，反复跑只创建不存在的、不覆盖已有数据。
 * 两 pass：先建分组节点，再建叶子（叶子需要 parentId 引用）。
 *
 * category：revenue / cogs / opex / tax / other_income / non_pl
 * level：1 = 分组（不可挂账），2 = 叶子（可挂账）
 */

interface SubjectSeed {
  code: string;
  name: string;
  category: string;
  level: 1 | 2;
  parentCode: string | null;
  displayOrder: number;
}

const SUBJECTS: SubjectSeed[] = [
  // ===== 收入（revenue）=====
  // 钉钉业务收入（决策2新增大类）
  {
    code: 'revenue.dingtalk',
    name: '钉钉业务收入',
    category: 'revenue',
    level: 1,
    parentCode: null,
    displayOrder: 10,
  },
  {
    code: 'revenue.dingtalk_resale',
    name: '钉钉转售收入',
    category: 'revenue',
    level: 2,
    parentCode: 'revenue.dingtalk',
    displayOrder: 11,
  },
  {
    code: 'revenue.dingtalk_commission',
    name: '钉钉佣金收入',
    category: 'revenue',
    level: 2,
    parentCode: 'revenue.dingtalk',
    displayOrder: 12,
  },

  // 软件销售收入
  {
    code: 'revenue.software',
    name: '软件销售收入',
    category: 'revenue',
    level: 1,
    parentCode: null,
    displayOrder: 20,
  },
  {
    code: 'revenue.software_self',
    name: '自研软件销售收入',
    category: 'revenue',
    level: 2,
    parentCode: 'revenue.software',
    displayOrder: 30,
  },
  {
    code: 'revenue.software_other_resale',
    name: '其他软件转售收入',
    category: 'revenue',
    level: 2,
    parentCode: 'revenue.software',
    displayOrder: 50,
  },
  {
    code: 'revenue.hardware_resale',
    name: '硬件转售收入',
    category: 'revenue',
    level: 2,
    parentCode: 'revenue.software',
    displayOrder: 60,
  },

  // 代理佣金收入
  {
    code: 'revenue.commission',
    name: '代理佣金收入',
    category: 'revenue',
    level: 1,
    parentCode: null,
    displayOrder: 70,
  },
  {
    code: 'revenue.commission_other',
    name: '其他佣金收入',
    category: 'revenue',
    level: 2,
    parentCode: 'revenue.commission',
    displayOrder: 90,
  },

  // 技术服务收入
  {
    code: 'revenue.service',
    name: '技术服务收入',
    category: 'revenue',
    level: 1,
    parentCode: null,
    displayOrder: 100,
  },
  {
    code: 'revenue.service_custom',
    name: '定制开发收入',
    category: 'revenue',
    level: 2,
    parentCode: 'revenue.service',
    displayOrder: 110,
  },
  {
    code: 'revenue.service_consulting',
    name: '咨询配置收入',
    category: 'revenue',
    level: 2,
    parentCode: 'revenue.service',
    displayOrder: 120,
  },
  {
    code: 'revenue.service_aftersales',
    name: '售后服务收入',
    category: 'revenue',
    level: 2,
    parentCode: 'revenue.service',
    displayOrder: 130,
  },
  {
    code: 'revenue.service_outsourcing',
    name: '外包人员服务收入',
    category: 'revenue',
    level: 2,
    parentCode: 'revenue.service',
    displayOrder: 140,
  },

  // 其他业务收入（独立叶子）
  {
    code: 'revenue.other',
    name: '其他业务收入',
    category: 'revenue',
    level: 2,
    parentCode: null,
    displayOrder: 150,
  },

  // ===== 营业成本（cogs）=====
  // 业务转售成本
  {
    code: 'cogs.resale',
    name: '业务转售成本',
    category: 'cogs',
    level: 1,
    parentCode: null,
    displayOrder: 170,
  },
  {
    code: 'cogs.resale_dingtalk',
    name: '钉钉代付成本',
    category: 'cogs',
    level: 2,
    parentCode: 'cogs.resale',
    displayOrder: 180,
  },
  {
    code: 'cogs.resale_software_other',
    name: '其他软件采购成本',
    category: 'cogs',
    level: 2,
    parentCode: 'cogs.resale',
    displayOrder: 190,
  },
  {
    code: 'cogs.resale_hardware',
    name: '硬件采购成本',
    category: 'cogs',
    level: 2,
    parentCode: 'cogs.resale',
    displayOrder: 200,
  },

  // 技术服务成本
  {
    code: 'cogs.pro_services',
    name: '技术服务成本（Pro Services CoGS）',
    category: 'cogs',
    level: 1,
    parentCode: null,
    displayOrder: 210,
  },
  {
    code: 'cogs.pro_services_salary',
    name: '技术服务人员工资',
    category: 'cogs',
    level: 2,
    parentCode: 'cogs.pro_services',
    displayOrder: 220,
  },
  {
    code: 'cogs.pro_services_social',
    name: '技术服务人员五险一金',
    category: 'cogs',
    level: 2,
    parentCode: 'cogs.pro_services',
    displayOrder: 230,
  },
  {
    code: 'cogs.pro_services_bonus',
    name: '技术服务人员奖金',
    category: 'cogs',
    level: 2,
    parentCode: 'cogs.pro_services',
    displayOrder: 240,
  },
  {
    code: 'cogs.pro_services_outsourcing',
    name: '外包服务成本',
    category: 'cogs',
    level: 2,
    parentCode: 'cogs.pro_services',
    displayOrder: 250,
  },

  // 托管与基础设施
  {
    code: 'cogs.hosting',
    name: '托管与基础设施（hosting）',
    category: 'cogs',
    level: 1,
    parentCode: null,
    displayOrder: 260,
  },
  {
    code: 'cogs.hosting_lease',
    name: '基础设施租赁成本',
    category: 'cogs',
    level: 2,
    parentCode: 'cogs.hosting',
    displayOrder: 270,
  },
  {
    code: 'cogs.hosting_purchase',
    name: '基础设施采购成本',
    category: 'cogs',
    level: 2,
    parentCode: 'cogs.hosting',
    displayOrder: 280,
  },

  // 其他业务成本（独立叶子）
  {
    code: 'cogs.other',
    name: '其他业务成本',
    category: 'cogs',
    level: 2,
    parentCode: null,
    displayOrder: 290,
  },

  // ===== 期间费用（opex）=====
  // 人工成本：钉钉明细账使用的历史粗科目。管理报表里的工资/五险一金/奖金拆分后续由工资表或财报表二次拆分。
  {
    code: 'opex.labor_pending_split',
    name: '人工成本',
    category: 'opex',
    level: 2,
    parentCode: null,
    displayOrder: 320,
  },

  // 销售费用
  {
    code: 'opex.sales',
    name: '销售费用（Sales）',
    category: 'opex',
    level: 1,
    parentCode: null,
    displayOrder: 330,
  },
  {
    code: 'opex.sales_salary',
    name: '销售人员工资',
    category: 'opex',
    level: 2,
    parentCode: 'opex.sales',
    displayOrder: 340,
  },
  {
    code: 'opex.sales_social',
    name: '销售人员五险一金',
    category: 'opex',
    level: 2,
    parentCode: 'opex.sales',
    displayOrder: 350,
  },
  {
    code: 'opex.sales_commission',
    name: '销售人员提成及奖金',
    category: 'opex',
    level: 2,
    parentCode: 'opex.sales',
    displayOrder: 360,
  },
  {
    code: 'opex.sales_travel_vehicle',
    name: '销售用交通及车辆能源费',
    category: 'opex',
    level: 2,
    parentCode: 'opex.sales',
    displayOrder: 370,
  },
  {
    code: 'opex.sales_business_trip',
    name: '销售用差旅费',
    category: 'opex',
    level: 2,
    parentCode: 'opex.sales',
    displayOrder: 380,
  },
  {
    code: 'opex.sales_entertainment',
    name: '销售用交际应酬费',
    category: 'opex',
    level: 2,
    parentCode: 'opex.sales',
    displayOrder: 390,
  },
  {
    code: 'opex.sales_other',
    name: '其他销售费用',
    category: 'opex',
    level: 2,
    parentCode: 'opex.sales',
    displayOrder: 400,
  },

  // 市场营销
  {
    code: 'opex.marketing',
    name: '市场营销（Marketing）',
    category: 'opex',
    level: 1,
    parentCode: null,
    displayOrder: 410,
  },
  {
    code: 'opex.marketing_ads',
    name: '广告与推广费用',
    category: 'opex',
    level: 2,
    parentCode: 'opex.marketing',
    displayOrder: 420,
  },
  {
    code: 'opex.marketing_events',
    name: '市场活动与展会费用',
    category: 'opex',
    level: 2,
    parentCode: 'opex.marketing',
    displayOrder: 430,
  },

  // 研发费用
  {
    code: 'opex.rnd',
    name: '研发费用（R&D）',
    category: 'opex',
    level: 1,
    parentCode: null,
    displayOrder: 440,
  },
  {
    code: 'opex.rnd_salary',
    name: '研发人员工资',
    category: 'opex',
    level: 2,
    parentCode: 'opex.rnd',
    displayOrder: 450,
  },
  {
    code: 'opex.rnd_social',
    name: '研发人员五险一金',
    category: 'opex',
    level: 2,
    parentCode: 'opex.rnd',
    displayOrder: 460,
  },

  // 一般及行政管理费用（G&A）
  {
    code: 'opex.ga',
    name: '一般及行政管理费用（G&A）',
    category: 'opex',
    level: 1,
    parentCode: null,
    displayOrder: 470,
  },
  {
    code: 'opex.ga_salary',
    name: '一般及行政人员工资',
    category: 'opex',
    level: 2,
    parentCode: 'opex.ga',
    displayOrder: 480,
  },
  {
    code: 'opex.ga_social',
    name: '一般及行政人员五险一金',
    category: 'opex',
    level: 2,
    parentCode: 'opex.ga',
    displayOrder: 490,
  },
  {
    code: 'opex.ga_bonus',
    name: '一般及行政人员奖金',
    category: 'opex',
    level: 2,
    parentCode: 'opex.ga',
    displayOrder: 500,
  },
  {
    code: 'opex.ga_travel',
    name: '差旅费',
    category: 'opex',
    level: 2,
    parentCode: 'opex.ga',
    displayOrder: 510,
  },
  {
    code: 'opex.ga_vehicle',
    name: '交通及车辆能源费',
    category: 'opex',
    level: 2,
    parentCode: 'opex.ga',
    displayOrder: 520,
  },
  {
    code: 'opex.ga_entertainment',
    name: '交际应酬费',
    category: 'opex',
    level: 2,
    parentCode: 'opex.ga',
    displayOrder: 530,
  },

  // 福利费（决策1：改为 G&A 下的子分组）
  {
    code: 'opex.ga_welfare',
    name: '福利费',
    category: 'opex',
    level: 1,
    parentCode: 'opex.ga',
    displayOrder: 540,
  },
  {
    code: 'opex.ga_welfare_team_building',
    name: '团建聚餐费',
    category: 'opex',
    level: 2,
    parentCode: 'opex.ga_welfare',
    displayOrder: 550,
  },
  {
    code: 'opex.ga_welfare_other',
    name: '其他福利费',
    category: 'opex',
    level: 2,
    parentCode: 'opex.ga_welfare',
    displayOrder: 560,
  },

  // G&A 续
  {
    code: 'opex.ga_fixed_asset',
    name: '办公用固定资产费',
    category: 'opex',
    level: 2,
    parentCode: 'opex.ga',
    displayOrder: 570,
  },
  {
    code: 'opex.ga_office',
    name: '办公用品与杂费',
    category: 'opex',
    level: 2,
    parentCode: 'opex.ga',
    displayOrder: 580,
  },
  {
    code: 'opex.ga_rent',
    name: '房租物业',
    category: 'opex',
    level: 2,
    parentCode: 'opex.ga',
    displayOrder: 590,
  },
  {
    code: 'opex.ga_utility',
    name: '水电费',
    category: 'opex',
    level: 2,
    parentCode: 'opex.ga',
    displayOrder: 600,
  },
  {
    code: 'opex.ga_software',
    name: '企业软件及服务费',
    category: 'opex',
    level: 2,
    parentCode: 'opex.ga',
    displayOrder: 610,
  },
  {
    code: 'opex.ga_training',
    name: '职工教育经费',
    category: 'opex',
    level: 2,
    parentCode: 'opex.ga',
    displayOrder: 620,
  },
  {
    code: 'opex.ga_other',
    name: '其他管理费用',
    category: 'opex',
    level: 2,
    parentCode: 'opex.ga',
    displayOrder: 630,
  },

  // 财务费用
  {
    code: 'opex.finance',
    name: '财务费用',
    category: 'opex',
    level: 1,
    parentCode: null,
    displayOrder: 640,
  },
  {
    code: 'opex.finance_interest',
    name: '利息费用',
    category: 'opex',
    level: 2,
    parentCode: 'opex.finance',
    displayOrder: 650,
  },
  {
    code: 'opex.finance_bank_fee',
    name: '银行手续费',
    category: 'opex',
    level: 2,
    parentCode: 'opex.finance',
    displayOrder: 660,
  },
  {
    code: 'opex.finance_other',
    name: '其他财务费用',
    category: 'opex',
    level: 2,
    parentCode: 'opex.finance',
    displayOrder: 670,
  },

  // ===== 税金及附加（tax）=====
  {
    code: 'tax.surcharge',
    name: '税金及附加',
    category: 'tax',
    level: 1,
    parentCode: null,
    displayOrder: 700,
  },
  {
    code: 'tax.vat',
    name: '增值税及附加税',
    category: 'tax',
    level: 2,
    parentCode: 'tax.surcharge',
    displayOrder: 710,
  },
  {
    code: 'tax.income',
    name: '所得税',
    category: 'tax',
    level: 2,
    parentCode: 'tax.surcharge',
    displayOrder: 720,
  },

  // ===== 营业外收入（other_income）=====
  {
    code: 'other_income.non_operating',
    name: '营业外收入',
    category: 'other_income',
    level: 2,
    parentCode: null,
    displayOrder: 730,
  },

  // ===== 不进 P&L（non_pl）=====
  {
    code: 'non_pl.uncategorized',
    name: '待归类',
    category: 'non_pl',
    level: 2,
    parentCode: null,
    displayOrder: 750,
  },
  {
    code: 'non_pl.deposit',
    name: '保证金缴纳',
    category: 'non_pl',
    level: 2,
    parentCode: null,
    displayOrder: 760,
  },
];

export async function seedFinanceSubjects(prisma: PrismaClient): Promise<void> {
  console.log('  → 财务科目字典...');

  // 计数器
  let created = 0;
  let skipped = 0;

  // Pass 1：先建 parent 为 null 的顶层节点（分组 + 独立叶子），及 parent 也是顶层的二级分组
  // 思路：按 displayOrder 排序后顺序 upsert，保证 parent 在子之前已经创建
  const sorted = [...SUBJECTS].sort((a, b) => a.displayOrder - b.displayOrder);

  // 建一个 code → id 的映射，用于把 parentCode 翻译成 parentId
  const codeToId = new Map<string, string>();

  // 先一次性预先把已存在的科目 id 加载到映射
  const existing = await prisma.financeSubject.findMany({
    where: { code: { in: SUBJECTS.map((s) => s.code) } },
    select: { id: true, code: true },
  });
  for (const e of existing) {
    codeToId.set(e.code, e.id);
  }

  for (const s of sorted) {
    if (codeToId.has(s.code)) {
      skipped += 1;
      continue;
    }
    const parentId = s.parentCode ? (codeToId.get(s.parentCode) ?? null) : null;
    if (s.parentCode && !parentId) {
      console.warn(`    ⚠ subject ${s.code} 的 parent ${s.parentCode} 未找到，parentId 留空`);
    }
    const row = await prisma.financeSubject.create({
      data: {
        code: s.code,
        name: s.name,
        category: s.category,
        level: s.level,
        parentId,
        displayOrder: s.displayOrder,
      },
    });
    codeToId.set(s.code, row.id);
    created += 1;
  }

  console.log(`    finance_subjects: 新建 ${created}, 已存在跳过 ${skipped}`);
}
