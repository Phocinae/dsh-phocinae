// hooks/guard.js — 审批门 guard（PreToolUse 类）
// 数据流：dsh tools/pre-execute → guard() → POST /v1/systemone（noul 风险判定）
//   → allow（放行）/ deny（阻断）/ ask（转人工）
// 判定语义：noul 答案 true = 高风险；概率阈值 = question.threshold
// fail-safe：服务不可达/超时/非 200/解析失败 → 默认 ask（不放行）；除非显式 failOpen=true
// 独立模块：不依赖 dsh，可单独 import（自测，或复用为其他 harness 的 PreToolUse 判定）

export const GUARD_DEFAULTS = {
  endpoint: 'http://127.0.0.1:8155/v1/systemone',
  model: 'Phocinae-Largha-150M-v1',
  timeoutMs: 3000,
  threshold: 0.8,
  mode: 'deny',    // deny=硬阻断；ask=转人工确认
  failOpen: false  // 默认 false：审批服务出故障绝不放行
}

function safeJson(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function renderToolCall(toolName, toolInput) {
  const brief = typeof toolInput === 'string' ? toolInput : safeJson(toolInput)
  return `工具: ${toolName}\n输入: ${brief}`
}

export function buildGateBody(config, toolName, toolInput) {
  return {
    model: config.model,
    state: renderToolCall(toolName, toolInput),
    questions: [{ id: 'risk', type: 'noul', threshold: config.threshold }]
  }
}
// ——— 请求执行、判定、事件监听器 ———

export async function callSystemOne(body, config = {}) {
  const timeoutMs = config.timeoutMs ?? GUARD_DEFAULTS.timeoutMs
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    if (!resp.ok) throw new Error(`服务响应 ${resp.status}`)
    const data = await resp.json()
    if (!data || !('answers' in data)) throw new Error('响应缺少 answers 字段')
    return data
  } finally {
    clearTimeout(timer)
  }
}

function firstAnswer(data, questionId) {
  if (Array.isArray(data.answers)) return data.answers[0]
  return data.answers?.[questionId]
}

export async function guard({ toolName, toolInput, config }) {
  const cfg = { ...GUARD_DEFAULTS, ...config }
  try {
    const body = buildGateBody(cfg, toolName, toolInput)
    const data = await callSystemOne(body, cfg)
    const risk = firstAnswer(data, 'risk')
    if (risk === true) {
      const decision = cfg.mode === 'deny' ? 'deny' : 'ask'
      return {
        decision,
        reason: `斑海豹判定高风险（概率阈值 ${cfg.threshold}）`,
        answer: data
      }
    }
    return { decision: 'allow', reason: '斑海豹判定低风险', answer: data }
  } catch (err) {
    if (cfg.failOpen) {
      return { decision: 'allow', reason: '审批服务不可达，failOpen 显式放行：' + err.message }
    }
    return { decision: 'ask', reason: '审批服务不可达（fail-safe，不放行）：' + err.message }
  }
}

// dsh 原生事件面：tools/pre-execute 瀑布监听器。
// 拦截 = 不调用 next()；放行 = 调用 next()。
// 注：dsh 处 Developer Preview，事件 payload 结构以目标 rc 版本实现为准（见 hooks/README.md）。
export async function preExecuteGate(event, config, next) {
  const gate = config?.gate ?? {}
  if (gate.enabled === false) {
    if (next) next()
    return
  }
  const payload = event?.payload ?? event ?? {}
  const toolName = payload?.tool?.name ?? payload?.toolName ?? payload?.name ?? ''
  const gateTools = gate.tools ?? ['bash']
  if (!gateTools.includes(toolName)) {
    if (next) next()
    return
  }
  const toolInput = payload?.input ?? payload?.args ?? payload
  const result = await guard({ toolName, toolInput, config: { ...config, ...gate } })
  if (result.decision === 'allow') {
    if (next) next()
    return
  }
  // deny / ask：不调 next()，即阻断（ask 场景由上层转 ctx.approval 人工确认）
  const err = Object.assign(new Error(result.reason), { phocinaeGate: result })
  if (typeof event?.reject === 'function') event.reject(err)
  else if (next) next(err)
}
