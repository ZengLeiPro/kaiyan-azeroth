这是一个仍处于快速迭代、还未正式上线的企业内部系统。请你详细探索这个项目，可以先阅读 docs/specs/ 下面的文档。根据深入探索的结果，你应该能发现，这个项目的前后端一致性架构已经相当成熟：

1. 架构与契约体系概览（Prisma → Shared → Server/Web）
   1.1 Monorepo 结构与“双层架构”
   文档明确将项目分成两条主线：

- 数据层：Prisma → Shared → 前后端（类型/字段/校验一致）
- UI 层：L1→L2→L3→L4 四层架构（组件复用与可维护）
  目录结构也在文档中固定化：apps/web、apps/server、packages/shared。

  1.2 数据层契约链路（Single Source of Truth）
  文档给出了非常清晰的“契约流转”示意：
  Prisma Schema → 生成 @prisma/client → Shared Types → Server implements / Web extends → API 通信字段完全一致。
  “前端强绑定 extends，而不是 type alias”也被明确写入规范与检查方向。

并且在 claude.md 中编写了大量的规范。
但是，我依然觉得目前不够完善。依然存在很多不复核规范的地方。
请你调用多个子agent(阻塞状态等待完成)，分别聚焦在不同问题上，进行详细深入探索分析，然后给我详细的分析报告。

---

你可以安排多个子agent来并行开发，只要确保它们之间不会起冲突。
同时，你必须确保整个开发过程中，要确保子agent理解rules.md中的所有相关规范，不要自己特立独行、导致不遵守规范的跑偏行为发生。
在子agent开发过程中，你应该处于完全阻塞等待状态，不要反复查看它们的状态。
在所有开发完成后，你必须详细复核。
