# pi-grounded 实测记录

> **用途**：存放**原始数据**，不是结论。所有度量结果都从这里来。
>
> **原则**：每条记录都带原题和回答摘录，**你可以随机抽一题自己重问一遍做交叉验证**（见 `VERIFY.md` §3.3）。只有结论没有原始数据的记录 = 无法验证 = 无效。

**状态**：🟡 模板已建，数据待填 · 最后更新 2026-09-10

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
> **n=12 只够发现明显差异，不足以支撑细微判断** —— 任何依赖它的决策都要记住这一点。

### 2.1 题目清单

全部关于 Pi 自身源码（`earendil-works/pi` @ 0.85.1），覆盖三类。**提问时工作目录必须是 pi 仓库根。**

| # | 类别 | 题目 |
|---|---|---|
| Q1 | 架构 | Harness、Lane、Session、Branch 之间是什么关系？ |
| Q2 | 架构 | Extension 是怎么被发现和加载的？加载顺序是什么？ |
| Q3 | 架构 | chord 的 facet 和 coding-agent 的 extension 有什么区别？ |
| Q4 | 架构 | 会话数据在内存里和落盘时分别是什么结构？ |
| Q5 | 实现 | `before_agent_start` 的 systemPrompt 链式修改是怎么实现的？多个扩展同时改会怎样？ |
| Q6 | 实现 | compaction 的触发条件是什么？阈值在哪里定义？ |
| Q7 | 实现 | `setActiveTools` 调用后，工具变更是在哪一步生效的？ |
| Q8 | 实现 | jiti 是怎么被用来加载 TypeScript 扩展的？为什么不需要预编译？ |
| Q9 | 实现 | session 文件用什么格式？存在哪个目录、怎么组织？ |
| Q10 | 边界 | 扩展的 factory 函数抛异常时，pi 会怎么处理？会不会导致启动失败？ |
| Q11 | 边界 | `message_end` 返回替换 message 时，如果 role 和原来不一致会发生什么？ |
| Q12 | 边界 | 项目未被 trust 时，`.pi/extensions/` 里的扩展会被加载吗？ |

> Q11 与 S0 直接相关，可以互相印证。

### 2.2 A 组 · 基线（`/grounded off`）

| # | 有引用? | 引用数 | 有效数 | 备注 |
|---|:---:|:---:|:---:|---|
| Q1 | ⬜ | | | |
| Q2 | ⬜ | | | |
| Q3 | ⬜ | | | |
| Q4 | ⬜ | | | |
| Q5 | ⬜ | | | |
| Q6 | ⬜ | | | |
| Q7 | ⬜ | | | |
| Q8 | ⬜ | | | |
| Q9 | ⬜ | | | |
| Q10 | ⬜ | | | |
| Q11 | ⬜ | | | |
| Q12 | ⬜ | | | |

> A 组插件是关闭的，"有效数"需**人工核对**（插件不工作，没有自动判定）。

### 2.3 B 组 · 开启（`/grounded on`）

| # | 有引用? | 引用数 | 插件判定 | 人工核对 | 一致? | 备注 |
|---|:---:|:---:|---|---|:---:|---|
| Q1 | ⬜ | | | | | |
| Q2 | ⬜ | | | | | |
| Q3 | ⬜ | | | | | |
| Q4 | ⬜ | | | | | |
| Q5 | ⬜ | | | | | |
| Q6 | ⬜ | | | | | |
| Q7 | ⬜ | | | | | |
| Q8 | ⬜ | | | | | |
| Q9 | ⬜ | | | | | |
| Q10 | ⬜ | | | | | |
| Q11 | ⬜ | | | | | |
| Q12 | ⬜ | | | | | |

**判定取值**：`verified` / `no-citation` / `invalid`

### 2.4 回答摘录

> 每题记录**足以交叉验证的片段**，不是全文。至少包含：模型给出的引用、以及有争议的结论句。

<details>
<summary>Q1</summary>

**A 组**：
```
（待填）
```

**B 组**：
```
（待填）
```
</details>

<!-- Q2–Q12 同结构，实测时补齐 -->

---

## 3. 独立核对（破循环论证）

> PLAN §2.4。O-2 是用插件自己的校验结果评价插件，存在循环论证，必须人工破。

从 B 组结果中**随机抽 10 处引用**，人工打开文件核对，与插件判定比对。

| # | 引用 | 插件判定 | 人工核对 | 一致? |
|---|---|---|---|:---:|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
| 7 | | | | |
| 8 | | | | |
| 9 | | | | |
| 10 | | | | |

**任何一条不一致 → 正则或路径解析有 bug → 属 T-1 失败，必须修完重测。**

---

## 4. 指标汇总

### 4.1 观测指标（只记录，不卡关）

| | A 组（基线） | B 组（开启） | 差值 |
|---|:---:|:---:|:---:|
| **O-1 引用密度** | ⬜ | ⬜ | ⬜ |
| **O-2 引用有效率** | ⬜ | ⬜ | ⬜ |
| **O-3 幻觉捕获数** | — | ⬜ | — |

> **O-1 看的是 B 相对 A 的提升幅度，不是绝对值。** 没有 A 组就无法归因。

### 4.2 硬门槛（必须达标）

| | 门槛 | 实际值 | 是否达标 |
|---|---|:---:|:---:|
| **T-1** | 误报率 = 0 | ⬜ | ⬜ |
| **T-2** | 无会话中断/崩溃/功能失效 | ⬜ | ⬜ |
| **T-3** | B 组 `no-citation` 轮次 < 30% | ⬜ | ⬜ |

### 4.3 Kill criteria 触发判断

- [ ] **K2**：O-3 = 0？ → 若是，**不立即降级**，进入 1 周日常使用观察期
- [ ] **K3**：T-1 无法降到 0？ → 若是，停手
- [ ] **K4**：T-3 不达标且 prompt 迭代 3 轮无改善？ → 若是，停手

---

## 5. Prompt 迭代记录

> 仅在 T-3 不达标时启动。**每轮只改一处**，最多 3 轮（PLAN §10 迭代规则）。

| 轮次 | 改了什么 | 改动后 `no-citation` 比例 | 结论 |
|---|---|---|---|
| 基线（§10 草稿） | — | ⬜ | |
| 1 | | | |
| 2 | | | |
| 3 | | | |

超过 3 轮仍不达标 → 触发 **K4**。

---

## 6. 开发过程中的意外发现

> 实现过程中发现的、PLAN 里没预料到的事情。**这一节是给未来的自己和你看的**，不要事后补写成"一切顺利"。

（待填）
