# pi-grounded 开发规划

> **一句话**：让 Pi 回答代码库问题时，先查源码再下结论；查没查过，由插件用代码验证，而不是靠模型自觉。
>
> **Tagline**: *Ground Pi's answers in the codebase, not assumptions.*

| 项目 | 值 |
|---|---|
| 包名 | `pi-grounded` |
| 类型 | Pi Extension（稳定 API），后续打包为 Pi Package |
| 目标 Pi 版本 | `0.85.1` ✅ 已升级，与仓库 HEAD 同版本 |
| 仓库 | `<repo>`（已 `git init`） |
| 文档版本 | v1 草案 · 2026-09-10 · **待 Kayce001 审核** |

---

## 1. 背景与问题定义

### 1.1 真实痛点

在用 Pi 阅读陌生代码库（首要场景：读 Pi 自己的源码）时，模型会出现两类失败：

1. **凭印象作答** —— 用"同类 Agent 框架一般怎么设计"来回答"Pi 这里到底怎么实现的"。回答听起来合理，但可能整段是编的。
2. **无法追溯** —— 即使答对了，也不给 `file:line`，用户无法自己去核对。

这两类失败的共同点：**用户事后无法分辨哪句话有源码依据、哪句话是模型的推测。**

### 1.2 为什么不能只靠提示词

把"请先查源码再回答"写进 `AGENTS.md` 或 `--append-system-prompt`，效果和一个纯 prompt 注入的插件**完全等价**。模型可以无视，而且它最容易无视的时刻，恰好就是"它觉得自己已经知道答案"的时刻 —— 也就是本插件要解决的场景。

> **本插件的存在理由**：提供 prompt 做不到的两件事 —— **约束**（物理上禁止某些行为）和**验证**（用确定性代码检查行为是否发生）。

### 1.3 目标（Goals）

- G1 提供一个显式的**只读研究模式**，开启后 Pi 无法修改文件
- G2 引导模型对代码事实性陈述给出 `file:line` 出处，并区分【已验证 / 推断 / 不确定】
- G3 用**确定性检查**（非 LLM）判定每一轮回答是否有源码依据，并把结果**可见地**呈现给用户
- G4 零额外 token 开销
- G5 可发布：别人能 `pi install` 直接用

### 1.4 非目标（Non-Goals）

- N1 **不是安全沙箱**。Pi 官方明确说明自身无权限系统，需要真隔离请用容器。本插件的写操作拦截是**防手滑，不防对抗**，README 必须写明
- N2 不引入第二个 verifier 模型（这是 `pi-behavior-control` 的路线，重且烧 token）
- N3 不做 code review、不做 read-before-edit、不管"写代码"场景 —— 那是 `pi-behavior-control` 的地盘
- N4 不自动判断"这个问题算不算代码事实性问题"（见 §3 D6）
- N5 V1 不做跨会话持久化（见 §3 D4）

### 1.5 与 `pi-behavior-control` 的差异化

| | `pi-behavior-control` | **`pi-grounded`** |
|---|---|---|
| 定位 | coding safety，管"改代码" | code understanding，管"读代码" |
| 验证方式 | 额外 verifier 模型扫描 | 确定性检查（工具调用记录 + 正则） |
| 约束手段 | 提示 + 复查 | 直接摘掉写工具 |
| token 成本 | 每轮额外开销 | 零 |
| 体量 | 多功能套装 | 单一职责 |

---

## 2. 用户故事

**US1 · 主场景**
```
> /grounded on
  ✓ Grounded mode 已开启（只读 · annotate）
  ✓ 已禁用工具: edit, write

> Harness 的 Lane 到底是干什么的？

  [模型调用 grep/read 查源码]

  Lane 是 ...
  [VERIFIED] packages/agent/src/harness.ts:120 定义了 ...
  [INFERRED] 从调用方看，它的作用应该是 ...
  [UNKNOWN] 源码里没有写明 Lane 与 Branch 的生命周期关系
```

