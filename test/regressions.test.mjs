/**
 * Regression tests for the defects confirmed in dsh-phocinae 0.1.2 and 0.2.4.
 *
 * Each test names the defect it pins. They run against a mock host and a mock
 * decision service, so they need neither a real harness nor a running model.
 *
 * The 0.2.4 section at the bottom covers the shipped auto-allow list, a missing
 * tool name, a missing `next()` callback, and the cmd.exe metacharacters.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ENTRY = pathToFileURL(join(ROOT, 'index.mjs')).href

const GOOD_ENDPOINT = 'http://127.0.0.1:8155/v1/systemone'

/** A response body shaped exactly like phocinae-server's. */
function serverBody(answers, { confidence, model = 'Phocinae-Largha-150M-v1' } = {}) {
  const body = { model, answers, usage: { input_tokens: 24, output_tokens: 0 } }
  if (confidence !== undefined) body.answer_confidence = confidence
  return body
}

/** Replace global fetch for the duration of `run`, recording every request. */
async function withFetch(handler, run) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : undefined
    calls.push({ url: String(url), body, headers: init?.headers })
    return handler(body, calls.length - 1)
  }
  try {
    return { result: await run(), calls }
  } finally {
    globalThis.fetch = original
  }
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }
}

/** A host context shaped the way DSH 0.2.1 hands one to a plugin. */
function makeHost({ withTools = true, withSkills = true, toolsThrowsOnUndeclared = true } = {}) {
  const registered = []
  const skills = []
  const listeners = new Map()
  const warnings = []
  const base = {
    logger: {
      info: () => {},
      warn: (message) => warnings.push(String(message)),
      error: () => {},
    },
    on(name, handler) {
      if (!listeners.has(name)) listeners.set(name, [])
      listeners.get(name).push(handler)
    },
    tools: {
      register(definition) {
        registered.push(definition)
        return () => {}
      },
    },
    skills: {
      register(definition) {
        skills.push(definition)
        return () => {}
      },
    },
    inject(deps, callback) {
      // Cordis runs the callback once the named services are available.
      injected.push([...deps])
      if (deps.includes('tools') && !withTools) return
      if (deps.includes('skills') && !withSkills) return
      callback(base)
    },
  }
  const injected = []
  let ctx = base
  if (toolsThrowsOnUndeclared) {
    // Reproduce the Cordis proxy: reading an undeclared service name throws
    // instead of returning undefined. This is what killed 0.1.2.
    ctx = new Proxy(base, {
      get(target, property, receiver) {
        if (typeof property === 'string' && !(property in target)
          && property !== 'then' && property !== 'toJSON') {
          throw new Error(`cannot get property "${property}" without inject`)
        }
        return Reflect.get(target, property, receiver)
      },
    })
  }
  if (!withTools) delete base.tools
  if (!withSkills) delete base.skills
  return { ctx, registered, skills, listeners, warnings, injected }
}

/** Drive the pre-execute waterfall the way the tool runtime does. */
async function runGate(listeners, exec) {
  const gate = listeners.get('tools/pre-execute')?.[0]
  assert.ok(gate, 'the plugin must subscribe to tools/pre-execute')
  let nextCalls = 0
  const decision = await gate(exec, async () => {
    nextCalls += 1
    return { kind: 'allow' }
  })
  return { decision, nextCalls }
}

/**
 * A shell call that must reach the model.
 *
 * Deliberately NOT `git status`: that is on the default auto-allow list, so it
 * never consults the service and would make every assertion below vacuous.
 */
const SHELL_EXEC = {
  callId: 'call-1',
  rootCallId: 'call-1',
  token: 'token-1',
  name: 'pwsh',
  arguments: { command: 'Remove-Item -Recurse -Force ./build' },
  signal: new AbortController().signal,
}

/** A command that is on the default auto-allow list. */
const AUTO_ALLOWED_EXEC = {
  ...SHELL_EXEC,
  callId: 'call-2',
  arguments: { command: 'git status' },
}

