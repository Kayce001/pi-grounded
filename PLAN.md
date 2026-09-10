# pi-grounded 开发规划 v2

> **一句话**：Pi 回答代码库问题时必须给出 `file:line`；插件当场校验这些引用是否真实存在。
>
> **Tagline**: *Ground Pi's answers in the codebase, not assumptions.*

| 项目 | 值 |
|---|---|
| 包名 | `pi-grounded` |
| 类型 | Pi Extension（稳定 API） |
| 目标 Pi 版本 | `0.85.1` ✅ 已升级，与仓库 HEAD 同版本 |
| 仓库 | `<repo>` |
| 文档版本 | **v2** · 2026-09-10 · 待 Kayce001 审核 |

> v1 已归档在 git 历史（commit `d32f093`）。v2 依据"功能简化"要求重写：砍掉三档处置、shell 黑名单、配置文件、状态持久化、工具调用追踪；新增**引用有效性校验**、**成功度量**、**Spike 前置阶段**、**Kill criteria**。

---

## 1. 问题与目标

### 1.1 痛点

用 Pi 读陌生代码库（首要场景：读 Pi 自己的源码）时的两类失败：

1. **凭印象作答** —— 用"同类 Agent 框架一般怎么设计"回答"Pi 这里到底怎么实现的"
2. **无法追溯** —— 答对了也不给出处，用户无从核对

共同点：**用户事后无法分辨哪句有源码依据、哪句是编的。**

### 1.2 为什么不能只靠提示词

把"请先查源码"写进 `AGENTS.md` 或 `--append-system-prompt`，和一个纯 prompt 注入插件**完全等价**。模型可以无视，而它最容易无视的时刻恰好就是本插件要解决的场景。

> **存在理由**：提供 prompt 做不到的两件事 —— **约束**（物理上禁止改文件）与**验证**（用代码校验引用真伪）。

### 1.3 Goals

- **G1** 提供显式的**只读研究模式**，开启后 Pi 无法修改文件
- **G2** 引导模型对代码事实性陈述给出 `file:line`
- **G3** **校验每一处引用是否真实存在**（文件在不在、行号越不越界），结果可见
- **G4** 零额外 token 开销、零额外 LLM 调用
- **G5** 可发布：别人能 `pi install` 直接用

### 1.4 Non-Goals

- **N1 不是安全沙箱。** Pi 官方明确说明自身无权限系统，需要真隔离请容器化。本插件只摘掉 `edit`/`write` 工具，**不拦截 bash**，README 必须写明
- **N2** 不引入 verifier 模型（那是 `pi-behavior-control` 的路线，重且烧 token）
- **N3** 不管"写代码"场景 —— 不做 code review、不做 read-before-edit
- **N4** 不自动判断"这问题算不算代码事实性问题"（见 D5）
- **N5** 不做配置文件、不做跨会话持久化、不做多档处置

### 1.5 差异化

| | `pi-behavior-control` | **`pi-grounded`** |
|---|---|---|
| 定位 | coding safety，管"改代码" | code understanding，管"读代码" |
| 验证 | 额外 verifier 模型扫描 | **文件系统校验引用真伪** |
| 约束 | 提示 + 复查 | 直接摘掉写工具 |
| token | 每轮额外开销 | 零 |
| 体量 | 多功能套装 | 4 个源文件 |

---

## 2. 成功度量（Outcome）

> v1 缺的就是这一节：验收标准只能证明"功能按描述工作"，证明不了"问题被解决了"。

**主指标** —— 用 pi-grounded 读 Pi 源码连续 10 轮问答后：

- **M-1 引用密度**：≥ 80% 的代码事实性回答带有至少一处 `file:line`
- **M-2 引用有效率**：所有引用中，指向真实存在的文件且行号未越界的比例 ≥ 90%
- **M-3 幻觉捕获**：至少捕获到 1 次"引用了不存在的文件或越界的行号" —— **若一次都没捕获到，说明校验层没有产生独立价值**（见 §7 Kill criteria）

**反指标**（不能变差）：

- **M-4** 不因插件产生任何会话中断、崩溃或 Pi 自身功能失效
- **M-5** 误报率：把有效引用判为无效的次数 = 0

度量方式：M0 完成后开一个 `NOTES.md` 手工记录 10 轮实测，不做自动埋点。

---

## 3. 用户故事

