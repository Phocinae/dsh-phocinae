// index.js — dsh-phocinae 插件入口
// bundle：package.json 的 dsh.bundle.patch → cordis.patch.yml 插入本插件行
//   plugin id: phocinae ｜ 工具：phocinae_ask（tools/phocinae_ask.js）
//   审批门：tools/pre-execute → hooks/guard.js（PreToolUse 类）
// 注意：dsh 处 Developer Preview（目标 0.1.5-rc 线），注册 API 可能随 rc 变化；
// 本入口对 ctx 做防御性探测，缺 ctx 时仍可作为纯库 import（自测/独立调用）。

import phocinaeAsk, { DEFAULT_ENDPOINT, DEFAULT_MODEL } from './tools/phocinae_ask.js'
import { guard, preExecuteGate, GUARD_DEFAULTS } from './hooks/guard.js'

export const PLUGIN_ID = 'phocinae'
export const BUNDLE_NAME = 'dsh-phocinae'
export { phocinaeAsk, guard }

const DEFAULTS = {
  endpoint: DEFAULT_ENDPOINT,
  model: DEFAULT_MODEL,
  timeoutMs: 3000,
  gate: {
    enabled: true,
    threshold: GUARD_DEFAULTS.threshold,
    mode: GUARD_DEFAULTS.mode,
    tools: ['bash']
  }
}

export function resolveConfig(config = {}) {
  return {
    ...DEFAULTS,
    ...config,
    gate: { ...DEFAULTS.gate, ...(config.gate || {}) }
  }
}

export default function phocinae(ctx, config = {}) {
  const cfg = resolveConfig(config)

  // 1) 注册决策工具 phocinae_ask（防御性探测注册面）
  const tool = {
    ...phocinaeAsk,
    handler: (args) => phocinaeAsk.handler(args, cfg)
  }
  if (ctx && typeof ctx.registerTool === 'function') ctx.registerTool(tool)
  else if (ctx?.tools && typeof ctx.tools.register === 'function') ctx.tools.register(tool)

  // 2) 审批门：tools/pre-execute 瀑布监听（拦截 = 不调 next()）
  if (ctx && typeof ctx.on === 'function') {
    ctx.on('tools/pre-execute', (event, next) => preExecuteGate(event, cfg, next))
  }

  return { id: PLUGIN_ID, bundle: BUNDLE_NAME, config: cfg }
}