test('D1: the entry activates against a Cordis context (no undeclared service access)', async () => {
  const plugin = await import(ENTRY)
  const host = makeHost()
  const descriptor = plugin.default(host.ctx, {})

  assert.equal(descriptor.id, 'phocinae')
  assert.deepEqual(host.injected, [['tools'], ['skills']],
    'the tool and skill registries must be awaited through ctx.inject, never probed')
})

test('D1b: activation does not depend on a legacy ctx.registerTool member', async () => {
  const plugin = await import(ENTRY)
  const host = makeHost()
  // A host without `registerTool` must still produce a working plugin. The
  // proxy above throws on any undeclared read, so merely touching
  // ctx.registerTool would fail this test.
  plugin.default(host.ctx, {})
  assert.equal(host.registered.length, 2)
})

test('D13: the skill is registered through ctx.skills, not merely shipped', async () => {
  const plugin = await import(ENTRY)
  const host = makeHost()
  const descriptor = plugin.default(host.ctx, {})

  assert.equal(host.skills.length, 1, 'the plugin must register exactly one skill')
  const skill = host.skills[0]
  assert.equal(skill.name, 'phocinae')
  assert.equal(descriptor.skill, 'phocinae')
  assert.equal(typeof skill.description, 'string')
  assert.ok(skill.description.length > 40, 'the description is what routes the skill')
  assert.equal(typeof skill.whenToUse, 'string')
  assert.equal(typeof skill.content, 'string')
  assert.ok(skill.content.length > 500, 'the body is the instruction text the model loads')
  assert.deepEqual(skill.invocation, { modelInvocable: true, userInvocable: true })

  // The registry validates the kebab-case name and a non-empty description, and
  // rejects an undefined invocation policy object.
  assert.match(skill.name, /^[a-z0-9]+(-[a-z0-9]+)*$/)
  assert.notEqual(skill.description.length, 0)
})

test('D13b: a host without a skill registry still gets the tools and the gate', async () => {
  const plugin = await import(ENTRY)
  const host = makeHost({ withSkills: false })
  const descriptor = plugin.default(host.ctx, {})

  assert.equal(host.skills.length, 0)
  assert.equal(host.registered.length, 2, 'tools must register regardless')
  assert.equal(host.listeners.get('tools/pre-execute')?.length, 1,
    'the gate must arm regardless')
  assert.equal(descriptor.gateEnabled, true)
})

test('D2: registered tools are complete ToolDefinitions', async () => {
  const plugin = await import(ENTRY)
  const host = makeHost()
  plugin.default(host.ctx, {})

  const names = host.registered.map((tool) => tool.name).sort()
  assert.deepEqual(names, ['phocinae_ask', 'phocinae_gate'])
  for (const tool of host.registered) {
    assert.equal(typeof tool.description, 'string')
    assert.ok(tool.description.length > 40, 'the description is what the model routes on')
    assert.equal(typeof tool.execute, 'function', `${tool.name} needs execute()`)
    assert.equal(typeof tool.handler, 'undefined',
      `${tool.name} must not ship a legacy handler()`)
    assert.equal(tool.parameters.type, 'object',
      `${tool.name} must expose \`parameters\` (raw JSON Schema)`)
    assert.ok(Array.isArray(tool.parameters.required))
    assert.equal(typeof tool.output?.schema, 'object', `${tool.name} needs output.schema`)
    assert.equal(typeof tool.output?.render, 'function', `${tool.name} needs output.render`)
    assert.ok(Array.isArray(tool.output.render({}, sampleValue(tool.name))))
  }
})

