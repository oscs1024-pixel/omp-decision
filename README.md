# omp-decision

> v0.2.1 · OMP (Oh My Pi) Coding Agent 的决策、工具生命周期审查与策略控制层。

`omp-decision` 专为 OMP 编码智能体设计，作为 Agent 核心与工具调用之间的独立决策与安全审查总线。它不仅审查调用参数，还能在工具执行前后捕获真实文件系统快照，依据增量 Unified Diff 与围绕代码的自适应收缩上下文进行审计，配合确定性策略引擎（Policy Engine）与 TypeSafe Jev 语义模型，有效拦截危险命令、机密泄漏及违规变更，并生成 Agent 可直接执行的自修复诊断报告。

---

## 核心架构：五段式控制总线 (5-Stage Control Pipeline)

`omp-decision` 将工具生命周期治理深度收敛为清晰的五段式执行流水线：

```text
                  Agent 发起工具调用 (tool_call)
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Decision（语义预判与意图判决 - src/pipeline/decision-stage）│
│    • Jev System One 并发提问: decision (Choice) + hazard    │
│    • 评估调用合理性、潜在破坏类别与置信度                   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Policy（确定性策略与安全门禁 - src/pipeline/policy-gate） │
│    • 规则阶梯: Builtin Hard Deny > User Deny > Protected    │
│    • Shell Tokenizer 解构命令混淆 (环境变量/sudo/base64)    │
│    • 非对称梯级置信度门限 (Tiered Tool Thresholds)          │
│    • 裁决状态: proceed | confirm(ASK) | deny | stop         │
└──────────────────────────────┬──────────────────────────────┘
                               │ (proceed / confirmed)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Execute（物理事实捕获与宿主执行 - src/pipeline/execute）   │
│    • Canonical Path 校验 (fs.realpath 防软链接逃逸)         │
│    • 捕获 Pre-Snapshot (文件修改前真实内容)                 │
│    • OMP 宿主执行原生工具 (bash / edit / write)             │
│    • 捕获 Post-Snapshot (文件修改后真实内容)                │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Verify（物理状态与多维规约核验 - src/pipeline/verify）    │
│    • DiffEngine 提取真实增量 Diff + ±50行收缩上下文         │
│    • 挂载 .omp/rules/*.md Markdown 规则全文                 │
│    • Jev 并发探针 (leaks_credentials, breaks_rules 等)      │
│    • 注入结构化自修复诊断 (Diagnostic)                      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Trace / Eval（遥测、成本核算与评测 - src/pipeline/trace） │
│    • 遥测统计: 延迟、输入 Token 与微美金成本 ($0.042/Mtok)  │
│    • 异步持久化: Append-only JSONL (.omp/decision/audit)    │
│    • 离线评测: 黄金基准集 (fixtures/eval/cases.json)        │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心特性

### 1. Diff-aware 文件比对与收缩上下文
- **OMP 原生补丁兼容**：支持 `write` 全量写入、传统对象式 `edit` 以及 OMP 原生 `[src/auth.ts#A1B2]` Hashline 补丁语法与 `MV` 重命名识别，自动清洗行号选择器（如 `:50-100`、`:raw`）。
- **真实快照比对**：在文件操作前捕获 `before` 快照，操作后捕获 `after` 快照，抹平 CRLF/LF 换行符差异。
- **边界防御**：基于 `fs.realpath` 解析软链接，严禁任何逃逸工作区（`[workspace_boundary]`）的越界写操作。
- **自适应代码上下文**：围绕 Diff 变更行提取上下文（按 $\pm 100 \to \pm 50 \to \pm 20 \to \pm 10 \to \pm 3$ 行自适应收缩），兼顾类/函数外层语境与 `maxFileContextChars` 字符上限。

### 2. Policy Engine 与 Shell 防混淆
- **优先级分层**：内置硬拒绝 > 用户硬拒绝 > 受保护路径（强制确认） > 用户显式放行 > 安全快路径 > 语义审查。
- **Shell 混淆解构**：内置命令 Tokenizer，自动剥离环境变量前缀（如 `NODE_ENV=production rm -rf /`）、执行包装器（`sudo`、`env`、`nohup`、`time`、`sh -c`），并拦截 Base64 管道解码直通 Shell 的混淆变体（`base64 -d | sh`）。
- **受保护路径 (`protectedPaths`)**：针对 `.env*`、`.github/workflows/**`、`**/*.key` 等敏感资产的写操作强制弹出交互确认。

### 3. TypeSafe Jev 语义审查最佳实践
- **并发多维探针 (Parallel Probes)**：单次 Jev 调用中并行提问 `decision`、`severity` 以及多项正交判定（`leaks_credentials`、`command_injection`、`breaks_rules`），支持多维度问题并发告警。
- **核心探针优先覆盖**：一旦机密泄露或命令注入等严重违规探针触发，具备最高优先级，自动推翻模型的泛化 `pass` 判定。
- **非对称与分级置信度控制**：
  - **只读工具**（`read`, `glob`, `grep`, `lsp`）：放宽至 `0.50`；
  - **文件写入**（`edit`, `write`）：标准阈值 `0.65`；
  - **命令执行**（`bash`）：高线阈值 `0.75`；
  - **高危危害**：检测到机密泄露或命令注入时采用低门槛（`dangerDenyThreshold: 0.45`）拦截；
  - **极端低置信度**（$< 0.30$）：终止自动放行并降级。
- **SDK 网络弹性**：集成显式 `RetryPolicy`，自动重试吸收 429 频控与瞬态网络波动。
- **精准文件归因**：多文件变更时由 Jev 明确指出主要违规文件路径，在诊断中精准指引修复。

### 4. 两阶段工具与技能发现 (Progressive Discovery)
- **Stage 1（本地初筛）**：零延迟快速词法排序，筛选 Top 5 候选；
- **Stage 2（Jev 语义重排）**：由 Jev 对候选工具或技能进行意图判决与相关性重排；
- **TTL 缓存**：对 Discovery 查询结果维护 5 分钟内存 TTL 缓存，避免高频重复消耗 Token；
- **高置信动态激活**：`decision_find_tools` 找到高匹配度工具（$\ge 5$ 分）后，通过 `pi.setActiveTools()` 动态挂载到会话中。

### 5. 审计、成本核算与持久化
- 内存保留最近 1000 条审计记录；
- 按照 TypeSafe 官方定价（$42/Btok = $0.042/Mtok）精准折算微美金成本；
- 异步非阻塞追加写入当前工作区的 `.omp/decision/audit.jsonl`，保障事后安全回溯。

---

## 配置文件与规则

配置按照层级合并：`默认配置` $\to$ `~/.omp/decision/config.json` $\to$ `.omp/decision.json`（工作区优先）。

### 示例配置 (`.omp/decision.json`)

```json
{
  "enabled": true,
  "providers": {
    "jev": {
      "enabled": true,
      "model": "jev-latest",
      "allowThreshold": 0.65,
      "denyThreshold": 0.75,
      "dangerDenyThreshold": 0.45,
      "stopConfidence": 0.30,
      "toolThresholds": {
        "readonly": 0.50,
        "mutation": 0.65,
        "execution": 0.75
      }
    }
  },
  "policy": {
    "enabled": true,
    "builtinRules": true,
    "protectedPaths": [
      ".github/workflows/**",
      ".env*",
      "**/*.pem",
      "**/*.key",
      ".ssh/**"
    ],
    "rules": [
      {
        "id": "deny-publish",
        "enabled": true,
        "tools": ["bash"],
        "action": "deny",
        "reason": "禁止在会话中直接发布包",
        "commandPattern": "(?:npm|pnpm|yarn)\\s+publish"
      }
    ]
  },
  "review": {
    "enabled": true,
    "maxFileContextChars": 16000,
    "maxPayloadChars": 24000,
    "defaultTimeoutMs": 8000,
    "reviewers": [
      {
        "id": "shell-safety",
        "name": "Shell 安全审查",
        "enabled": true,
        "tools": ["bash"],
        "trigger": "before",
        "provider": "jev",
        "failureMode": "closed",
        "timeoutMs": 5000
      },
      {
        "id": "code-security",
        "name": "代码安全审查",
        "enabled": true,
        "tools": ["edit", "write"],
        "trigger": "after",
        "provider": "jev",
        "failureMode": "open",
        "filePatterns": [
          "src/**/*.ts",
          "src/**/*.js"
        ],
        "excludePatterns": [
          "**/*.test.ts"
        ],
        "rulesFiles": [
          ".omp/rules/security.md"
        ],
        "timeoutMs": 8000
      }
    ]
  }
}
```

### 项目 Markdown 规则文件

在工作区放置 `.omp/rules/security.md`：
```markdown
# Security rules

## Secrets
禁止在日志或文件中打印 API 密钥、Access Token、数据库密码或私钥。

## Shell Execution
禁止将未经校验的外部输入直接拼接进 Shell 命令执行。
```
当 Reviewer 配置了 `rulesFiles` 时，上述规范将自动注入到 Jev 的判定上下文，确保审查贴合项目规范。

---

## 交互命令 (Slash Commands)

在 OMP 对话中可通过以下命令实时检查与管理（支持 Tab 补全）：

| 命令 | 说明 |
| :--- | :--- |
| `/decision status` | 显示运行状态、Token 消耗、微美金成本及警告信息 |
| `/decision on` / `/decision off` | 在当前会话中启用或停用决策控制 |
| `/decision review` | 列出所有已配置的 Reviewer 及其触发时机、工具与失败模式 |
| `/decision review on` / `off` | 单独开启或暂停工具审查功能 |
| `/decision config` | 输出当前生效的 JSON 完整配置 |
| `/decision test` | 深度诊断：检查 API 密钥、检测缺失规则文件及连通性 |
| `/decision log [limit]` | 查看最近审计记录，顶部汇总展示总 Token 与费用 |
| `/decision inspect <id>` | 查看指定审计条目的完整遥测与 Diff（支持 Tab 补全近期 ID） |

---

## Agent 工具 (Discovery Tools)

- `decision_find_tools`：根据自然语言任务能力描述检索可用 OMP 工具，两阶段打分并自动激活；
- `decision_find_skill`：检索项目及用户全局的 `SKILL.md` 知识库（覆盖 `.omp/skills`、`skills`、`~/.omp/agent/skills` 等目录）。

---

## 安装与加载

### 一键安装到 OMP
```sh
omp install /path/to/omp-decision
```
安装后运行 `omp plugin doctor` 即可验证插件健康度。

---

## 开发与验证

项目使用 Node 22 + TypeScript 严格模式（开启 `exactOptionalPropertyTypes`）。

```sh
# 安装依赖
npm install

# 静态类型检查与测试全量运行
npm run check

# 仅运行测试（包含 10 个场景的离线黄金评测基准）
npm test
```

测试集使用 Stub 与 FakeProvider 完全隔离外部网络，CI 构建完全不依赖在线 Jev 服务。
