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

> 本节区分**观测指标**（记录实际值，用于判断价值，不设门槛）和**验收门槛**（必须达标，否则不算完成）。
> v1 完全没有这一节；v2 初版有门槛但数字是拍的，且缺基线 —— 以下是修正版。

### 2.1 基线对照（A/B，先做）

**不测基线就无法归因。** 如果 Pi 本来就有 70% 的回答带出处，"开插件后 80%"什么也证明不了。

做法：准备 **12 个**关于 Pi 源码的问题（覆盖架构、具体实现、边界行为三类），

1. **A 组（基线）**：`/grounded off`，逐个提问，手工记录
2. **B 组（实验）**：`/grounded on`，**同样 12 题**重新开一个会话提问

> n=12 是可行性与统计力的折中。**明确其局限：n=12 只够发现明显差异，不足以支撑细微判断。** 任何依赖它的决策都必须考虑这一点（见 §7 K2）。

### 2.2 观测指标（记录实际值，不设门槛）

| | 含义 | 怎么读 |
|---|---|---|
| **O-1 引用密度** | 代码事实性回答中带 `file:line` 的比例 | **看 B 相对 A 的提升幅度**，不看绝对值 |
| **O-2 引用有效率** | 所有引用中路径存在且行号未越界的比例 | 判断模型是否倾向编造行号 |
| **O-3 幻觉捕获数** | 校验层抓到的无效引用次数 | **这是校验层是否有独立价值的唯一证据** |

> ⚠️ **O-2 存在循环论证**：它是用插件自己的校验结果评价插件。因此必须做独立核对 —— 见 2.4。

### 2.3 验收门槛（必须达标）

| | 门槛 | 为什么是这个值 |
|---|---|---|
| **T-1 误报率** | **= 0**：任何真实有效的引用都不得被判为无效 | 不是拍的数。校验层一旦误报就是在制造噪音，一次都不能有 —— 这是它能否存在的前提 |
| **T-2 无副作用** | 不产生会话中断、崩溃或 Pi 自身功能失效 | 底线 |
| **T-3 提示不泛滥** | B 组中出现 `no-citation` 提示的轮次 **< 30%** | 超过则说明模型基本不听 prompt，插件退化为噪音源（见 §8 R6） |

> **T-1 和 T-3 是硬门槛，O-1/O-2/O-3 只记录不卡关。** 原因：前者是"插件会不会帮倒忙"，可以客观判定；后者是"插件有多大用"，n=12 撑不起门槛。

### 2.4 独立核对（破循环论证）

从 B 组结果中**手工抽查 10 处引用**，人工打开文件核对，与插件判定逐条比对。

- 任何一条不一致 → **正则或路径解析有 bug**，属于 T-1 失败，必须修完重测

### 2.5 记录方式

`NOTES.md` 手工记录，不做自动埋点。表格：题号 / 组别 / 是否有引用 / 引用数 / 插件判定 / 人工核对结果。

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

**US2 · 抓到编造的行号（核心价值）** — ⚠️ *以下为示意，非实测观察；真实案例待 M1 端到端测试后回填*
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
| **D11** | `GROUNDED_BLOCK` 用什么语言写 | **指令用英文，输出标记用中文** | Pi 自身 system prompt 是英文，混入中文指令会降低遵循稳定性；而标记是给你看的，中文更直观。改语言只需动 `prompt.ts` 一个常量 | 全中文 / 全英文 |

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
  - ✅ **已由 S0 定案**：`pi.appendEntry("grounded-note", ...)` + `pi.registerEntryRenderer()`，**在 `agent_settled` 中提交**
  - ❌ 否决 `message_end` 替换 message：实测确认追加内容会**进入 LLM 上下文**，每轮警告都被送回模型 —— 浪费 token、可能被模仿、污染对话。而注释是给用户看的，本就不该进上下文
  - ⚠️ **`appendEntry` 必须在 `agent_settled` 调用，不能在 `message_end` 里** —— 后者会让 entry 落在 assistant 消息**之前**（`message_end` 处理器在消息入库前执行）