/** A canonical value of the right shape, for render smoke tests. */
function sampleValue(toolName) {
  if (toolName === 'phocinae_gate') {
    return {
      decision: 'ask',
      reason: 'confidence-below-threshold',
      modelDecision: 'allow',
      escalate: true,
      confidence: 0.54,
      error: null,
    }
  }
  return {
    model: 'Phocinae-Largha-150M-v1',
    answers: { risk: true },
    confidence: { risk: 0.91 },
    escalate: false,
    escalatedIds: [],
    escalationReason: null,
    escalateAt: 0.6,
    usage: { input_tokens: 24, output_tokens: 0 },
  }
}

test('D3: the gate reads answers keyed by question id, not as an array', async () => {
  const plugin = await import(ENTRY)
  const host = makeHost()
  plugin.default(host.ctx, {})

  const { result, calls } = await withFetch(
    () => jsonResponse(serverBody({ harm: 2 }, { confidence: { harm: 0.93 } })),
    () => runGate(host.listeners, SHELL_EXEC),
  )

  assert.equal(calls.length, 1, 'exactly one decision request per gate evaluation')
  assert.equal(result.decision.kind, 'deny',
    'option index 2 of allow/ask/deny is deny; 0.1.2 read answers[0] and always allowed')
  assert.equal(result.nextCalls, 0, 'a deny must not delegate')
})

test('D4: an unreachable service fails closed, never silently through', async () => {
  const plugin = await import(ENTRY)
  const host = makeHost()
  plugin.default(host.ctx, {})

  const { result } = await withFetch(
    () => { throw new Error('connect ECONNREFUSED 127.0.0.1:8155') },
    () => runGate(host.listeners, SHELL_EXEC),
  )

  assert.equal(result.decision.kind, 'ask',
    'a dead decision service must route to a human, not allow the call')
  assert.equal(result.nextCalls, 0)
  assert.match(result.decision.reason, /unavailable|unreachable/i)
})

test('D4b: fail-open is available but explicit', async () => {
  const plugin = await import(ENTRY)
  const host = makeHost()
  plugin.default(host.ctx, { gate: { failMode: 'open' } })

  const { result } = await withFetch(
    () => { throw new Error('ECONNREFUSED') },
    () => runGate(host.listeners, SHELL_EXEC),
  )
  assert.equal(result.decision.kind, 'allow')
  assert.equal(result.nextCalls, 1)
})

test('D5: verdicts are PreToolDecision objects, not thrown errors', async () => {
  const plugin = await import(ENTRY)
  const host = makeHost()
  plugin.default(host.ctx, {})

  // harm index 1 = "risky": the case that must reach a human, and the one whose
  // shape 0.1.2 could not produce at all (it returned plain `undefined`).
  const { result } = await withFetch(
    () => jsonResponse(serverBody({ harm: 1 }, { confidence: { harm: 0.77 } })),
    () => runGate(host.listeners, SHELL_EXEC),
  )

  assert.equal(result.decision.kind, 'ask')
  assert.equal(typeof result.decision.reason, 'string')
  assert.ok(result.decision.displayReason?.en, 'ask carries a localized display reason')
  assert.equal(result.nextCalls, 0)
})

test('D6: a malformed answer body fails closed rather than reading as safe', async () => {
  const plugin = await import(ENTRY)
  const host = makeHost()
  plugin.default(host.ctx, {})

  const { result } = await withFetch(
    () => jsonResponse({ model: 'x', answers: [false], usage: {} }),
    () => runGate(host.listeners, SHELL_EXEC),
  )
  assert.equal(result.decision.kind, 'ask')
  assert.equal(result.nextCalls, 0)
})

test('D7: gate.tools defaults to every tool, so a pwsh host is covered', async () => {
  const plugin = await import(ENTRY)
  const host = makeHost()
  plugin.default(host.ctx, {})

  const { calls } = await withFetch(
    () => jsonResponse(serverBody({ harm: 1 }, { confidence: { harm: 0.95 } })),
    () => runGate(host.listeners, { ...SHELL_EXEC, name: 'pwsh' }),
  )
  assert.equal(calls.length, 1,
    "the default pattern must match pwsh; 0.1.2 hard-coded ['bash'] and skipped every call")
})

