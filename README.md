# dsh-skill-sets

[English](README.en.md) · 中文

![技能档 pill 与档位菜单界面实拍](assets/dsh-skill-sets.png)

*界面实拍：截自本机运行中的 DSH 实例，示例内容已脱敏。*

按任务类型给技能分「档」：切档即换本会话加载的技能清单，其余技能在目录与正文两层同时封掉。输入框上方一排档位 pill，档位按会话持久化。

## 装

```sh
dsh plugin --profile web add file:<本仓库>
```

装完重启 web 实例。

档位定义在 `lib/skill-sets.js`：档名、hint、含哪些技能、brief 正文都在里面。改完重新同步到 `~/.dsh/profiles/web/node_modules/dsh-skill-sets` 再重启。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_SKILLSETS_DIAG` | `~/.dsh/logs/skill-sets-deny.log` | 工具面裁剪诊断日志 |