> 实测数据见 `NOTES.md` §1。这个拆分（`message_end` 只扫描 / `agent_settled` 提交）顺带带来一个好处：多轮工具调用的 run 只在最后标注一次，而不是每个中间轮次都标。

---

## 6. 技术方案

### 6.1 使用的 Pi API（均已核实）

| API | 用途 |
|---|---|
| `pi.registerCommand` | `/grounded`、`/source` |
| `pi.registerFlag` | `--grounded` |
| `pi.on("before_agent_start")` | 注入 system prompt |
| `pi.on("turn_start")` | 清空行数缓存 |
| `pi.on("message_end")` | 提取引用 → 校验 → **只记录，不产生副作用**（S0 定案） |
| `pi.on("agent_settled")` | 提交判定结果：`appendEntry` + footer 状态（S0 定案） |
| `pi.registerEntryRenderer()` | 渲染提示块（TUI-only，不进 LLM 上下文） |
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

> **核心原则**：`citations.ts` 不直接依赖 `ExtensionAPI`，文件系统访问通过**依赖注入**的 `fs` 接口（测试时传入内存假实现）。因此可直接单测，不需要跑 LLM。副作用全部收敛在 `index.ts`。
>
> （v2 初版此处写作"纯函数"，措辞不准确 —— 要访问 fs 就不是纯函数，那叫依赖注入。）

---

## 7. 里程碑与验收

> 工期是**粗估**，按"半天为最小单位"给，未拆到任务级，仅供排期参考。

### S0 · Spike：验证 `message_end` 替换（30 分钟，**动手前必做**）

> v1 把这个假设排到最后才验证，是排序错误。它决定 §5.5 首选方案能不能用。

**做法**：写一个 10 行的临时扩展，在 `message_end` 里给 assistant message 末尾追加一行，然后依次测 `/export`、`/tree`、`/resume`、`/share`。

**出口**（三分支，不是二值）
- [ ] **四项全部正常** → 采用 `message_end` 方案
- [ ] **仅 `/share` 异常** → 仍采用 `message_end`，README 注明"`/share` 导出的 gist 中提示块可能缺失"（`/share` 是低频功能，不值得为它放弃首选方案）
- [ ] **`/export` / `/tree` / `/resume` 任一异常** → 改用 `appendEntry` + `registerEntryRenderer` 降级方案（这三项影响会话完整性，不可妥协）
- [ ] 无论走哪个分支，**结论都必须写回本文档 §5.5 并 commit**

### M0 · 骨架 + 只读模式（0.5 天）

- [ ] `pi -e ./src/index.ts` 启动无报错
- [ ] `/grounded` 切换开关，footer 状态随之出现/消失；`/source` 等效；`pi --grounded` 启动即开
- [ ] 开启后 `/tools` 里 `edit`、`write` 消失；关闭后回来
- [ ] **中途 `/tools` 关掉 `find`，再 `/grounded off`，`find` 保持关闭**（不被覆盖）
- [ ] 让 agent 改文件 → 明确回复处于只读模式，不崩溃
- [ ] 通过用户 `settings.json` 的 `"extensions": ["<repo>/src/index.ts"]` 加载后 `/reload` 正常，无残留状态

> 开发期**不用软链** —— Windows 上建符号链接需管理员权限或开发者模式。改走 `settings.json` 的 `extensions` 数组，任意目录启动 `pi` 都能加载，可直接去 Pi 源码目录测试。详见 `VERIFY.md` §0.2。

### M1 · 引用校验（1 天）· **V1 核心**

- [ ] `citations.test.ts`：提取正则正例/反例 ≥ 20 条、路径解析（绝对/相对 cwd/相对 git 根）、三种校验结果、两态判定、跳过条件 —— **全绿**
- [ ] 端到端 `verified`：问需要查源码的问题 → 给出有效引用 → footer `✓N`，无提示块
- [ ] 端到端 `invalid`：手工构造一个越界行号的回答 → 提示块正确列出原因
- [ ] 端到端 `no-citation`：问一个模型倾向凭印象回答的问题 → 出现提示块
- [ ] 寒暄（"好的"）不触发任何检查
- [ ] **T-1 误报率为 0**：所有真实有效的引用都不被判为无效
- [ ] **§2.4 独立核对通过**：手工抽查 10 处引用，与插件判定逐条一致
- [ ] 任何校验异常都不中断会话（try/catch 兜底，失败降级为静默通过）