**US2 · 捕获凭印象作答**
```
> Pi 的 compaction 是怎么触发的？

  [模型没有调用任何读取工具，直接作答]

  Compaction 通常在上下文超过阈值时触发 ...

  ─────────────────────────────────────
  ⚠️ 本轮回答未查阅源码，也未给出 file:line 出处
     可能包含推测。输入 /grounded why 查看判定依据
  ─────────────────────────────────────
```

**US3 · 边界清晰**
```
> 帮我把这个函数改成异步的

  模型尝试调用 edit → 工具不存在
  模型回复：当前处于 grounded 只读模式，无法修改文件。
            如需修改请先 /grounded off
```

---

## 3. 设计决策记录（ADR）

> 下列每条都是我的建议默认值。**审核时请逐条确认或推翻。**

| # | 决策 | 选择 | 理由 | 备选 |
|---|---|---|---|---|
| **D1** | 开启时是否摘掉 `edit`/`write` | **是**，可配置 `readOnly: false` 关闭 | 这是插件从"提示词"变成"机制"的关键。同时让"研究模式"语义自洽 | 只注入 prompt（退化为 `pirate.ts` 换皮） |
| **D2** | 默认处置档位 | **`annotate`** | 不打断工作流，但结论可见。`warn` 太弱容易忽略，`enforce` 有循环风险且打断思路 | `warn` / `enforce` |
| **D3** | `bash`/`powershell` 怎么办 | **保留**（grep/rg 需要），加**关键词黑名单**拦截写操作，标记为 best-effort | 摘掉 bash 会让模型没法搜索，得不偿失 | 一起摘掉 / 完全不管 |
| **D4** | 状态持久化范围 | **会话级**。`appendEntry` 记录，`session_start` 恢复；不跨会话 | "我在读代码"是临时状态，跨会话保留容易忘了开着，反而困惑 | 跨会话（写 `~/.pi/agent/grounded.json`） |
| **D5** | 判定信号组合 | **三态**：有 citation → `verified`；只读过没 citation → `unsourced`；都没有 → `speculative` | 引用可能来自前几轮已读的文件，所以 citation 单独成立；只读不引用也是问题（不可追溯） | 二态 `pass/fail` |
| **D6** | 如何判断"该不该检查这一轮" | **不做智能判定**。模式本身承担语义：开着就一律检查。仅用长度阈值排除寒暄 | 任何"自动判断是不是代码问题"都不可靠，会引入新的不可信环节 | 让模型自己标记 / 关键词匹配 |
| **D7** | 证据分级标记语言 | **默认英文** `[VERIFIED] / [INFERRED] / [UNKNOWN]`，提供 `labels` 配置项换中文 | 要发布就得英文默认；你本地配置里换成中文 | 只做中文（不可发布） |
| **D8** | 命令名 | 主命令 `/grounded`，注册 `/source` 为别名 | 包名一致；`/source` 保留你原本的直觉 | 只留一个 |
| **D9** | V1 交付范围 | **完整验证闭环**（M0–M3），不做纯 prompt 版 | 纯 prompt 版没有独立价值（§1.2），做了等于白做 | 先出 prompt 版试水 |
| **D10** | 发布形态 | 一开始就按 Pi Package 结构组织，M4 完成发布物 | 结构成本很低，事后重构反而麻烦 | 先单文件，之后再拆 |

---

## 4. 功能规格

### 4.1 命令与入口

| 入口 | 行为 |
|---|---|
| `/grounded` | 显示当前状态摘要（开关、档位、本会话统计） |
| `/grounded on` \| `off` | 开关模式 |
| `/grounded warn` \| `annotate` \| `enforce` | 切换处置档位 |
| `/grounded why` | 显示最近一次判定的完整依据（本轮调用了哪些工具、读了哪些文件、是否匹配到 citation） |
| `/source ...` | `/grounded` 的别名 |
| `pi --grounded` | 启动即开启（`pi.registerFlag`） |

### 4.2 只读模式（D1）

