# 审批门（PreToolUse 类）配置

## 接入点

dsh 原生事件面 `tools/pre-execute`（Cordis typed 事件，瀑布监听器，拦截 = 不调用 next()）。
语义与 Claude Code / Codex 的 PreToolUse 相同——`hooks/guard.js` 不依赖 dsh，可复用为其它 harness 的 PreToolUse 判定脚本。

## 数据流

bash 等被门控工具执行前 → preExecuteGate() → guard() → POST http://127.0.0.1:8155/v1/systemone（noul 风险题）→ allow / deny / ask

## 配置键（cordis.patch.yml 的 config.gate）

| 键 | 默认 | 说明 |
|---|---|---|
| gate.enabled | true | 总开关 |
| gate.threshold | 0.8 | noul 风险概率 ≥ 阈值 → 判高风险 |
| gate.mode | deny | deny=硬阻断；ask=转人工确认 |
| gate.tools | [bash] | 被门控的工具名列表 |
| timeoutMs | 3000 | 单次请求超时（ms） |
| failOpen | false | 服务故障时是否放行（默认不放行） |

## 判定表

| 服务结果 | 决策 |
|---|---|
| noul 答案 = true（高风险） | deny 或 ask（按 gate.mode） |
| noul 答案 = false | allow |
| 不可达/超时/非 200/解析失败 | ask（fail-safe，不放行） |

## 直连 /v1/systemone 示例

```
curl -s http://127.0.0.1:8155/v1/systemone -H 'content-type: application/json' -d '{"model":"Phocinae-Largha-150M-v1","state":"工具: bash\n输入: rm -rf /tmp/build-cache","questions":[{"id":"risk","type":"noul","threshold":0.8}]}'
```

## 注意

- dsh 处 Developer Preview：事件 payload 结构以目标 rc 版本实现为准，适配点集中在 `preExecuteGate()`；
- 转人工（ask）在 dsh 内可接 `ctx.approval` 运行时能力，实现以 rc 版 API 为准。
