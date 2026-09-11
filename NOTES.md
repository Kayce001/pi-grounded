# pi-grounded 实测记录

> **用途**：存放**原始数据**，不是结论。所有度量结果都从这里来。
>
> **原则**：每条记录都带原题和回答摘录，**你可以随机抽一题自己重问一遍做交叉验证**（见 `VERIFY.md` §3.3）。只有结论没有原始数据的记录 = 无法验证 = 无效。

**状态**：🟢 交互式验收通过（§8）· 基线因配额耗尽未跑完（A 2/12, B 7/12）· 最后更新 2026-09-11

---

## 1. S0 Spike 结果

> `message_end` 返回替换 message 是否会破坏会话功能。决定 PLAN §5.5 走首选还是降级方案。

**完成时间**：2026-09-10 · **成本**：约 $0.033（7 次真实模型调用）

**测试方法**：`pi` 的非交互模式（`-p` + `--mode json` + `--session-dir` 隔离），三个临时扩展做对照。
临时文件位于 scratchpad `spike/`，不入库。

### 1.1 三个对照组

| Spike | 做法 | 结果 |
|---|---|---|
| **A** `spike-append.ts` | `message_end` 返回替换后的 message，content 数组追加一个 text 块 | 功能正常，**但注释进了 LLM 上下文** |
| **B** `spike-entry.ts` | `message_end` 里调 `appendEntry` | 不进上下文，**但 entry 落在 assistant 消息之前** |
| **C** `spike-settled.ts` | `message_end` 只扫描，`agent_settled` 里 `appendEntry` | ✅ **全部正确** |

### 1.2 四项功能验证

| 功能 | 方案 A | 方案 C | 说明 |
|---|:---:|:---:|---|
| 会话文件完整性 | ✅ | ✅ | JSONL 结构正常，内容持久化 |
| `--session` 恢复 | ✅ | ✅ | provider 接受修改后的历史；A 中原文本块 `textSignature` 未被破坏（因为是追加新块而非改写） |
| `--export` HTML | ✅ | ✅ | 内容以 base64 嵌在 `__DATA__`，解码后确认保留 |
| `/tree` | ⚠️ | ⚠️ | **纯 TUI，未自动验证**。会话文件的 parent 链正常，推断渲染无问题，但这是**推断不是事实** |
| `/share` | ⏭️ | ⏭️ | **未测** —— 会往用户 GitHub 发 gist，属外部发布行为，不为验收去做 |

### 1.3 决定性发现

**① `message_end` 替换消息 → 注释会进入 LLM 上下文**

对照实验：同样的提问格式

```
"Does any earlier assistant message contain the literal string X? Answer only YES or NO."
```

- 方案 A（替换 message）→ 模型答 **YES**
- 方案 C（appendEntry）→ 模型答 **NO**

这意味着方案 A 下，每轮警告块都会被送回模型。三重坏处：浪费 token、模型可能模仿格式或对警告作出反应、污染对话。**而注释本来就是给用户看的，不该进模型上下文。**

pi 文档对此有明确说法：
> *"Custom entries do NOT participate in LLM context."*
> *"For durable TUI-only content that should not be sent to the LLM, use `pi.appendEntry()` with `pi.registerEntryRenderer()`."*

**所以 PLAN 里所谓的"降级方案"其实才是正确方案** —— 文档字面描述的就是这个用例。不是 `message_end` 坏了，是它语义上不适合放注释。

**② `appendEntry` 不能在 `message_end` 里调用**

`message_end` 处理器在消息入库前执行，此时 append 的 entry 会挂到**用户消息**下面：

```
message  role=user   text='Reply with exactly: WORLD'
custom   >>> spike-note              ← 错误：落在回答之前
message  role=assistant text='WORLD'
```

改到 `agent_settled` 后正确：

```
message  role=user      text='Reply with exactly: ORDER'
message  role=assistant text='ORDER'
custom   >>> spike-note              ← 正确
```

**结论**：`message_end` 只做扫描（无副作用），`agent_settled` 做提交。这个拆分顺带带来一个好处：多轮工具调用的 run 只在最后标注一次，而不是每个中间轮次都标。

### 1.4 采用方案

- [x] **`appendEntry` + `registerEntryRenderer`，在 `agent_settled` 提交**
- [ ] ~~`message_end` 替换 message~~ —— 因污染 LLM 上下文而否决

> 已同步写回 `PLAN.md` §5.5 / §6.1。

### 1.5 附带发现

- `@earendil-works/pi-tui` 对独立 `-e` 加载的扩展可正常解析，不需要 `node_modules`
- `pi --export <file>` 的参数是**输入的会话文件**，不是输出路径；产物落在 cwd，命名 `pi-session-<原名>.html`
- 导出 HTML 把会话数据 base64 编码进 `__DATA__`，用 `atob` 解 —— 直接 grep 原文搜不到，验证时必须先解码
- `--session-dir` 可以完全隔离测试会话，不污染用户真实历史