test('D8: selected tool names are matched, everything else delegates untouched', async () => {
  const plugin = await import(ENTRY)
  const host = makeHost()
  plugin.default(host.ctx, { gate: { tools: ['pwsh'], autoAllow: [] } })

  const { result, calls } = await withFetch(
    () => jsonResponse(serverBody({ harm: 2 }, { confidence: { harm: 0.99 } })),
    async () => {
      const gated = await runGate(host.listeners, { ...SHELL_EXEC, name: 'pwsh' })
      const ungated = await runGate(host.listeners, { ...SHELL_EXEC, name: 'read_file' })
      return { gated, ungated }
    },
  )

  assert.equal(calls.length, 1, 'only the gated tool costs a decision request')
  assert.equal(calls[0].body.state.includes('pwsh'), true)
  assert.equal(result.gated.decision.kind, 'deny')
  assert.equal(result.ungated.decision.kind, 'allow')
  assert.equal(result.ungated.nextCalls, 1, 'an ungated tool must delegate exactly once')
})

test('D9: a plain allow-listed command never reaches the decision service', async () => {
  const plugin = await import(ENTRY)
  const host = makeHost()
  plugin.default(host.ctx, {})

  const { result, calls } = await withFetch(
    () => { throw new Error('the service must not be called for an allow-listed command') },
    () => runGate(host.listeners, AUTO_ALLOWED_EXEC),
  )

  assert.equal(calls.length, 0)
  assert.equal(result.decision.kind, 'allow')
  assert.equal(result.nextCalls, 1)
})

test('D10: a shell operator disqualifies an otherwise allow-listed command', async () => {
  const plugin = await import(ENTRY)
  const host = makeHost()
  plugin.default(host.ctx, {})

  const chained = {
    ...SHELL_EXEC,
    arguments: { command: 'git status && Remove-Item -Recurse -Force C:\\Windows' },
  }
  const { result, calls } = await withFetch(
    () => jsonResponse(serverBody({ harm: 2 }, { confidence: { harm: 0.98 } })),
    () => runGate(host.listeners, chained),
  )

  assert.equal(calls.length, 1, 'a chained command must be decided by the model')
  assert.equal(result.decision.kind, 'deny')
})

test('D11: a low-confidence allow is reviewed, and a low-confidence deny is not softened',
  async () => {
    const plugin = await import(ENTRY)
    const host = makeHost()
    // tri-state explicitly: this test is about the confidence rule, and the harm
    // scale has no "allow but unsure" state to soften.
    plugin.default(host.ctx, { gate: { mode: 'tri-state', autoAllow: [] } })

    const unsure = await withFetch(
      () => jsonResponse(serverBody({ action: 0 }, { confidence: { action: 0.3 } })),
      () => runGate(host.listeners, SHELL_EXEC),
    )
    assert.equal(unsure.result.decision.kind, 'ask')

    const firm = await withFetch(
      () => jsonResponse(serverBody({ action: 2 }, { confidence: { action: 0.2 } })),
      () => runGate(host.listeners, SHELL_EXEC),
    )
    assert.equal(firm.result.decision.kind, 'deny', 'a positive risk finding always stands')
  })