**US1 · 主场景**
```
> /grounded on
  ✓ grounded on · 只读模式（已禁用 edit, write）

> Harness 的 Lane 到底是干什么的？

  Lane 是 ... packages/agent/src/harness.ts:120 定义了 ...
  调用方在 packages/agent/src/session.ts:88 ...
  [推断] 从调用顺序看，它应该负责 ...
  [不确定] 源码未写明 Lane 与 Branch 的生命周期关系

  ✓ grounded · 3 处引用已校验
```

**US2 · 抓到编造的行号（核心价值）**
```
> compaction 是怎么触发的？

  ... packages/agent/src/compaction.ts:450 处判断阈值 ...

  ─────────────────────────────────────
  ⚠️ grounded · 1 处引用无效
     packages/agent/src/compaction.ts:450
       → 文件仅 182 行，行号越界
  ─────────────────────────────────────
```

**US3 · 完全没给出处**
```
> Pi 的 session 存在哪？

  Session 通常保存在用户目录下的配置文件夹中 ...

  ─────────────────────────────────────
  ⚠️ grounded · 本轮回答未给出任何源码出处
  ─────────────────────────────────────
```

**US4 · 边界（失败态）**
```
> 帮我把这个函数改成异步的

  模型尝试调用 edit → 工具不存在
  模型回复：当前处于 grounded 只读模式，无法修改文件。
            如需修改请先 /grounded off
```

**US5 · 失败态 · 引用的是非项目文件**
```
  ... 参见 node_modules/foo/index.js:12 ...
  → 文件真实存在 → 判定为有效引用（不区分是否项目内文件）
```

---

## 4. 设计决策（ADR）

> 每条都是建议默认值，**审核时请逐条确认或推翻**。v1 的 D2/D3/D4/D7 因功能砍除已消失。

| # | 决策 | 选择 | 理由 | 备选 |
|---|---|---|---|---|
| **D1** | 开启时摘掉 `edit`/`write` | **是** | 这是插件从"提示词"变成"机制"的关键，也让"研究模式"语义自洽 | 只注入 prompt（退化为 `pirate.ts` 换皮，无独立价值） |
| **D2** | 判定依据 | **只看引用有效性**，不追踪工具调用 | 更简单（无需 turn 状态机）且更强（能抓编造的行号） | 追踪 read/grep 调用（v1 方案） |
| **D3** | 处置方式 | **只有一档**：在回答后附提示块 | 砍掉 `enforce` 后死循环风险整个消失 | 三档 |
| **D4** | bash 写操作 | **不管** | 黑名单会误伤、要维护、不是安全边界。N1 已声明 | 关键词黑名单（v1 方案） |
| **D5** | 何时检查 | **模式开着就一律检查**，仅用长度阈值排除寒暄 | 任何"自动判断是不是代码问题"都不可靠 | 智能判定 |
| **D6** | 证据标记 | 已验证的**直接给 `file:line` 不加标签**；只有 `[推断]` / `[不确定]` 需标注 | 三级全标会让回答很啰嗦，违背"使用方便" | 三级全标（v1 方案） |
| **D7** | 标记语言 | **中文**（`[推断]`/`[不确定]`），发布时 README 说明如何改 | 你是主要用户；改成英文只需改 `prompt.ts` 一个常量 | 英文默认 |
| **D8** | 命令 | `/grounded`（`/source` 别名）+ `pi --grounded` | 三个入口够了 | 更多子命令 |
| **D9** | 配置 | **无配置文件**，常量写在 `src/config.ts`，改完 `/reload` 生效 | jiti 直接跑 TS，改常量成本极低 | JSON 配置 |
| **D10** | 状态 | **仅内存**，不跨会话 | `/resume` 后重敲一次不是负担 | `appendEntry` 持久化 |

---

## 5. 功能规格

### 5.1 入口（3 个）

| 入口 | 行为 |
|---|---|
| `/grounded` | 无参数：切换开关并显示状态 |
| `/source` | `/grounded` 的别名 |
| `pi --grounded` | 启动即开启 |

### 5.2 只读模式（D1）

```
开启：removed = 当前 active 中的 ["edit","write"]
      setActiveTools(active - removed)      ← 记录 removed
关闭：setActiveTools(当前 active ∪ removed)  ← 只加回摘掉的，不整体覆盖
```

> **不整体覆盖**是为了不冲掉用户中途用 `/tools` 做的改动。

Pi 内置工具全集：`read` `bash` `powershell` `edit` `write` `grep` `find` `ls`

### 5.3 System Prompt 注入

`before_agent_start` → `return { systemPrompt: event.systemPrompt + GROUNDED_BLOCK }`（链式追加，不覆盖用户自己的 `--append-system-prompt`）