---

## 2. 基线 A/B 实测

> PLAN §2.1。同样 12 题，A 组关闭插件、B 组开启插件，各开一个新会话。

### 2.0 ⚠️ 实测未跑完 —— 配额耗尽

**A 组 2/12，B 组 7/12 后中断。** 原因：

```
Codex error: The usage limit has been reached
```

`openai-codex` 订阅配额在跑到一半时用尽（详见 §5 成本）。剩余题目返回空回答、零工具调用、零成本。**本节所有数字都建立在这个残缺样本上，解读时必须记住。**

已完成：A = q01, q09；B = q01–q07。

### 2.1 题目清单

全部关于 Pi 自身源码（`earendil-works/pi` @ 0.85.1），覆盖三类。提问时工作目录为 pi 仓库根。

| # | 类别 | 题目 | A | B |
|---|---|---|:---:|:---:|
| Q1 | 架构 | Harness、Lane、Session、Branch 之间是什么关系？ | ✅ | ✅ |
| Q2 | 架构 | Extension 是怎么被发现和加载的？加载顺序是什么？ | ❌ | ✅ |
| Q3 | 架构 | chord 的 facet 和 coding-agent 的 extension 有什么区别？ | ❌ | ✅ |
| Q4 | 架构 | 会话数据在内存里和落盘时分别是什么结构？ | ❌ | ✅ |
| Q5 | 实现 | `before_agent_start` 的 systemPrompt 链式修改是怎么实现的？ | ❌ | ✅ |
| Q6 | 实现 | compaction 的触发条件是什么？阈值在哪里定义？ | ❌ | ✅ |
| Q7 | 实现 | `setActiveTools` 调用后，工具变更在哪一步生效？ | ❌ | ✅ |
| Q8 | 实现 | jiti 怎么加载 TypeScript 扩展？为什么不需要预编译？ | ❌ | ❌ |
| Q9 | 实现 | session 文件用什么格式？存在哪个目录、怎么组织？ | ✅ | ❌ |
| Q10 | 边界 | 扩展 factory 抛异常时 pi 怎么处理？ | ❌ | ❌ |
| Q11 | 边界 | `message_end` 替换 message 时 role 不一致会怎样？ | ❌ | ❌ |
| Q12 | 边界 | 项目未 trust 时 `.pi/extensions/` 会被加载吗？ | ❌ | ❌ |

### 2.2 A 组 · 基线（`/grounded off`，n=2）

| 题 | 回答长度 | 工具调用 | 引用数 | 有效 | 无效 | 判定 |
|---|---:|---:|---:|---:|---:|---|
| q01 | 1022 | 14 | **0** | 0 | 0 | no-citation |
| q09 | 1419 | 5 | **0** | 0 | 0 | no-citation |

### 2.3 B 组 · 开启（`/grounded on`，n=7）

| 题 | 回答长度 | 工具调用 | 引用数 | 有效 | 无效 | 插件判定 | 复算判定 |
|---|---:|---:|---:|---:|---:|---|---|
| q01 | 1461 | 10 | 7 | 7 | 0 | verified | verified |
| q02 | 3809 | 37 | 32 | 32 | 0 | verified | verified |
| q03 | 2504 | 28 | 26 | 26 | 0 | verified | verified |
| q04 | 2754 | 20 | 15 | 15 | 0 | verified | verified |
| q05 | 1830 | 22 | 16 | 16 | 0 | verified | verified |
| q06 | 1316 | 12 | 11 | 11 | 0 | verified | verified |
| q07 | 810 | 18 | 10 | 10 | 0 | verified | verified |

**插件的实时判定与事后复算 7/7 完全一致。**

---

## 3. 独立核对（破循环论证）

PLAN §2.4。O-2 是用插件自己的校验结果评价插件，必须人工破。

方法：从 B 组 117 处引用中等距抽 10 处，用 **`test -f` 和 `wc -l`**（与插件代码无关的工具）逐条核对。

