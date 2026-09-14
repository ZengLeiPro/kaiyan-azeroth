# 上传附件安全模型

> 本文件描述当前工作区实现。生产是否生效以对应版本完成迁移、部署及 OSS ACL
> 切换后的验收结果为准。

## 1. 访问模型

上传文件同时产生两类数据：

- 文件内容写入 `UPLOAD_DIR/<YYYYMMDD>/<随机文件名>`；
- `file_assets` 记录不可变 `storageKey`、原始文件名、大小、MIME 和上传员工。

业务归属仍由 `KeepRecord`、`VisitRecord`、`CrmWorkDaily`、`ProjectTicket`
等记录的 `attachments` JSON 表达。附件能否被看见，沿用对应业务接口已有的数据范围
和 RBAC；`FileAsset.ownerEmployeeId` 只回答“谁上传”，不把上传人误当成唯一读者。

业务 Controller 返回授权数据后，全局 `AttachmentDownloadUrlInterceptor` 才为响应里的
规范存储 URL 签发下载地址。令牌具备以下约束：

- HMAC-SHA256 签名，密钥与普通 URL 隔离出独立签名域；
- 绑定当前 `employeeId`，其他登录员工不能复用；
- 绑定规范化 `storageKey`，路径穿透在签发和读取两侧均被拒绝；
- 1 小时过期；读取时仍要求有效登录态；
- 响应使用 `private, no-store`、`nosniff` 和沙箱 CSP。

旧的 `GET /upload/proxy-download?url=...` 已移除，客户端不再用公开 URL 换取文件流。
生产环境也不再由 API 进程静态暴露 `/uploads`；本地开发保留静态服务。

## 2. 上传入口防御

| 防御                                                   | 位置                 |
| ------------------------------------------------------ | -------------------- |
| 全局登录校验                                           | `JwtAuthGuard`       |
| 扩展名拒绝清单 + 扩展名白名单 + MIME 白名单            | `uploadFileFilter`   |
| 单文件 10MB、批量最多 10 个                            | Multer 配置          |
| 随机存储文件名 + 排他创建与碰撞重试                    | `UploadService`      |
| Linux `/proc/self/fd` fixed-dir + `O_NOFOLLOW`/`fstat` | `UploadPathSecurity` |
| 上传人和文件元数据登记                                 | `file_assets`        |
| 上传/下载/拒绝下载审计                                 | `operation_logs`     |

单/批上传均在副作用前生成 `FileAsset.id + ownerEmployeeId + storageKey` 及全部排他
创建候选路径。服务仅支持 Linux，并在启动时要求 `/proc/self/fd` 可用；不满足时直接
fail closed，不回退到按名称解析路径。root fd 常驻，父目录逐段以
`O_DIRECTORY | O_NOFOLLOW` 打开并保留到上传终态；文件以
`O_CREAT | O_EXCL | O_NOFOLLOW` 打开，写入只经过同一 `FileHandle`，写前、写后均以
`fstat` 与 fixed parent 下的目录项复核 inode。父目录被移动或替换不会把写入重定向到
替换路径。

下载与预览签名只做 storageKey 词法校验，不访问文件系统；真正读取时才从 trusted root fd
逐段打开父目录，并以 `O_NOFOLLOW` 打开最终项、`fstat` 为普通文件，再从同一个
`FileHandle` 创建流。路径在打开后被换入 symlink，也不会让流改读 symlink 目标。

批量上传采用 all-or-nothing：等待全部并行任务终态后，把所有已尝试 `create` 的项
（包括“数据库可能已提交但 Promise rejected”的模糊项）纳入补偿。FileAsset 创建和补偿
都先对同一 `{ assetId, storageKey }` 获取 transaction-scoped advisory lock；补偿先用独立
lock-only Serializable transaction 等待模糊创建终态，再在新的 Serializable transaction
重新取同组有序锁，按 `{ id, ownerEmployeeId, storageKey }` 精确查询、count、
`deleteMany` 并复核剩余 count。任何竞态或数量不符都会回滚整笔数据库补偿。

只有数据库补偿完整后才清理文件。清理在 fixed parent 下把目录项 rename 到 0700
私有目录中的随机隔离槽，重新打开并验证 inode 后才 unlink；换入的其他 inode 不会被删，
而是尝试无覆盖恢复并保留隔离副本供恢复。数据库补偿失败时保留对应文件；文件清理部分
失败时返回固定“补偿不完整”5xx，并用不含绝对路径和原文件名的结构化日志区分原始失败、
模糊状态、数据库补偿与文件清理结果。单文件写后登记失败使用同一补偿规则，清理错误不会
被吞掉。

## 3. 外部上线前置条件

代码与数据库迁移完成并不等于公开直链已经失效。正式切换还必须单独执行并验收：

1. 部署包含 `file_assets` expand-only migration 的服务版本；
2. 验证新旧附件均能从业务详情获得员工绑定下载地址；
3. 将对象存储 bucket 从 `public-read` 改为 `private`；
4. 验证规范 OSS URL 匿名访问失败，已登录授权下载成功，跨员工令牌失败；
5. 检查钉钉拜访通知仅发送短时签名图片预览地址，不发送规范 OSS URL。

OSS ACL 是共享外部状态，本仓库代码不会自动修改。

## 4. 仍保留的边界

- 已签发令牌在最长 1 小时内不重新查询业务对象权限；员工账号失效会由登录守卫立即阻断。
- 历史附件没有 `file_assets` 行，但只要其规范 URL 仍存在于已授权业务响应中，就能签发
  下载令牌；资产表只对新上传完整登记。
- 本地文件系统实现明确依赖 Linux `/proc/self/fd`，其他平台和未挂载 procfs 的容器不会启动
  Upload 存储能力；当前不提供 pathname fallback，也不引入 native addon。
- 遇到 inode 换入或隔离项 unlink 失败时，服务宁可返回“补偿不完整”并在 0700 隔离槽保留
  恢复副本，也不会为追求清理完成而删除身份不匹配的目录项；隔离残留需由受控运维处理。
- 尚未增加逐员工上传频率额度；当前依赖全局限流、10MB/10 文件上限和审计。

## 5. 变更记录

- 2026-06-20：加入 URL origin、路径边界、文件类型与审计加固。
- 2026-07-27：新增 `file_assets`、员工绑定短时下载令牌、响应侧授权签发，
  移除 `proxy-download`，关闭生产静态目录，并停止向钉钉群发送 OSS 附件直链。
- 2026-08-04：拜访通知恢复最多 3 张群内预览；图片使用一小时短时签名 API 地址，
  仅为登记信息匹配的图片签发，规范 OSS URL 仍不进入群聊。
- 2026-08-24：单/批上传改为预生成 ID、fixed-dir 排他文件创建、同 inode 隔离清理、
  FileAsset advisory-lock + Serializable 精确补偿，并把文件系统强校验收口到真实读流边界。
