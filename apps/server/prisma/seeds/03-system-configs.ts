import { PrismaClient } from '@prisma/client';

/**
 * 系统配置种子数据
 */
export async function seedSystemConfigs(prisma: PrismaClient) {
  console.log('[SystemConfigs] 正在创建系统配置...');

  const configs = [
    {
      code: 'SYSTEM_NAME',
      name: '系统名称',
      value: 'Azeroth',
      type: 'string',
      group: '基础设置',
      description: '系统显示名称',
    },
    {
      code: 'PAGE_SIZE_DEFAULT',
      name: '默认分页大小',
      value: '20',
      type: 'number',
      group: '基础设置',
      description: '列表页默认每页条数',
    },
    {
      code: 'UPLOAD_MAX_SIZE',
      name: '上传文件大小限制(MB)',
      value: '10',
      type: 'number',
      group: '基础设置',
      description: '单个文件上传的最大大小',
    },
  ];

  for (const config of configs) {
    const existing = await prisma.systemConfig.findFirst({
      where: { code: config.code },
    });

    if (!existing) {
      await prisma.systemConfig.create({
        data: config,
      });
      console.log(`  - 创建配置: ${config.name}`);
    } else {
      console.log(`  - 配置已存在: ${config.name}`);
    }
  }

  console.log('[SystemConfigs] 系统配置创建完成');
}