| # | 引用 | 文件存在 | 实际行数 | 引用行号 | 人工判定 | 与插件一致 |
|---|---|:---:|---:|---:|---|:---:|
| 1 | `packages/agent/docs/harness.md:25` | 是 | 1468 | 25 | 有效 | ✅ |
| 2 | `packages/coding-agent/src/core/package-manager.ts:2460` | 是 | 2699 | 2460 | 有效 | ✅ |
| 3 | `packages/coding-agent/src/core/package-manager.ts:176` | 是 | 2699 | 176 | 有效 | ✅ |
| 4 | `packages/coding-agent/src/core/agent-session.ts:2818` | 是 | 3552 | 2818 | 有效 | ✅ |
| 5 | `packages/coding-agent/src/core/extensions/loader.ts:548` | 是 | 809 | 548 | 有效 | ✅ |
| 6 | `packages/coding-agent/src/core/extensions/types.ts:1259` | 是 | 1797 | 1259 | 有效 | ✅ |
| 7 | `packages/coding-agent/src/core/session-manager.ts:25` | 是 | 1746 | 25 | 有效 | ✅ |
| 8 | `packages/coding-agent/src/core/session-manager.ts:993` | 是 | 1746 | 993 | 有效 | ✅ |
| 9 | `packages/coding-agent/docs/extensions.md:565` | 是 | 3029 | 565 | 有效 | ✅ |
| 10 | `packages/coding-agent/src/core/agent-session.ts:2180` | 是 | 3552 | 2180 | 有效 | ✅ |

**10/10 一致。T-1 在本样本上确认通过。**

> 复现命令见 `.analysis/spotcheck.txt`（未入库）与 `VERIFY.md` §2 M1 一节。

---

## 4. 指标汇总

### 4.1 观测指标

| | A 组（n=2） | B 组（n=7） | 差值 |
|---|:---:|:---:|:---:|
| **O-1 引用密度** | **0%** (0/2) | **100%** (7/7) | **+100 个百分点** |
| **O-1 平均引用数** | 0.0 | **16.7** | +16.7 |
| **O-2 引用有效率** | n/a（无引用） | **100%** (117/117) | — |
| **O-3 幻觉捕获数** | — | **0** | — |
| 平均工具调用 | 9.5 | **21.0** | +11.5 |

**怎么读这些数字：**

- **O-1 的差异极其显著**：基线组两题都做了大量源码查阅（14 次和 5 次工具调用），**却一处 `file:line` 都没给**。开启后 7 题全部给出引用，平均每题 16.7 处。样本虽小，但 0 vs 16.7 不是噪声能解释的。
- **工具调用翻倍**（9.5 → 21.0）：模式不只是让模型"标注出处"，而是真的让它**读得更多**。
- **O-2 = 100%**：117 处引用，模型一个行号都没编。
- **O-3 = 0**：**校验层一次都没抓到东西。** 见 §4.3。

### 4.2 硬门槛

| | 门槛 | 实际 | 结论 |
|---|---|---|:---:|
| **T-1** | 误报率 = 0 | 117 处引用零误报；独立抽检 10/10 一致 | ✅ 通过 |
| **T-2** | 无会话中断/崩溃/功能失效 | 全程无崩溃；配额耗尽是外部原因，非插件所致 | ✅ 通过 |
| **T-3** | B 组 `no-citation` < 30% | **0%** (0/7) | ✅ 通过 |

### 4.3 Kill criteria 判断

- [x] **K2 触发**：O-3 = 0，校验层一次幻觉都没抓到。
      **按 PLAN 不立即降级** —— n=7 远不足以支撑推翻核心设计的决定。进入 **1 周日常使用观察期**。
      需要注意的是：这次的 O-2 = 100% 本身可能就是 prompt 第 3 条（"你给的引用会被机器校验"）起了作用 —— **如果是这样，校验层的价值恰恰体现在它的威慑上，而不是它抓到了多少**。这个假设目前无法证伪，也记在这里。
- [ ] K3（T-1 无法归零）：未触发
- [ ] K4（T-3 不达标）：未触发

---

## 5. 成本

pi 报告的 cost 是按 token 单价折算的**估算值**，`openai-codex` 是订阅制，实际计费方式不同。

| 阶段 | 估算成本 |
|---|---:|
| S0 Spike（7 次调用） | $0.03 |
| 开发期端到端测试（约 10 次） | ~$0.6 |
| 首次基线（stdin bug，各只跑了 q01） | ~$1.0 |
| 基线 A 组（2 题有效） | $0.84 |
| 基线 B 组（7 题有效 + q08 中断） | $3.79 |
| **合计** | **约 $6.3** |

**教训**：我早期用一次 trivial 调用（$0.0058）估成本，严重低估。真实的代码研究类问题每题 $0.2–1.0，B 组 q02 单题就 $1.00（37 次工具调用）。**配额是被这类重问题吃掉的。**

---

## 6. Prompt 迭代记录

T-3 一次就达标（0%），未触发迭代流程。但开发过程中因**其它原因**改过两次：

| 轮次 | 改了什么 | 为什么 |
|---|---|---|
| 1 | 新增第 7 条"规则只管你自己的论断" | 模型拒绝重排一段含未查证引用的用户笔记，理由是"处于 Source-Grounded Mode"。这种过度拒绝在真实使用中很烦（比如粘一段堆栈让它重排版），也挡住了 VERIFY.md 原来的测试方式 |
| 2 | 第 1 条改为"`read`，或 `grep`/`find` 若已启用，否则用 `bash` 里的 grep/rg" | 实测发现 pi 默认激活的工具只有 `read, bash, edit, write` —— `grep`/`find` **默认不在**，原措辞点名了不存在的工具 |

