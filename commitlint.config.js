module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat', // 新功能
        'fix', // 修复 Bug
        'docs', // 文档更新
        'style', // 代码格式调整（不影响代码运行的变动）
        'refactor', // 代码重构（既不是新增功能，也不是修复 Bug）
        'perf', // 性能优化
        'test', // 测试相关
        'build', // 构建系统或外部依赖的更改
        'ci', // CI 配置文件和脚本的更改
        'chore', // 其他不修改 src 或测试文件的更改
        'revert', // 回滚之前的提交
      ],
    ],
    'subject-case': [0],
  },
};
