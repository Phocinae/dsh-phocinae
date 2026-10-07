// tools/phocinae_ask.js — phocinae_ask 工具定义（dsh 工具形态）
// 职责：构造 POST /v1/systemone 请求 → 本地斑海豹服务 → 返回 typed answers。
// 协议（TypeSafe /v1/systemone 兼容面）：
//   请求：{ model, state: str, questions: [{ id, type: noul|choice|score, options?, threshold? }] }
//   响应：{ model, answers, usage, answer_confidence }
//   noul=bool；choice=int（选项下标，0 起）；score=2–10 的 int。
// 独立模块：不依赖 dsh，可直接 import 自测（Node >= 22.19）。

export const TOOL_NAME = 'phocinae_ask'
export const DEFAULT_ENDPOINT = 'http://127.0.0.1:8155/v1/systemone'
export const DEFAULT_MODEL = 'Phocinae-Largha-150M-v1'
export const DEFAULT_TIMEOUT_MS = 3000

export const phocinaeAskSchema = {
  type: 'object',
  description: '一次调用混发多道决策题（noul/choice/score），由本地斑海豹模型一次性判定。',
  properties: {
    state: {
      type: 'string',
      description: '待决策的完整情境原文。照抄不改写、不省略关键信息，避免措辞扰动翻转判定。'
    },
    questions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '本道题的唯一标识（响应 answers 按此对齐）' },
          type: { type: 'string', enum: ['noul', 'choice', 'score'], description: '题型' },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'choice 型必填：候选选项原文（答案返回选中项下标）'
          },
          threshold: {
            type: 'number',
            description: 'noul 型可选：答案为 true 的概率须超过该值才返回 true（默认 0.5）'
          }
        },
        required: ['id', 'type']
      }
    }
  },
  required: ['state', 'questions']
}

export function buildBody(model, state, questions) {
  return { model, state, questions }
}

export function validateQuestions(questions) {
  // 返回 null（合法）或错误信息；choice 必带 options（>=2 项）
  if (!Array.isArray(questions) || questions.length === 0) return 'questions 必须为非空数组'
  for (const q of questions) {
    if (!q || typeof q.id !== 'string' || !q.id) return '每题必填字符串 id'
    if (!['noul', 'choice', 'score'].includes(q.type)) return 'type 必须是 noul/choice/score'
    if (q.type === 'choice' && (!Array.isArray(q.options) || q.options.length < 2)) {
      return 'choice 题必须提供 options（至少 2 项）'
    }
  }
  return null
}
// ——— 请求执行与工具入口 ———

export async function callSystemOne(body, config = {}) {
  const endpoint = config.endpoint || DEFAULT_ENDPOINT
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`服务响应 ${resp.status}: ${text.slice(0, 200)}`)
    }
    const data = await resp.json()
    if (!data || typeof data !== 'object' || !('answers' in data)) {
      throw new Error('响应缺少 answers 字段：' + JSON.stringify(data).slice(0, 200))
    }
    return data
  } finally {
    clearTimeout(timer)
  }
}

export async function phocinaeAskHandler(args, config = {}) {
  const { state, questions } = args || {}
  const err = validateQuestions(questions)
  if (err) throw new Error('phocinae_ask 参数错误：' + err)
  if (typeof state !== 'string' || !state) throw new Error('phocinae_ask 参数错误：state 必填')
  const body = buildBody(config.model || DEFAULT_MODEL, state, questions)
  const data = await callSystemOne(body, config)
  return {
    model: data.model,
    answers: data.answers,
    usage: data.usage ?? null,
    answer_confidence: data.answer_confidence ?? null
  }
}

const tool = {
  name: TOOL_NAME,
  description: '把一道或多道结构化决策题（noul 判断 / choice 选择 / score 打分）交给本地斑海豹决策模型（Phocinae-Largha-150M-v1）判定。适合需要快速、稳定、可阈值化判定的场景（审批预判、批量筛选、风险打分）；不是文本生成模型，请勿用于写作或推理问答。',
  inputSchema: phocinaeAskSchema,
  handler: phocinaeAskHandler
}

export default tool