---

## 7. 开发过程中的意外发现

1. **pi 默认只激活 4 个工具**（`read, bash, edit, write`），不是文档里列出的 8 个内置工具全集。`grep`/`find`/`ls`/`powershell` 要显式配置 `defaultTools` 才有。
2. **`pi` 会读 stdin** —— 写在 `while read` 循环里会把剩余输入全吃掉。批量脚本必须给它 `< /dev/null`。这个 bug 让第一次基线只跑了 1 题。
3. **Windows 上 Python 默认用 GBK 写 stdout**，中文 JSON 直接损坏。脚本里要 `sys.stdout.reconfigure(encoding="utf-8")`。
4. **`pi --export` 的参数是输入的会话文件**，不是输出路径；产物落在 cwd。
5. **导出的 HTML 把会话数据 base64 编码进 `__DATA__`**，直接 grep 原文搜不到。
6. **`pi remove -l` 需要 `--approve`**（项目未受信任时无法改本地包配置）。
7. **Node 24 原生支持 TypeScript**，`node script.ts` 直接能跑，不需要 tsx —— 但跨盘符的绝对路径 import 会因 ESM URL scheme 报错。

---

## 8. 交互式验收（2026-09-11，在真实 TUI 中执行）

交付时有 8 条未验证假设，全部因为无头模式无法派发斜杠命令、UI 方法是 no-op。本节是补上的结果。

### 8.1 结果

| 项 | 结果 |
|---|---|
| 单测（`npm test`） | ✅ 74 passed |
| Mutation test（`highest > lineCount` → `false`） | ✅ **6 个变红**（68 passed / 6 failed）—— 交付时文档写的"4 个"是加 `probe.test.ts` 之前的旧数字，已更正 |
| 提示块渲染 | ✅ 警告色标题 + 缩进明细行，位置在回答下方 |
| `/grounded` `on`/`off`/`status`/`check`/`demo` | ✅ 全部工作 |
| `disable()` 恢复 `edit`/`write` | ✅ |
| footer `🔍 grounded` | ✅ |
| **`agent_settled` 里 `appendEntry` 的绘制时机** | ✅ **正常，无延迟** |
| 真实回合的 T-1 复检 | ✅ **零误报** |

### 8.2 真实回合的 T-1 复检

题目：让模型重排一段含三处引用的用户笔记（工作目录为 pi 仓库根）。

| 引用 | 文件实际行数 | 插件判定 |
|---|---:|---|
| `packages/agent/src/types.ts:9999` | 446 | ⚠️ 标出：`文件仅 446 行，行号越界` |
| `packages/coding-agent/docs/extensions.md:120` | 3033 | 安静通过 |
| `packages/agent/src/proxy.ts:5` | 402 | 安静通过 |

**只标该标的那一处。** 这是 T-1 在真实路径上的一次实检。

### 8.3 🔴 事故：模型冒充了插件的输出

**经过**：在**本仓库源码所在目录**裸跑 pi（忘了 `-e`），敲 `/grounded`。pi 不认识这个命令，当作普通消息发给模型。模型先 `read` 了 `src/index.ts` 和 README，然后输出：

```
✓ grounded on · 只读模式
✓ 已禁用工具：edit, write
```

随后 `/grounded status` 又得到：

```
grounded: on
已禁用工具: edit, write
本会话统计 — 已校验 0 · 无效 1 · 无出处 1
解析根目录: <本仓库路径>
```

**全部是编的。** 会话文件里没有任何 `custom` entry，证明 `appendEntry` 从未被调用。

**影响**：骗过了用户和 Claude 两个回合。Claude 据此写了一份错误的 bug 诊断（"`agent_settled` 时机太晚"），后来查会话文件才发现真相。

**为什么特别值得记**：一个专门用来防止模型编造的插件，其输出本身被模型编造了 —— 而且编得足够像，连带具体数字的统计行都有。

**分辨方法**（已写入 `VERIFY.md` 第 0 步）：footer 的 `🔍 grounded`、启动头部的 extensions 列表、带背景色的提示块 —— 这三样模型伪造不了；纯文本的 `notify` 输出可以。

**修不了**：这是 pi 处理未识别斜杠命令的行为，不在插件可控范围内。只能靠文档提醒。

### 8.4 仍未验证

- `/reload` 热重载
- `/tree` 中 custom entry 的显示
- `/share`（不测 —— 外部发布行为）
- **用一周之后烦不烦** —— K2 判断所需
