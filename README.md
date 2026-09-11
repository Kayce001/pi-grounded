# pi-grounded

**Ground Pi's answers in the codebase, not assumptions.**

> [!WARNING]
> **Experimental.** This is my first Pi extension, written while learning how Pi's
> extension API works. It does what the README says and the tests back that up, but
> it has been used by one person on one machine for a matter of days. Expect rough
> edges, and read [Status and limitations](#status-and-limitations) before relying
> on it for anything that matters.

A [Pi](https://github.com/earendil-works/pi) extension for *reading* unfamiliar code. It does two things:

1. **Read-only research mode** — `edit` and `write` are removed from the tool set, so the agent can look but not touch.
2. **Citation verification** — every `file:line` reference the model produces is checked against the filesystem. References to files that do not exist, or to line numbers past the end of the file, are shown to you.

The second one is the point. Asking a model to cite its sources is easy; knowing whether it made the citation up is not.

```
> /grounded on
  ✓ grounded on · 只读模式
  ✓ 已禁用工具: edit, write

> How does compaction get triggered?

  Pi 的 compaction 有两种触发方式：
  - 手动触发：`/compact` … packages/coding-agent/src/modes/interactive/interactive-mode.ts:3068
  - 自动触发：默认开启，超过 contextWindow - reserveTokens 时触发
    packages/coding-agent/src/core/compaction/compaction.ts:233
  …

  🔍 grounded · ✓ 5 处引用已校验
```

And when it invents one:

```
  ─────────────────────────────────────
  ⚠️ 1 处引用无效
    packages/agent/src/types.ts:9999 → 文件仅 446 行，行号越界
  ─────────────────────────────────────
```

## Install

```bash
pi install git:github.com/Kayce001/pi-grounded
```

Or point at a local clone:

```bash
pi install /absolute/path/to/pi-grounded
```

Or try it for one run without installing:

```bash
pi -e /absolute/path/to/pi-grounded/src/index.ts
```

## Usage

| Command | What it does |
|---|---|
| `/grounded` | Toggle the mode |
| `/grounded on` / `off` | Set it explicitly |
| `/grounded status` | Current state, disabled tools, session tally, resolution roots |
| `/grounded check <text>` | Run the verifier over any text, with no model call |
| `/source …` | Alias for `/grounded` |
| `pi --grounded` | Start with the mode on |

`/grounded check` is useful on its own: paste a chunk of documentation, a code review comment, or an answer from somewhere else, and it will tell you which references are real.

## What you see

| Verdict | When | Shown as |
|---|---|---|
| verified | Every reference resolves and is in range | Footer tick only — no interruption |
| invalid | At least one reference is bogus | A block listing each bad reference and why |
| no-citation | A substantial answer with no `file:line` at all | A block saying so |

Answers under 200 characters are skipped entirely, so "好的" never collects a warning.

## What this is *not*

**This is not a sandbox.** Pi has no permission system of its own — by design, it runs with the permissions of whoever launched it. This extension removes two tools from the model's menu. It does not stop `bash`, it does not stop a determined model, and it does not stop anything malicious. If you need a real boundary, containerize Pi ([containerization docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md)).

It also does not check whether a citation *supports* the claim attached to it — only that the file and line exist. A real reference to an irrelevant line still passes.

## Configuration

There is no config file. Everything tunable lives in [`src/config.ts`](src/config.ts) — edit a constant and run `/reload`:

| Constant | Default | Meaning |
|---|---|---|
| `WRITE_TOOLS` | `["edit", "write"]` | Tools disabled while the mode is on |
| `MIN_ANSWER_LENGTH` | `200` | Answers shorter than this are not checked |
| `CODE_EXTENSIONS` | ~35 extensions | What counts as a source path |
| `LABELS` | `[推断]` / `[不确定]` | Markers the model is asked to use |

To switch the interface language, edit `LABELS` in `src/config.ts` and the prompt text in [`src/prompt.ts`](src/prompt.ts).

## How it works

| Hook | Role |
|---|---|
| `before_agent_start` | Appends the grounding block to the system prompt |
| `message_end` | Collects assistant text — **no side effects** |
| `agent_settled` | Judges the run and appends the note |
| `registerEntryRenderer` | Renders the note as a custom entry |

The note is a **custom entry**, not part of the assistant message. That matters: custom entries do not participate in LLM context, so the warnings are never fed back to the model. An earlier design appended to the message itself and was rejected for exactly this reason — see `NOTES.md` §1.3.

Paths are resolved against the working directory first, then the git repository root, so repo-relative references work from a subdirectory. A file that cannot be measured (too large, unreadable) is **accepted**, never reported as invalid — a false alarm is worse than a missed one.

## Status and limitations

Read this before relying on it.

### What has been verified

| | |
|---|---|
| Unit tests | 74, all passing. Confirmed non-decorative by mutation testing — breaking the line-range check turns 6 of them red |
| Citation verification | All four verdict paths exercised end to end against a real repository |
| False positives | Zero observed. 117 citations across 7 real answers, plus an independent spot check of 10 using `test -f` and `wc -l` rather than this project's own code |
| Read-only mode | Confirmed with a control run: without the mode the model calls `write` and modifies the file; with it there are no tool calls at all |

### What has not

`/reload` hot-reloading, how the note looks in `/tree`, and `/share`. All three need a TUI session that has not happened yet.

### Measurement is incomplete

The A/B baseline was cut short when the provider quota ran out: **2 of 12** answers without the mode, **7 of 12** with it. The difference is stark — 0% of baseline answers carried a `file:line`, against 100% with the mode on, and tool calls per answer roughly doubled — but **n=2 and n=7 cannot support anything finer than that**.

More importantly: across those 117 citations the model did not fabricate a single line number, so **the verification layer has yet to catch anything**. It may be that being told its references are checked is what keeps them honest, in which case the layer earns its place by deterrence rather than by detection. That is not falsifiable from here, and it is an open question about this project rather than a settled result.

### Known issues

1. **A general-knowledge question still collects a `no-citation` warning** while the mode is on, if the answer is long enough. Deliberate: any attempt to auto-detect "is this a question about the codebase" would introduce a second unreliable judgement. Turn the mode off for those.
2. **References outside the working directory and the git root** are reported as not found.
3. **Verification checks that a reference exists, not that it supports the claim** attached to it. A real line cited for the wrong reason still passes.
4. **When the extension is not loaded, the model can impersonate it.** Running `pi` bare in a directory containing this repository and typing `/grounded` is not a registered command, so pi passes it to the model — which, having read the source, will happily perform the plugin's output, complete with a plausible session tally. This is not fixable from inside the extension. The reliable tells are the `🔍 grounded` footer badge, the startup extensions list, and the rendered block; plain text output can be faked.

## Compared to `pi-behavior-control`

[`wbelk/pi-behavior-control`](https://github.com/wbelk/pi-behavior-control) covers a broader set of agent behaviors — read-before-edit, post-edit review, speculation verification — and uses a separate verifier model to scan responses.

`pi-grounded` is narrower and cheaper. It is about *reading* code rather than changing it, and its verification is deterministic filesystem checking, so it adds **zero tokens and zero model calls**. If you want a full coding-safety harness, use theirs. If you want to stop being told plausible things about a codebase you are trying to learn, use this.

## Development

```bash
npm install
npm test          # 74 unit tests, no LLM required
npm run typecheck
```

The logic lives in `citations.ts`, `tools.ts` and `probe.ts`, none of which import `ExtensionAPI`; `index.ts` is the only module with side effects. That split is what makes the test suite meaningful.

To check the tests are not decorative, break one branch on purpose:

```bash
# in src/citations.ts change `highest > lineCount` to `false`
npm test    # should turn red
```

See [`PLAN.md`](PLAN.md) for the design and its rationale, [`VERIFY.md`](VERIFY.md) for how to confirm any of this yourself, and [`NOTES.md`](NOTES.md) for the measurements.

## License

MIT