test('D12: harm mode passes only the harmless answer', async () => {
  const plugin = await import(ENTRY)
  const host = makeHost()
  plugin.default(host.ctx, { gate: { autoAllow: [] } })

  const harmless = await withFetch(
    () => jsonResponse(serverBody({ harm: 0 }, { confidence: { harm: 0.6 } })),
    () => runGate(host.listeners, SHELL_EXEC),
  )
  assert.equal(harmless.result.decision.kind, 'allow')
  assert.equal(harmless.result.nextCalls, 1)

  const risky = await withFetch(
    () => jsonResponse(serverBody({ harm: 1 }, { confidence: { harm: 0.8 } })),
    () => runGate(host.listeners, SHELL_EXEC),
  )
  assert.equal(risky.result.decision.kind, 'ask', 'risky never passes, whatever the confidence')

  const destructive = await withFetch(
    () => jsonResponse(serverBody({ harm: 2 }, { confidence: { harm: 0.8 } })),
    () => runGate(host.listeners, SHELL_EXEC),
  )
  assert.equal(destructive.result.decision.kind, 'deny')

  const unsureHarmless = await withFetch(
    () => jsonResponse(serverBody({ harm: 0 }, { confidence: { harm: 0.2 } })),
    () => runGate(host.listeners, SHELL_EXEC),
  )
  assert.equal(unsureHarmless.result.decision.kind, 'ask',
    'a harmless verdict the model is unsure about still goes to a human')
})

// ------------------------------------------------ 0.2.4: shipped auto-allow list

const load = (relative) => import(pathToFileURL(join(ROOT, relative)).href)
const { resolveConfig, isAutoAllowed } = await load('lib/config.mjs')
const { AUTO_ALLOW_EXACT, DEFAULT_AUTO_ALLOW, SHELL_OPERATOR_PATTERN } =
  await load('lib/constants.mjs')
const { decideToolCall } = await load('lib/guard.mjs')

/** Verdict of a command the model was never asked about, for every safe case. */
const NO_SERVICE = () => {
  throw new Error('the decision service must not be reached for an auto-allowed command')
}

/**
 * The commands an independent audit confirmed were auto-allowed by 0.2.4's
 * shipped defaults, each with the reason it must never be:
 *
 *   find … -delete   `find` deletes what it matched, from the command line
 *   env <command>    `env` runs an arbitrary command
 *   make <target>    a target name is a command name chosen by the caller
 *
 * Every one of these returned `{decision: 'allow', reason:
 * 'command-on-auto-allow-list'}` with no model in the loop.
 */
const AUDITED_LAUNCHERS = [
  'find / -delete',
  'find . -delete',
  'find /home -name "*.key" -delete',
  'env rm -rf /',
  'env sh -c "rm -rf /"',
  'make destroy-everything',
]

/** Commands that must keep passing locally, or the gate becomes noise. */
const STILL_AUTO_ALLOWED = [
  'git status',
  'git status --short',
  'ls -la',
  'cat README.md',
  'npm run build',
  'npm test',
  'make',
  'make all',
  'make build',
  'make test',
  'make check',
  'make lint',
]

test('B5: every command the audit auto-allowed is now decided by the model', async () => {
  const plugin = await import(ENTRY)
  const host = makeHost()
  plugin.default(host.ctx, {}) // shipped defaults, nothing overridden

  for (const command of AUDITED_LAUNCHERS) {
    const { result, calls } = await withFetch(
      () => jsonResponse(serverBody({ harm: 2 }, { confidence: { harm: 0.97 } })),
      () => runGate(host.listeners, { ...SHELL_EXEC, arguments: { command } }),
    )
    assert.equal(calls.length, 1,
      `${JSON.stringify(command)} reached the auto-allow list instead of the model`)
    assert.equal(result.decision.kind, 'deny',
      `${JSON.stringify(command)} must be gated, got ${JSON.stringify(result.decision)}`)
    assert.equal(result.nextCalls, 0, 'a denied call must not run')
  }
})

test('B5b: the safe verbs still never reach the decision service', async () => {
  const plugin = await import(ENTRY)
  const host = makeHost()
  plugin.default(host.ctx, {})

  for (const command of STILL_AUTO_ALLOWED) {
    const { result, calls } = await withFetch(NO_SERVICE,
      () => runGate(host.listeners, { ...SHELL_EXEC, arguments: { command } }))
    assert.equal(calls.length, 0, `${JSON.stringify(command)} should not cost a request`)
    assert.equal(result.decision.kind, 'allow',
      `${JSON.stringify(command)} must stay automatic, got ${JSON.stringify(result.decision)}`)
    assert.equal(result.nextCalls, 1, 'an allowed call must delegate exactly once')
  }
})