`GROUNDED_BLOCK` 要求模型：
- 回答关于当前代码库的事实性问题前，先用 `read`/`grep`/`find` 查证
- 每条代码事实性陈述给出 `path:line`（相对仓库根）
- 推断的内容标 `[推断]`，源码无法确认的标 `[不确定]`
- 宁可说 `[不确定]` 也不要编
- 当前只读，不要尝试修改文件

### 5.4 引用提取与校验（核心，D2）

**提取正则**
```
/(?:^|[\s(`"'])([\w.\-/\\]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|go|rs|java|c|h|cc|cpp|cs|rb|php|sh|yaml|yml|toml))(?::(\d+))(?:-(\d+))?/g
```
- **必须带 `:行号`**，裸文件名不算引用
- 扩展名白名单，避免把 `v1.2:30` 之类误判为路径

**校验步骤**（每处引用）
1. 路径解析：绝对路径直接用；相对路径先按 `ctx.cwd` 解析，失败再按 **git 仓库根**解析（启动时 `pi.exec("git",["rev-parse","--show-toplevel"])` 取一次并缓存）
2. `existsSync` → 不存在则判 `FILE_NOT_FOUND`
3. 读文件行数 → `line > lineCount` 则判 `LINE_OUT_OF_RANGE`
4. 否则 `OK`

**性能**：单轮引用通常 < 20 处，同步 fs 足够；文件行数按路径缓存，`turn_start` 清空。

**判定（两态）**

| 引用数 | 全部有效 | 结论 | 提示 |
|:---:|:---:|---|---|
| 0 | — | `no-citation` | ⚠️ 本轮回答未给出任何源码出处 |
| ≥1 | ✅ | `verified` | ✓ N 处引用已校验（仅 footer，不打扰） |
| ≥1 | ❌ | `invalid` | ⚠️ N 处引用无效 + 逐条列出原因 |

**跳过检查**
- 模式未开启
- 本轮无 assistant 文本（纯工具调用轮）
- 正文长度 < 200 字符（排除寒暄）

### 5.5 呈现（D3，单档）

- **footer**：开启时常驻 `🔍 grounded`；判定后追加 `· ✓3` 或 `· ⚠️1`
- **回答后提示块**：仅 `no-citation` 和 `invalid` 时出现
  - 首选：`message_end` 返回替换后的 message（**取决于 Spike 结果，见 §6 S0**）
  - 降级：`appendEntry` + `registerEntryRenderer` 做 TUI-only 块

---

## 6. 技术方案

### 6.1 使用的 Pi API（均已核实）

| API | 用途 |
|---|---|
| `pi.registerCommand` | `/grounded`、`/source` |
| `pi.registerFlag` | `--grounded` |
| `pi.on("before_agent_start")` | 注入 system prompt |
| `pi.on("turn_start")` | 清空行数缓存 |
| `pi.on("message_end")` | 提取引用 → 校验 → 附提示块 |
| `pi.getActiveTools` / `setActiveTools` | 只读模式 |
| `pi.exec` | 取 git 仓库根 |
| `ctx.ui.setStatus` / `notify` | footer 与通知 |

### 6.2 目录结构（4 个源文件）

```
<repo>\
├── PLAN.md
├── NOTES.md              §2 度量的手工记录
├── README.md             面向用户，含 N1 免责声明
├── package.json          pi.extensions → src/index.ts
├── tsconfig.json / vitest.config.ts / .gitignore
├── src/
│   ├── index.ts          入口：注册 + 事件装配（唯一有副作用的文件）
│   ├── config.ts         常量（工具名单、阈值、标记文案）
│   ├── prompt.ts         GROUNDED_BLOCK
│   └── citations.ts      提取 + 解析 + 校验 + 判定（纯函数）
└── test/
    └── citations.test.ts
