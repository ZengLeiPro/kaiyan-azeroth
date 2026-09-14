# 许可审查

本仓库没有 `LICENSE` 文件。所有者已决定不附带项目许可证。公开可见不等于 MIT，也不等于已经开源。不要在 README 或其他文档中宣称 MIT / Apache / GPL。

## 已确认的运行依赖问题

| 包 | 版本 | 许可 | 使用位置 | 处理 |
| --- | --- | --- | --- | --- |
| `ua-parser-js` | 原 `^2.0.10` | AGPL-3.0-or-later | 登录设备解析 | 公开副本改为 MIT 的 `bowser`，并保留设备解析回归 |
| `xlsx` | `0.20.3`（SheetJS CDN tarball） | 见安装树声明 | Web 导出 | 记录来源与许可，待最终许可证一并确认 |

完整 name/version/source/license 清单在安装依赖后由 `pnpm licenses list` 生成，不写入本文件的过期快照。

## 已决定

- 仓库名：`kaiyan-azeroth`
- 不附带 `LICENSE` 文件

## 仍待仓库所有者决定

1. 员工 / 外协 / 交付项目代码能否由公司对外授权
2. 第三方图片与字体的再分发权
3. 是否在 GitHub 建立独立仓库，以及是否 Public
4. `xlsx` 0.20.3 的许可是否与「无项目 LICENSE」并存可接受