test('B5c: the exact-match tier stops a caller-chosen target, not the safe ones', () => {
  const list = resolveConfig({}).gate.autoAllow

  // `make` and its conventional targets are whole-command matches…
  for (const entry of AUTO_ALLOW_EXACT) {
    assert.equal(isAutoAllowed(entry, list), entry)
    assert.equal(isAutoAllowed(`${entry} extra-target`, list), null,
      `${JSON.stringify(entry)} must not pass trailing arguments`)
    assert.equal(isAutoAllowed(`${entry}-evil`, list), null)
  }
  // …and a target that is not on the list is the model's call, not ours.
  assert.equal(isAutoAllowed('make destroy-everything', list), null)
  assert.equal(isAutoAllowed('make -f /tmp/evil.mk', list), null)
  assert.equal(isAutoAllowed('make test evil', list), null)

  // A user-supplied list inherits the same rule: `['make']` is not a launcher.
  assert.equal(isAutoAllowed('make deploy', ['make']), null)
  assert.equal(isAutoAllowed('make', ['make']), 'make')
})

test('B5d: no shipped entry is a generic command launcher', () => {
  // Verbs whose own arguments name a command, or a deletion target. `find` and
  // `env` shipped in 0.2.4; `fd`/`rg` carry the same channel through `-x` and
  // `--pre`. None of them may come back.
  const LAUNCHERS = new Set([
    'find', 'env', 'fd', 'rg', 'xargs', 'npx', 'bash', 'sh', 'zsh', 'eval', 'exec',
    'python', 'python3', 'node', 'deno', 'bun', 'perl', 'ruby', 'awk', 'sed',
    'ssh', 'curl', 'wget', 'bash -c', 'sh -c', 'node -e', 'python -c',
  ])
  for (const entry of DEFAULT_AUTO_ALLOW) {
    assert.ok(!LAUNCHERS.has(entry),
      `shipped entry ${JSON.stringify(entry)} can name a second command; remove it`)
  }
  // Every exact-match entry must exist in the shipped list, or the two lists
  // have drifted and the documented default is not what runs.
  for (const entry of AUTO_ALLOW_EXACT) {
    assert.ok(DEFAULT_AUTO_ALLOW.includes(entry),
      `${JSON.stringify(entry)} is exact-matched but not in DEFAULT_AUTO_ALLOW`)
  }
})