```

> **核心原则**：`citations.ts` 是纯函数（文件系统访问通过注入的 `fs` 接口），可直接单测，不需要跑 LLM。副作用全部收敛在 `index.ts`。

---

## 7. 里程碑与验收

> 工期是**粗估**，按"半天为最小单位"给，未拆到任务级，仅供排期参考。

### S0 · Spike：验证 `message_end` 替换（30 分钟，**动手前必做**）

> v1 把这个假设排到最后才验证，是排序错误。它决定 §5.5 首选方案能不能用。

**做法**：写一个 10 行的临时扩展，在 `message_end` 里给 assistant message 末尾追加一行，然后依次测 `/export`、`/tree`、`/resume`、`/share`。

**出口**
- [ ] 四项全部正常 → 采用 `message_end` 方案
- [ ] 任一异常 → 改用 `appendEntry` + `registerEntryRenderer` 降级方案，**并把结论写回本文档**

### M0 · 骨架 + 只读模式（0.5 天）

- [ ] `pi -e ./src/index.ts` 启动无报错
- [ ] `/grounded` 切换开关，footer 状态随之出现/消失；`/source` 等效；`pi --grounded` 启动即开
- [ ] 开启后 `/tools` 里 `edit`、`write` 消失；关闭后回来
- [ ] **中途 `/tools` 关掉 `find`，再 `/grounded off`，`find` 保持关闭**（不被覆盖）
- [ ] 让 agent 改文件 → 明确回复处于只读模式，不崩溃
- [ ] 软链到 `~/.pi/agent/extensions/` 后 `/reload` 正常，无残留状态

### M1 · 引用校验（1 天）· **V1 核心**

- [ ] `citations.test.ts`：提取正则正例/反例 ≥ 20 条、路径解析（绝对/相对 cwd/相对 git 根）、三种校验结果、两态判定、跳过条件 —— **全绿**
- [ ] 端到端 `verified`：问需要查源码的问题 → 给出有效引用 → footer `✓N`，无提示块
- [ ] 端到端 `invalid`：手工构造一个越界行号的回答 → 提示块正确列出原因
- [ ] 端到端 `no-citation`：问一个模型倾向凭印象回答的问题 → 出现提示块
- [ ] 寒暄（"好的"）不触发任何检查
- [ ] **误报率为 0**（M-5）：所有真实有效的引用都不被判为无效
- [ ] 任何校验异常都不中断会话（try/catch 兜底，失败降级为静默通过）

### M2 · 度量与打包（0.5 天）

- [ ] 按 §2 完成 10 轮实测并记入 `NOTES.md`，M-1/M-2/M-3 达标
- [ ] `pi install <本地路径>` 成功；`pi list` 可见；`/grounded` 可用；`pi remove` 干净卸载
- [ ] README 含：N1 免责声明、用法、如何改标记语言、与 `pi-behavior-control` 的差异

### Kill criteria（什么情况下停手）

> v1 完全没有这一节。

- **K1** S0 两个方案都不可行（提示块无法呈现）→ 停手，重新设计呈现层
- **K2** M1 完成后实测 **M-3 为 0**（一次幻觉都没抓到）且 M-1 引用密度已 ≥ 80% → 说明 prompt 注入已经够用，校验层没有独立价值 → **降级为纯 prompt 扩展并大幅缩减代码**，不要为了完成计划而保留无用的复杂度
- **K3** 误报率（M-5）无法降到 0 → 校验层会制造噪音，弊大于利 → 停手

---

## 8. 风险

| # | 风险 | 应对 |
|---|---|---|
| **R1** | `message_end` 替换 message 破坏 `/export` / `/resume` | **S0 前置 spike**，已有降级方案 |
| **R2** | 引用正则误判（`v1.2:30`） | 扩展名白名单 + ≥20 条单测反例 |
| **R3** | 相对路径解析失败导致误报"文件不存在" | cwd → git 根 两级回退；M1 验收硬性要求误报率 0 |
| **R4** | `setActiveTools` 与 `/tools`、其它扩展冲突 | 只做增量恢复，不整体覆盖；README 说明 |
| **R5** | 模型无视标记格式 | 可接受 —— 校验是主，格式是辅 |

### 待 Kayce001 拍板

- **Q1** §4 的 D1–D10 是否同意？尤其 **D1**（摘掉写工具）和 **D2**（用引用校验取代工具追踪）
- **Q2** §2 的成功度量门槛（80% / 90%）合不合理？
- **Q3** 是每个里程碑停下来给你看，还是 S0→M2 一次做完？（建议前者，且 **S0 结果必须先给你看**）
- **Q4** M2 的发布范围：本地 `pi install` 即可，还是要发到 npm/GitHub？

---

## 9. 参考

- Pi Extensions 文档：`packages/coding-agent/docs/extensions.md`（earendil-works/pi @ 0.85.1）
- 官方示例：`pirate.ts`（命令 + prompt 注入）、`tools.ts`（setActiveTools）、`entry-renderer.ts`（降级方案参考）、`message-renderer.ts`
- 对照项目：[`wbelk/pi-behavior-control`](https://github.com/wbelk/pi-behavior-control)