**开启时**
1. `const active = pi.getActiveTools()`
2. `const removed = active.filter(t => WRITE_TOOLS.includes(t))`  ← **记录摘掉了哪些**
3. `pi.setActiveTools(active.filter(t => !WRITE_TOOLS.includes(t)))`

**关闭时**
- `pi.setActiveTools([...new Set([...pi.getActiveTools(), ...removed])])`
- **只把摘掉的加回去，不整体覆盖** —— 否则会覆盖用户中途用 `/tools` 做的修改

**常量**
- `WRITE_TOOLS = ["edit", "write"]`
- Pi 内置工具全集：`read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, `ls`
- 启动时用 `pi.getAllTools()` 扫描，若发现名单外的非内置写类工具 → 记录一条提示，不阻断

### 4.3 Shell 写操作拦截（D3，best-effort）

`pi.on("tool_call")` 拦截 `bash` / `powershell`，命中黑名单则 `return { block: true, reason }`：

```
重定向     >  >>
写命令     tee, sed -i, dd, truncate
文件操作   rm, mv, cp, mkdir, touch, chmod, chown, ln
包管理     npm i/install, pip install, cargo add
版本控制   git commit, git checkout, git apply, git reset, git clean, git stash
编辑器     vi, vim, nano, code
```

> **README 必须写明**：这是防手滑的启发式，**不是安全边界**，不防对抗性输入。真隔离请容器化。

### 4.4 System Prompt 注入

`pi.on("before_agent_start")` 中 `return { systemPrompt: event.systemPrompt + GROUNDED_BLOCK }`。

`GROUNDED_BLOCK` 要求模型：
- 回答任何关于**当前代码库**的事实性问题前，先用 `read`/`grep`/`find` 查证
- 每条代码事实性陈述标注 `path:line`
- 用三级标记区分：`[VERIFIED]` 有源码直接支持 / `[INFERRED]` 由源码推导 / `[UNKNOWN]` 源码无法确认
- 宁可说 `[UNKNOWN]` 也不要编
- 当前处于只读模式，不要尝试修改文件

追加在 system prompt 末尾（靠近指令末尾权重更高）。

### 4.5 证据检测

```
turn_start           → 重置本轮状态
tool_execution_end   → 若 !isError：
                         toolName ∈ {read, grep}        → strongEvidence = true, 记录路径
                         toolName ∈ {find, ls}          → weakEvidence = true
                         toolName ∈ {bash, powershell}  → 命令匹配搜索模式(grep|rg|ag|cat|head|sed -n|awk)
                                                          → strongEvidence = true
message_end (assistant)
                     → 正则扫描 citation
