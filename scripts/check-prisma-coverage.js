#!/usr/bin/env node
/**
 * Prisma -> Shared 类型覆盖率检查脚本
 *
 * 检查每个 Prisma Model 是否有对应的 Shared Interface 定义。
 * 目标：确保数据库模型在 shared 包中有对应的类型定义 (IXxx)。
 *
 * 检查逻辑：
 * 1. 读取 apps/server/prisma/schema.prisma，提取所有 model 名称
 * 2. 扫描 packages/shared/src/types/ 目录，收集所有导出的 Interface 名称
 * 3. 对比：ModelName -> I{ModelName}
 * 4. 报告缺失的类型定义
 */

const fs = require('fs');
const path = require('path');

const PRISMA_SCHEMA_PATH = path.join(__dirname, '../apps/server/prisma/schema.prisma');
const SHARED_TYPES_DIR = path.join(__dirname, '../packages/shared/src/types');

// 是否严格模式：环境变量 STRICT=1 时阻断
const STRICT = process.env.STRICT === '1';

// 忽略的模型（例如中间表、系统表等不需要暴露给前端的模型）
const IGNORED_MODELS = new Set([
  'SyncState', // 同步状态基础设施表，仅供 dingtalk-sync 内部使用，无需前端类型
  // 健康中心应用层已移除；模型暂留以满足 expand-only，待 contract 批次 DROP。
  'DietFood',
  'DietSupplement',
  'DietPlan',
  'DietMealSlot',
  'DietPlanSupplement',
  'DietDailyLog',
  'DietDailyMealEntry',
  'DietDailySupplementEntry',
  'DietWaterLog',
  'DietSubjectiveLog',
  'BodyMetric',
  'DietPurchaseItem',
  'ExerciseLibrary',
  'WorkoutSession',
  'WorkoutExercise',
  'WorkoutSet',
]);

// 模型名称与接口名称不一致时的别名映射（Prisma ModelName → Shared InterfaceName）
const MODEL_ALIAS_MAP = {
  SystemConfig: 'ISystemParam', // SystemConfig 模型对应 ISystemParam 接口（系统参数）
};

function main() {
  console.log('正在检查 Prisma -> Shared 类型覆盖率...\n');

  // 1. 提取 Prisma Models
  const prismaModels = extractPrismaModels(PRISMA_SCHEMA_PATH);
  if (prismaModels.size === 0) {
    console.error('错误：未能找到 Prisma Models 或 schema 文件不存在。');
    process.exit(1);
  }
  console.log(`已识别 ${prismaModels.size} 个 Prisma Models`);

  // 2. 提取 Shared Interfaces
  const sharedInterfaces = extractSharedInterfaces(SHARED_TYPES_DIR);
  console.log(`已识别 ${sharedInterfaces.size} 个 Shared Interfaces`);

  // 3. 对比检查
  const missingTypes = [];
  const coveredModels = [];

  for (const modelName of prismaModels) {
    if (IGNORED_MODELS.has(modelName)) continue;

    const interfaceName = MODEL_ALIAS_MAP[modelName] || `I${modelName}`;
    if (!sharedInterfaces.has(interfaceName)) {
      missingTypes.push({ model: modelName, expectedInterface: interfaceName });
    } else {
      coveredModels.push(modelName);
    }
  }

  // 4. 输出结果
  const coverageRate = (coveredModels.length / (prismaModels.size - IGNORED_MODELS.size)) * 100;

  console.log(
    `\n覆盖率统计: ${coveredModels.length}/${prismaModels.size - IGNORED_MODELS.size} (${coverageRate.toFixed(1)}%)\n`
  );

  if (missingTypes.length > 0) {
    const separator = '='.repeat(50);
    console.log('错误（必须修复）:');
    console.log(separator);
    missingTypes.forEach(({ model, expectedInterface }) => {
      console.log(`  Model: ${model}  ->  缺少: ${expectedInterface}`);
    });
    console.log('');
    console.log(`检查失败：发现 ${missingTypes.length} 处问题。`);
    console.log('');
    console.log('修复建议：');
    console.log('  在 packages/shared/src/types/ 中为上述模型添加接口定义。');

    // STRICT 模式或 CI 环境下阻断
    if (STRICT) {
      process.exit(1);
    } else {
      console.log('\n  提示：使用 STRICT=1 环境变量可开启严格模式。');
    }
  } else {
    console.log('所有 Prisma Models 都有对应的 Shared Types 定义。');
  }
}

function extractPrismaModels(filePath) {
  const models = new Set();
  if (!fs.existsSync(filePath)) return models;

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/^model\s+(\w+)\s+\{/);
    if (match) {
      models.add(match[1]);
    }
  }
  return models;
}

function extractSharedInterfaces(dir) {
  const interfaces = new Set();

  function scan(directory) {
    if (!fs.existsSync(directory)) return;
    const items = fs.readdirSync(directory, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(directory, item.name);
      if (item.isDirectory()) {
        scan(fullPath);
      } else if (item.isFile() && item.name.endsWith('.ts')) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const regex = /export\s+(?:interface|type)\s+(I\w+)/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
          interfaces.add(match[1]);
        }
      }
    }
  }

  scan(dir);
  return interfaces;
}

main();