test('B6: an unnamed tool fails closed instead of passing ungated', async () => {
  const plugin = await import(ENTRY)
  const host = makeHost()
  plugin.default(host.ctx, {}) // gate.tools defaults to ['*']

  // `exec.name` renamed or absent: `toolMatches` answers "no match", and that
  // answer used to be read as "not gated" — a blanket bypass for every call.
  const shapes = [
    ['empty name', (exec) => ({ ...exec, name: '' })],
    ['whitespace name', (exec) => ({ ...exec, name: '   ' })],
    ['null name', (exec) => ({ ...exec, name: null })],
    ['undefined name', (exec) => ({ ...exec, name: undefined })],
    ['non-string name', (exec) => ({ ...exec, name: 42 })],
    ['missing name key', (exec) => {
      const withoutName = { ...exec }
      delete withoutName.name
      return withoutName
    }],
  ]

  for (const [label, reshape] of shapes) {
    const { result, calls } = await withFetch(NO_SERVICE, () => runGate(host.listeners,
      reshape({ ...SHELL_EXEC, arguments: { command: 'rm -rf /' } })))
    assert.equal(result.decision.kind, 'ask',
      `${label}: must fail closed, got ${JSON.stringify(result.decision)}`)
    assert.equal(result.decision.reason.includes('tool-name-missing'), true,
      `${label}: the reason must name the defect, got ${result.decision.reason}`)
    assert.equal(result.nextCalls, 0, `${label}: an ask must not delegate`)
    assert.equal(calls.length, 0, `${label}: the model is not the right fallback here`)
  }

  // The whole payload missing entirely, which is what a host bug looks like.
  for (const exec of [{}, null, undefined]) {
    const { result } = await withFetch(NO_SERVICE, () => runGate(host.listeners, exec))
    assert.equal(result.decision.kind, 'ask', 'a payload without a name must fail closed')
  }

  // The verdict itself carries the escalation, not only the decision object.
  const direct = await decideToolCall(
    { toolName: '', toolInput: { command: 'rm -rf /' } }, resolveConfig({}))
  assert.equal(direct.decision, 'ask')
  assert.equal(direct.reason, 'tool-name-missing')
  assert.equal(direct.escalate, true)

  // A named tool that is simply not covered still delegates: the gate must not
  // swallow tools it was never asked to screen.
  const scoped = makeHost()
  plugin.default(scoped.ctx, { gate: { tools: ['pwsh'] } })
  const ungated = await withFetch(NO_SERVICE,
    () => runGate(scoped.listeners, { ...SHELL_EXEC, name: 'read_file' }))
  assert.equal(ungated.result.decision.kind, 'allow')
  assert.equal(ungated.result.nextCalls, 1)
  const unnamed = await withFetch(NO_SERVICE,
    () => runGate(scoped.listeners, { ...SHELL_EXEC, name: '' }))
  assert.equal(unnamed.result.decision.kind, 'ask',
    'a payload with no name cannot be shown to be outside gate.tools either')
})

test('B21: a host that omits next() gets a verdict, not a TypeError', async () => {
  const plugin = await import(ENTRY)
  const host = makeHost()
  plugin.default(host.ctx, {})

  const gate = host.listeners.get('tools/pre-execute')?.[0]
  assert.ok(gate)

  // The allow path is the one that calls next(); without it the listener used
  // to throw "next is not a function" out of the waterfall and abort the run.
  const { result: allowed } = await withFetch(NO_SERVICE,
    async () => ({ decision: await gate(AUTO_ALLOWED_EXEC) }))
  assert.equal(allowed.decision.kind, 'ask',
    'an undeliverable allow is a review, never a thrown error')
  assert.match(allowed.decision.reason, /delegate-callback-missing/)

  const explicitNull = await gate({ ...SHELL_EXEC, arguments: { command: 'ls' } }, null)
  assert.equal(explicitNull.kind, 'ask')

  // A non-allow verdict never needed next(), and still does not.
  const denied = await withFetch(
    () => jsonResponse(serverBody({ harm: 2 }, { confidence: { harm: 0.98 } })),
    () => gate(SHELL_EXEC),
  )
  assert.equal(denied.result.kind, 'deny')
})

test('B22: cmd.exe metacharacters disqualify an otherwise allow-listed command', () => {
  const list = resolveConfig({}).gate.autoAllow

  // `%VAR%` expands before the command runs; `^` escapes the next character, so
  // it decides what the parser sees. Both matter when gate.tools points at a
  // cmd.exe-backed tool, and neither was in the pattern 0.2.4 shipped.
  for (const command of [
    'git status %TEMP%',
    'ls %CD%',
    'cat %USERPROFILE%',
    'git status ^ more',
    'git status ^& echo pwned',
    'ls ^| more',
  ]) {
    assert.equal(isAutoAllowed(command, list), null,
      `${JSON.stringify(command)} must not be auto-allowed`)
  }

  assert.equal(SHELL_OPERATOR_PATTERN.test('%'), true, '% is a cmd.exe metacharacter')
  assert.equal(SHELL_OPERATOR_PATTERN.test('^'), true, '^ is a cmd.exe metacharacter')
  // Quoting a path is not a chaining vector under cmd.exe, so it stays allowed:
  // tightening this would route ordinary quoted arguments to the model for nothing.
  assert.equal(isAutoAllowed('cat "my file.txt"', list), 'cat')
})