### M2 · 度量与打包（0.5 天）

- [ ] 按 §2.1 完成基线 A/B（12 题 × 2 组），记入 `NOTES.md`
- [ ] **硬门槛 T-1 / T-2 / T-3 全部达标**（否则触发 K3 / K4）
- [ ] 观测指标 O-1 / O-2 / O-3 已记录实际值（不卡关，用于判断是否触发 K2 观察期）
- [ ] `pi install <本地路径>` 成功；`pi list` 可见；`/grounded` 可用；`pi remove` 干净卸载
- [ ] README 含：N1 免责声明、用法、如何改标记语言、与 `pi-behavior-control` 的差异

### Kill criteria（什么情况下停手）

> v1 完全没有这一节。

- **K1** S0 两个方案都不可行（提示块无法呈现）→ 停手，重新设计呈现层
- **K2** **O-3 幻觉捕获数为 0** → 校验层可能没有独立价值。
  **但不立即降级** —— n=12 可能只是运气，用一个偶然结果推翻核心设计，样本量和决策严肃性不匹配。
  正确做法：**进入为期 1 周的日常使用观察期**（正常读 Pi 源码，不刻意构造问题）。1 周后 O-3 仍为 0，且 O-1 在基线基础上已有明显提升 → 才降级为纯 prompt 扩展并砍掉校验层代码。
- **K3** **T-1 误报率无法降到 0** → 校验层制造噪音，弊大于利 → 停手
- **K4** **T-3 不达标**（`no-citation` 轮次 ≥ 30%）且 prompt 迭代 3 轮后仍无改善 → 说明模型不吃这套提示，整个方案的前提不成立 → 停手，重新考虑约束手段（见 §8 R6）

---

## 8. 风险

| # | 风险 | 应对 |
|---|---|---|
| **R1** | `message_end` 替换 message 破坏 `/export` / `/resume` | **S0 前置 spike**，已有降级方案 |
| **R2** | 引用正则误判（`v1.2:30`） | 扩展名白名单 + ≥20 条单测反例 |
| **R3** | 相对路径解析失败导致误报"文件不存在" | cwd → git 根 两级回退；M1 验收硬性要求误报率 0 |
| **R4** | `setActiveTools` 与 `/tools`、其它扩展冲突 | 只做增量恢复，不整体覆盖；README 说明 |
| **R5** | 模型无视 `[推断]`/`[不确定]` 标记格式 | 可接受 —— 校验是主，格式是辅 |
| **R6** 🔴 | **模型根本不给 `file:line`** —— 则 `no-citation` 提示块每轮都出现，插件从质量工具退化为**噪音生成器**，比不装还烦 | **这是最可能发生的失败模式，也是本项目的头号风险。** ① `GROUNDED_BLOCK` 中明确告知"你给的每一处引用都会被工具校验"（附录 §10 第 3 条），这是比单纯要求更有效的行为杠杆；② 设硬门槛 T-3（`no-citation` 轮次 < 30%）；③ 若 T-3 不达标，先迭代 prompt 措辞（最多 3 轮），仍不达标则触发 K4 |

### 待 Kayce001 拍板

- **Q1** §4 的 D1–D11 是否同意？尤其 **D1**（摘掉写工具）和 **D2**（用引用校验取代工具追踪）
- **Q2** **附录 §10 的 `GROUNDED_BLOCK` 文本请逐条过目** —— 它决定 O-1 和 T-3 的成败，是本插件最关键的单一产出物，动工后改动成本会变高
- **Q3** 是每个里程碑停下来给你看，还是 S0→M2 一次做完？（建议前者，且 **S0 结果必须先给你看**）
- **Q4** M2 的发布范围：本地 `pi install` 即可，还是要发到 npm/GitHub？
- **Q5** §2.1 的基线 A/B 要问 12 题×2 轮，比较费时间。接受吗？还是降到 8 题（进一步牺牲统计力）？