agent_settled        → 判定 + 处置
```

**Citation 正则（初版）**
```
/(?:^|[\s(`"'])([\w.\-/\\]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|go|rs|java|c|h|cc|cpp|cs|rb|php|sh|yaml|yml|toml))(?::(\d+))(?:-(\d+))?/g
```
- **必须带 `:行号`**，只有文件名不算
- 扩展名清单可通过配置扩充

**判定表（D5）**

| strongEvidence | citation | 结论 | 默认处置 |
|:---:|:---:|---|---|
| — | ✅ | `verified` | 无（可选绿色状态） |
| ✅ | ❌ | `unsourced` | 提示"已查源码但未标注出处" |
| ❌ | ❌ | `speculative` | 按档位处置 |

**跳过检查的情况**
- 模式未开启
- 本轮无 assistant 文本（纯工具调用轮）
- assistant 正文长度 < `minAnswerLength`（默认 200 字符）
- 本轮由 `/command` 触发

### 4.6 处置分档（D2）

| 档位 | 行为 | 实现 |
|---|---|---|
| `warn` | footer 显示红色状态 | `ctx.ui.setStatus("grounded", ...)` |
| `annotate`（默认） | 在回答末尾追加 ⚠️ 未验证提示块 | `message_end` 返回替换后的 message（role 保持 `assistant`） |
| `enforce` | 自动回炉重答 | `pi.sendUserMessage(RETRY_PROMPT)` |

**`enforce` 防循环闸（硬性要求）**
- 每个用户 prompt 最多回炉 **1 次**
- 回炉后无论结果如何，都不再触发
- 计数器在下一个 `before_agent_start` 重置
- 回炉时 footer 明确显示"grounded 正在要求重答（1/1）"

### 4.7 UI

| 位置 | 内容 |
|---|---|
| footer status | 开启时常驻 `🔍 grounded·annotate`；检出 speculative 时变红 |
| 回答末尾 | `annotate` 档的警告块 |
| `/grounded` 输出 | 状态摘要 + 本会话统计（verified / unsourced / speculative 各几次） |
| `/grounded why` | 最近一次判定的完整依据 |

### 4.8 配置

优先级：内置默认 ← `~/.pi/agent/grounded.json`（存在则覆盖）

```jsonc
{
  "readOnly": true,              // D1
  "enforcement": "annotate",     // warn | annotate | enforce
  "minAnswerLength": 200,
  "blockShellWrites": true,      // D3
  "extraCodeExtensions": [],     // 扩充 citation 正则的扩展名
  "labels": {                    // D7
    "verified": "[VERIFIED]",
    "inferred": "[INFERRED]",
    "unknown":  "[UNKNOWN]"
  }
}
```

---

## 5. 技术方案

### 5.1 使用的 Pi API（均已核实存在于 `docs/extensions.md`）

| API | 用途 |
|---|---|
| `pi.registerCommand(name, opts)` | `/grounded`、`/source` |
| `pi.registerFlag("grounded", ...)` | `pi --grounded` |
| `pi.on("before_agent_start")` | 注入 system prompt（链式，返回 `{ systemPrompt }`） |
| `pi.on("tool_call")` | shell 写操作拦截（返回 `{ block, reason }`） |
| `pi.on("turn_start")` | 重置本轮状态 |
| `pi.on("tool_execution_end")` | 记录证据（`toolName` / `args` / `result` / `isError`） |
| `pi.on("message_end")` | 扫描 citation；`annotate` 档替换 message |
| `pi.on("agent_settled")` | 判定与处置（此时 Pi 不会再自动继续） |
| `pi.on("session_start")` / `session_shutdown` | 恢复状态 / 清理 |
| `pi.getActiveTools()` / `setActiveTools()` / `getAllTools()` | 只读模式 |
| `pi.sendUserMessage(text)` | `enforce` 档回炉 |
| `pi.appendEntry(type, data)` | 会话级状态持久化（不进 LLM 上下文） |
| `ctx.ui.setStatus/notify/setWidget` | UI |

### 5.2 目录结构

```
<repo>\
├── PLAN.md                 本文档
├── README.md               面向用户（英文，含 §1.4-N1 免责声明）
├── package.json            Pi Package 清单（pi.extensions 指向 src/index.ts）
├── tsconfig.json
├── vitest.config.ts
├── .gitignore
├── src/
│   ├── index.ts            入口：注册命令/flag/事件，装配
│   ├── state.ts            模式状态机 + 会话统计 + 持久化
│   ├── config.ts           配置加载与默认值
│   ├── prompt.ts           GROUNDED_BLOCK 文本
│   ├── readonly.ts         工具摘除/恢复 + shell 黑名单
│   ├── detector.ts         证据追踪 + citation 扫描 + 判定（纯函数）
│   ├── enforcer.ts         三档处置 + 防循环闸
│   └── ui.ts               status / annotate 块渲染
└── test/
    ├── detector.test.ts    citation 正则、工具分类、判定表
    ├── readonly.test.ts    摘除/恢复、shell 黑名单
    └── enforcer.test.ts    档位分派、防循环闸
```

**核心原则：`detector.ts` / `readonly.ts` / `enforcer.ts` 写成纯函数，不依赖 `ExtensionAPI`**，这样可以用 vitest 直接单测，不需要跑 LLM。副作用全部收敛在 `index.ts`。

### 5.3 状态机

```
                ┌──────────┐
      /on  ───▶ │ ENABLED  │ ◀─── pi --grounded
                └────┬─────┘
                     │ 摘掉 edit/write，记录 removed[]
                     │ 注入 system prompt
                     │ 每轮检测 + 处置
      /off ◀─────────┘
                     │ 恢复 removed[] 到当前 active 集合
                ┌────▼─────┐
                │ DISABLED │  （默认）
                └──────────┘
```

---

## 6. 里程碑与交付

每个里程碑 = 一个 commit = 一个可运行状态。

### M0 骨架（0.5 天）

**交付**：仓库结构、`package.json`、`src/index.ts` 最小扩展、`/grounded` 开关（仅内存状态 + footer 显示）

**验收**
- [ ] `pi -e ./src/index.ts` 启动无报错
- [ ] `/grounded` 显示状态；`/grounded on` / `off` 切换，footer 状态随之出现/消失
- [ ] `/source on` 别名等效
- [ ] `pi --grounded` 启动即为开启态
- [ ] 软链到 `~/.pi/agent/extensions/` 后 `/reload` 能热重载，不残留旧状态

### M1 只读模式（0.5 天）

**交付**：`readonly.ts` + shell 黑名单 + 单测

**验收**
- [ ] 开启后 `/tools` 里 `edit`、`write` 消失
- [ ] 让 agent 修改任意文件 → 它明确回复处于只读模式而非报错崩溃
- [ ] `bash: echo x > /tmp/a` → 被 block，reason 可读
- [ ] `bash: grep -rn foo .` → 正常放行
- [ ] 关闭后 `edit`/`write` 回来
- [ ] **中途用 `/tools` 关掉 `find` 再 `/grounded off`，`find` 仍保持关闭**（不被覆盖）
- [ ] `readOnly: false` 配置下不摘工具
- [ ] `npm test` 中 `readonly.test.ts` 全绿

### M2 Prompt 注入与证据分级（0.5 天）

**交付**：`prompt.ts` + `config.ts`（含 `labels`）

**验收**
- [ ] 开启后提问代码问题，回答中出现三级标记
- [ ] 关闭后标记消失
- [ ] `labels` 换成中文后标记变中文
- [ ] 用户自己的 `--append-system-prompt` 内容不被覆盖（链式追加，非替换）

### M3 检测闭环（1 天）· **V1 核心**

**交付**：`detector.ts` + `enforcer.ts` + `ui.ts` + 单测；`/grounded why`

**验收**
- [ ] `detector.test.ts` 覆盖：citation 正则正例/反例、工具分类、判定表 3 种结论 —— 全绿
- [ ] `enforcer.test.ts` 覆盖：三档分派 + **防循环闸只放行一次** —— 全绿
- [ ] 端到端 · verified：问一个需要查源码的问题 → 模型查了并给出 `file:line` → 无警告
- [ ] 端到端 · speculative：问一个模型倾向于凭印象回答的问题 → 出现 ⚠️ 块
- [ ] 端到端 · unsourced：模型读了文件但没给行号 → 出现"未标注出处"提示
- [ ] `enforce` 档下触发回炉，且**同一个 prompt 绝不回炉第二次**
- [ ] `annotate` 替换 message 后：`/export` 正常、`/tree` 正常、`/resume` 后内容仍在（见 §8 R1）
- [ ] 寒暄（"好的"）不触发任何检查
- [ ] `/grounded why` 输出可读的判定依据

### M4 打包与发布（0.5 天）

**交付**：README（英文）、`package.json` 完善、会话级持久化、本地安装验证

**验收**
- [ ] `pi install /absolute/path/to/<repo>` 成功
- [ ] 安装后 `/grounded` 可用，`pi list` 能看到
- [ ] `/resume` 恢复会话后模式开关状态正确恢复（D4）
- [ ] README 包含 §1.4-N1 免责声明、配置说明、与 `pi-behavior-control` 的差异说明
- [ ] `pi remove` 干净卸载

---

## 7. 总验收标准

### 7.1 自动化（`npm test`，不需要 LLM）

| 模块 | 覆盖点 |
|---|---|
| `detector` | citation 正则正/反例 ≥ 20 条；工具分类；判定表全部 3 条路径；跳过条件 |
| `readonly` | 摘除/恢复幂等；不覆盖用户手动改动；shell 黑名单正/反例 ≥ 15 条 |
| `enforcer` | 三档分派；防循环闸；计数器重置时机 |

**门槛：全绿才算里程碑完成。**

### 7.2 人工端到端（需要真实 LLM，逐条勾）

见各里程碑验收清单。M3 的 5 条端到端是**验收核心**。

### 7.3 非功能

- [ ] 关闭状态下对 Pi 无任何可观测影响（不注入 prompt、不改工具、不注册状态）
- [ ] 任何检测/处置异常都不得中断会话（全部包 try/catch，失败降级为放行 + 一条 warning）
- [ ] 零额外 LLM 调用（G4）
- [ ] Windows 上工作正常（路径分隔符、Git Bash）

---

## 8. 风险与未决问题

| # | 风险 | 影响 | 应对 |
|---|---|---|---|
| **R1** | `message_end` 替换 message 可能影响会话存档 / `/export` / `/share` | `annotate` 档不可用 | **M3 必须实测**。若有问题，降级用 `appendEntry` + `registerEntryRenderer` 做 TUI-only 提示块 |
| **R2** | `enforce` 回炉造成死循环 | 烧 token、卡死 | 硬性防循环闸（§4.6），已写入验收 |
| **R3** | shell 黑名单误伤（如 `grep ">" file`） | 正常操作被拦 | 只匹配未被引号包裹的重定向符；黑名单可通过配置关闭；文档说明为 best-effort |
| **R4** | citation 正则误判（如把 `v1.2:30` 当路径） | 假阳性 verified | 要求扩展名在白名单内 + 单测覆盖反例 |
| **R5** | 目标版本 API 差异 | 需返工 | ✅ **已解除**：本机已升至 `0.85.1`，与仓库 HEAD 同版本，`docs/extensions.md` 与实际源码一致。`package.json` 声明 `"peerDependencies": { "@earendil-works/pi-coding-agent": ">=0.85.0" }` |
| **R6** | `setActiveTools` 与 `/tools`、`preset.ts` 等其它扩展冲突 | 工具集错乱 | 只做增量恢复（§4.2），不整体覆盖；文档说明已知冲突 |
| **R7** | 模型完全无视 prompt 里的三级标记格式 | 标记缺失，但检测仍有效 | 可接受。检测是主，格式是辅 |

### 未决问题（需 Kayce001 拍板）

- **Q1** §3 的 D1–D10 是否全部同意？特别是 **D1（摘掉写工具）** 和 **D9（不做纯 prompt 版）**
- **Q2** M4 是否真的要发布到 npm/GitHub？还是只做到"能本地 `pi install`"即可
- **Q3** 工期：M0–M4 合计约 3 天。是一次做完再验收，还是每个里程碑停下来给你看？
- **Q4** 是否需要中文 README（`README.zh-CN.md`）

---

## 9. 参考

- Pi Extensions 文档：`packages/coding-agent/docs/extensions.md`（earendil-works/pi）
- 相关官方示例：`pirate.ts`（命令 + prompt 注入）、`prompt-customizer.ts`（systemPromptOptions）、`todo.ts`（appendEntry 持久化）、`tools.ts`（setActiveTools）、`permission-gate.ts`（tool_call 拦截）、`plan-mode/`（综合）
- 对照项目：[`wbelk/pi-behavior-control`](https://github.com/wbelk/pi-behavior-control)
- Pi 内置工具全集：`read` `bash` `powershell` `edit` `write` `grep` `find` `ls`
