## 数据库 Schema 变更检查清单

如果此 PR 涉及数据库 Schema 变更，请确认：

- [ ] 所有外键字段都定义了 `@relation` 关系
- [ ] 所有关系都在相关模型中定义了反向关系
- [ ] 已运行 `prisma migrate dev` 生成迁移文件
- [ ] 已运行 `prisma generate` 重新生成客户端
- [ ] 已测试 API 端点，无 500 错误
- [ ] 已更新相关的 Service 代码以使用新关系
