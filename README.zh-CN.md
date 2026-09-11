# pi-grounded

**让 Pi 的回答落在源码上，而不是印象上。**

[English](README.md)

> [!WARNING]
> **实验性项目。** 这是我做的第一个 Pi 扩展，边学 Pi 的扩展 API 边写出来的。README 里
> 描述的功能确实能用、也有测试支撑，但它只在一台机器上被一个人用了几天。请预期会有毛刺，
> 依赖它做要紧的事之前先看[现状与局限](#现状与局限)。

一个用来**读**陌生代码的 [Pi](https://github.com/earendil-works/pi) 扩展。它只做两件事：

1. **只读研究模式** —— 把 `edit` 和 `write` 从工具集里摘掉，模型只能看，不能改。
2. **引用校验** —— 模型给出的每一处 `file:line`，都拿去和文件系统核对。指向不存在的文件、或者行号超出文件长度的，当场标出来。

第二件才是重点。**要求模型给出处很容易；判断它有没有编，很难。**

```
> /grounded on
  ✓ grounded on · 只读模式
  ✓ 已禁用工具: edit, write

> Pi 的 compaction 是怎么触发的？

  Pi 的 compaction 有两种触发方式：
  - 手动触发：`/compact` … packages/coding-agent/src/modes/interactive/interactive-mode.ts:3068
  - 自动触发：默认开启，超过 contextWindow - reserveTokens 时触发
    packages/coding-agent/src/core/compaction/compaction.ts:233
  …

  🔍 grounded · ✓ 5 处引用已校验
```

当它编造引用时：

```
  ─────────────────────────────────────
  ⚠️ 1 处引用无效
    packages/agent/src/types.ts:9999 → 文件仅 446 行，行号越界
  ─────────────────────────────────────
```

## 安装

```bash
pi install git:github.com/Kayce001/pi-grounded
```

或者指向本地目录：

```bash
pi install /绝对路径/pi-grounded
```

不安装、只试一次：

```bash
pi -e /绝对路径/pi-grounded/src/index.ts
```

## 用法

| 命令 | 作用 |
|---|---|
| `/grounded` | 切换开关 |
| `/grounded on` / `off` | 显式开关 |
| `/grounded status` | 当前状态、被禁用的工具、本会话统计、解析根目录 |
| `/grounded check <文本>` | 对任意文本跑一遍校验，**不调用模型** |
| `/source …` | `/grounded` 的别名 |
| `pi --grounded` | 启动即开启 |

`/grounded check` 本身就挺有用：把一段文档、一条 code review 评论、或者别处来的回答粘进去，它会告诉你哪些引用是真的。

## 三种结论

| 结论 | 什么时候 | 怎么呈现 |
|---|---|---|
| verified | 所有引用都存在且行号在范围内 | 只在 footer 打勾，不打扰 |
| invalid | 至少有一处引用是假的 | 列出每一处及原因 |
| no-citation | 一段实质性的回答里一个 `file:line` 都没有 | 提示块说明 |

正文短于 200 字符的回答直接跳过，所以「好的」永远不会收到警告。

## 这**不是**什么

**这不是沙箱。** Pi 本身没有权限系统 —— 这是它的设计选择，它以启动者的权限运行。本扩展只是把两个工具从模型的菜单上拿掉。它**不拦截 `bash`**，挡不住铁了心要写的模型，更挡不住恶意行为。需要真正的边界请容器化（[官方文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md)）。

它也**不检验引用是否支撑对应的论断** —— 只检验文件和行号存在。一个指向真实但不相关行的引用照样会通过。

## 配置

没有配置文件。所有可调项都在 [`src/config.ts`](src/config.ts) 里，改完常量跑 `/reload` 即可生效：

| 常量 | 默认值 | 含义 |
|---|---|---|
| `WRITE_TOOLS` | `["edit", "write"]` | 开启时禁用的工具 |
| `MIN_ANSWER_LENGTH` | `200` | 短于此长度的回答不检查 |
| `CODE_EXTENSIONS` | 约 35 个扩展名 | 什么算源码路径 |
| `LABELS` | `[推断]` / `[不确定]` | 要求模型使用的标记 |

想换成英文界面，改 `src/config.ts` 里的 `LABELS` 和 [`src/prompt.ts`](src/prompt.ts) 里的提示词。

## 工作原理

| 钩子 | 职责 |
|---|---|
| `before_agent_start` | 把 grounding 段落追加到 system prompt |
| `message_end` | 收集 assistant 文本，**不产生任何副作用** |
| `agent_settled` | 做判定并追加提示块 |
| `registerEntryRenderer` | 渲染提示块 |

提示块是 **custom entry，不是 assistant 消息的一部分**。这点很关键：custom entry 不进入 LLM 上下文，所以警告永远不会被喂回给模型。最早的设计是直接改写消息，正因为这个原因被否决 —— 见 `NOTES.md` §1.3 的对照实验。

路径先按工作目录解析，再按 git 仓库根解析，所以在子目录里也能认出仓库相对路径。无法测量的文件（太大、读不了）一律**判为通过**，绝不报无效 —— 误报比漏报更糟。

## 现状与局限

用之前请先看这节。

### 已经验证的

| | |
|---|---|
| 单元测试 | 74 个全过。用 mutation test 确认过不是摆设 —— 改坏行号范围判断会让其中 6 个变红 |
| 引用校验 | 四条判定路径都在真实仓库上端到端跑通 |
| 误报 | 零。7 个真实回答共 117 处引用，另用 `test -f` 和 `wc -l`（不依赖本项目代码）独立抽检 10 处 |
| 只读模式 | 有对照组：不开时模型调用 `write` 改了文件，开着时零工具调用 |

### 还没验证的

`/reload` 热重载、提示块在 `/tree` 里的显示、`/share`。这三项都需要还没发生过的 TUI 会话。

### 度量不完整

A/B 基线因为供应商配额耗尽而中断：不开模式的完成 **2/12**，开启的完成 **7/12**。差异很明显 —— 基线组 0% 的回答带 `file:line`，开启后 100%，每个回答的工具调用数大约翻倍 —— 但 **n=2 和 n=7 撑不起比这更细的结论**。

更要紧的是：那 117 处引用里，模型**一个行号都没编**，所以**校验层至今什么都没抓到**。有可能正是"被告知引用会被核查"这件事让它老实的 —— 若如此，这一层的价值在威慑而非检出。这个假设在当前条件下无法证伪，属于本项目的开放问题，不是已有定论。

### 已知问题

1. **模式开着时，与代码库无关的通用问题只要回答够长，仍会收到 `no-citation` 警告。** 这是有意为之：任何"自动判断这是不是代码问题"的尝试都会引入第二个不可靠环节。遇到这种问题就先关掉模式。
2. **工作目录和 git 根之外的引用**会被报为文件不存在。
3. **校验只看引用是否存在，不看它是否支撑对应的论断。** 一个真实但引错地方的行号照样通过。
4. **扩展没加载时，模型会冒充它的输出。** 在放着本仓库源码的目录里裸跑 `pi` 并敲 `/grounded`，那不是已注册命令，pi 会把它当普通消息交给模型 —— 而模型读过源码，就会把插件的输出连同一份像模像样的会话统计一起演出来。这在扩展内部修不了。可靠的分辨信号是 footer 的 `🔍 grounded` 徽标、启动时的 extensions 列表、以及渲染出来的提示块；纯文本输出是可以伪造的。

## 与 `pi-behavior-control` 的区别

[`wbelk/pi-behavior-control`](https://github.com/wbelk/pi-behavior-control) 覆盖面更广 —— read-before-edit、改完复查、推测校验 —— 并且用一个**额外的 verifier 模型**扫描回答。

`pi-grounded` 更窄也更便宜。它关心的是**读**代码而不是改代码，校验是确定性的文件系统检查，所以**零额外 token、零额外模型调用**。想要完整的编码安全套装，用他们的；只是不想在学习一个代码库时被告知一堆听起来很像那么回事的东西，用这个。

## 开发

```bash
npm install
npm test          # 74 个单测，不需要 LLM
npm run typecheck
```

逻辑在 `citations.ts` / `tools.ts` / `probe.ts`，三者都不 import `ExtensionAPI`；`index.ts` 是唯一有副作用的模块。这个拆分是测试有意义的前提。

想确认测试不是摆设，故意改坏一个判断：

```bash
# 把 src/citations.ts 里的 `highest > lineCount` 改成 `false`
npm test    # 应该变红
```

设计与取舍见 [`PLAN.md`](PLAN.md)，怎么自己验收见 [`VERIFY.md`](VERIFY.md)，实测数据见 [`NOTES.md`](NOTES.md)。

## License

MIT