> 原 v2 的 "Q2：80%/90% 门槛合不合理" 已删除 —— 那两个数是我拍的，把该我做的判断推给你是偷懒。现已改为 §2.3 中有明确依据的 T-1/T-3。

---

## 9. 参考

- Pi Extensions 文档：`packages/coding-agent/docs/extensions.md`（earendil-works/pi @ 0.85.1）
- 官方示例：`pirate.ts`（命令 + prompt 注入）、`tools.ts`（setActiveTools）、`entry-renderer.ts`（降级方案参考）、`message-renderer.ts`
- 对照项目：[`wbelk/pi-behavior-control`](https://github.com/wbelk/pi-behavior-control)

---

## 10. 附录：`GROUNDED_BLOCK` 草稿 · **请重点审核**

> 这是本插件最关键的单一产出物 —— **O-1（引用密度）和 T-3（提示不泛滥）成不成立，几乎完全由这段文字的措辞决定。**
> v2 初版只有 5 条 bullet 描述"要求模型做什么"，没有实际文本，等于把最关键的变量留成空白。以下是补上的 v1 草稿。
>
> 语言遵循 **D11**：指令英文（与 Pi 自身 system prompt 一致），输出标记中文。
> 追加位置：`event.systemPrompt` **末尾**（指令末尾权重更高）。

```text
## Source-Grounded Mode

You are in read-only research mode. The user is studying this codebase,
not changing it.

1. Evidence before claims.
   Before stating any fact about how THIS codebase works, read the relevant
   source with `read`, `grep`, or `find`. Do not answer from general knowledge
   of how similar projects are usually built. "Most agent frameworks do X" is
   not an answer to "what does this code do".

2. Cite every code fact.
   Each factual statement about this codebase must carry a source reference
   in the form `path/to/file.ext:LINE` — repo-root-relative, with a line
   number. A bare filename without a line number does not count.

3. Cite only what you actually read. Never guess a line number.
   If you know which file but not the line, read it first.
   A wrong line number is worse than no citation.
   Every reference you give is automatically verified against the filesystem,
   and invalid ones are shown to the user.

4. Mark what is not directly supported:
   - Directly supported by source → just give `file:line`, no label.
   - Your own reasoning beyond what the source states → prefix `[推断]`
   - Cannot be determined from the source → prefix `[不确定]`

5. Prefer `[不确定]` over guessing.
   "The source does not say" is a good answer. Inventing a plausible
   mechanism is not.

6. Read-only.
   The `edit` and `write` tools are disabled in this mode. Do not attempt to
   modify files. If the user asks for a change, tell them to run
   `/grounded off` first.

Answer in the user's language. Keep the two labels exactly as written above.
```

### 设计说明（为什么这样写）

| 条目 | 意图 |
|---|---|
| 第 1 条末句 | 直接点名要拦截的失败模式（"同类框架一般怎么做"），比抽象要求更有效 |
| 第 2 条"bare filename 不算" | 与 §5.4 正则的判定规则严格对齐，避免模型给了文件名却被判 `no-citation` |
| **第 3 条末两句** | **针对头号风险 R6 的核心杠杆** —— 告知模型"你给的引用会被机器校验、错的会当众展示"，这比单纯要求引用更能改变行为 |
| 第 4 条"直接支持的不加标签" | 遵循 **D6**，避免每句话都挂标签导致回答啰嗦 |
| 第 6 条 | 与 **D1** 只读模式配套，让模型知道该怎么回应修改请求（对应 US4），而不是反复重试失败的工具 |
| 末句 | 保证中文提问得到中文回答，同时锁定标记文案不被翻译 |

### 迭代规则

若 M2 实测 **T-3 不达标**（`no-citation` 轮次 ≥ 30%），按以下顺序迭代，**每轮只改一处并重测**，最多 3 轮（超出则触发 **K4**）：

1. 强化第 3 条的校验告知（如加入"invalid citations are highlighted in red to the user"）
2. 在第 2 条加入正例/反例示范
3. 把整段从 system prompt 末尾改为独立的高优先级段落，或提高措辞强度（MUST / NEVER）

每轮迭代的措辞与实测结果都记入 `NOTES.md`。
