---
name: phocinae
description: 斑海豹（Phocinae-Largha-150M-v1）本地决策模型 skill。把批量判断题、选择题、打分题、审批预判等「快决策」交给本地斑海豹服务一次性判定。适合需要快速、稳定、可阈值化、可审计的结构化判定；不可用于文本生成。
---

# phocinae —— 斑海豹本地决策 skill

## 何时使用

- **noul 判断题**：是/否、该不该、可不可、有没有风险——需要快速且前后一致（选项序翻转率 0.0187）
- **choice 选择题**：从候选里挑一项（返回选项下标）
- **score 打分题**：2–10 整数分（风险、匹配度、紧急度、质量）
- **审批预判**：命令/工具执行前先问「是否高风险」，配合审批门阈值使用
- **不适合**：文本生成、代码编写、长文推理——斑海豹是非生成式单遍判定模型（144.3M，8k 上下文，CPU 约 1.47s），不是对话模型

## 如何提问（phocinae_ask 工具）

一次调用可混发多道题：

- `state`：待决策情境的**完整原文**（照抄不改写、不省略关键信息——措辞扰动可能翻转判定）
- `questions`：数组，每题 `{id, type}`：
  - `noul` → 布尔答案 true/false；可选 `threshold`（为 true 的概率须超过阈值才返回 true）
  - `choice` → 必带 `options`，答案 = 选中项下标（整数，从 0 起）
  - `score` → 2–10 整数

示例：

{state: "用户请求执行 rm -rf /tmp/build-cache && make clean",
 questions: [{id:"risk", type:"noul", threshold:0.8},
             {id:"severity", type:"score"}]}
## 审批门流程（tools/pre-execute → guard → 本地服务）

1. 被门控工具（默认 bash）执行前，dsh 触发 `tools/pre-execute`；
2. `hooks/guard.js` 把「工具名+输入」整理成 noul 风险题，POST 到本地服务；
3. 风险概率 ≥ `gate.threshold`（默认 0.8）→ `deny`（硬阻断）或 `ask`（转人工）；否则放行；
4. 服务不可达/超时 → fail-safe 转 `ask`，**绝不静默放行**；
5. 服务地址：http://127.0.0.1:8155/v1/systemone（`cordis.patch.yml` 可改）。

## 使用纪律

- `state` 用原文，不代改措辞、不压缩关键选项；
- 答案只读不臆造：服务不可达/解析失败时如实告知，不猜答案；
- 阈值统一在配置里管（`gate.threshold` / 题级 `threshold`），不在提示词里现编；
- 斑海豹只基于你给的 `state` 判定，不联网、无外部知识。
