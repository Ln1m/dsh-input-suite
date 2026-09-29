# dsh-input-suite

中文 | [English](README.en.md)

输入区家族：技能档

## 包

| 目录 | 作用 |
|---|---|
| `dsh-skill-sets` | 按任务类型给技能分档，切档即换注入的技能清单 |

## 版本线

| 版本 | 对应 DSH | 说明 |
|---|---|---|
| `v0.1.2` | 0.1.7 | 本机 0.1.7 线继续开发的功能（本次同步） |
| `v0.1.0` | 0.1.6 | 0.1.6 线的最后一版，保留可用、不再更新 |

## 装

```sh
# 只装其中一个包
dsh plugin --profile web add file:<本仓库>/dsh-skill-sets
```

整族一次装完（Windows PowerShell）：

```powershell
./install.ps1
```

不克隆仓库、直接从 Release 装（一行一个包）：

```sh
dsh plugin --profile web add "https://github.com/Ln1m/dsh-input-suite/releases/download/v0.1.2/dsh-skill-sets-0.1.2.tgz"
```

装的时候若报 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`（国内出口证书注入，Node 默认不读系统证书库），先执行 `$env:NODE_OPTIONS='--use-system-ca'` 再装。

装完重启 web 实例。每个包目录里还有它自己的 README。

## 界面

![dsh-skill-sets](dsh-skill-sets/assets/dsh-skill-sets.png)

## 许可

MIT
