// scripts/validate.mjs — dsh-phocinae 本地自检（npm run validate）
// 检查：package.json 可解析 + dsh bundle 元数据；必含文件齐全；
//       cordis.patch.yml 关键键存在；各 JS 模块可 import（语法级验证）。
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
let failures = 0
const fail = (m) => { failures += 1; console.error('✗ ' + m) }
const ok = (m) => console.log('✓ ' + m)

// 1) package.json
let pkg
try {
  pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  ok('package.json: JSON 可解析')
} catch (e) {
  fail('package.json: ' + e.message)
  process.exit(1)
}
if (pkg.name === 'dsh-phocinae') ok('name = dsh-phocinae')
else fail('name 应为 dsh-phocinae，实际 ' + pkg.name)
if (pkg.version === '0.1.0') ok('version = 0.1.0')
else fail('version 应为 0.1.0')
if (pkg.license === 'Apache-2.0') ok('license = Apache-2.0')
else fail('license 应为 Apache-2.0')
if (pkg.dsh?.bundle?.patch === './cordis.patch.yml') ok('dsh.bundle.patch = ./cordis.patch.yml')
else fail('缺少 dsh.bundle.patch 元数据')
if (Array.isArray(pkg.files) && pkg.files.includes('cordis.patch.yml')) ok('files 含 cordis.patch.yml')
else fail('files 缺 cordis.patch.yml')

// 2) 必含文件
const required = ['cordis.patch.yml', 'index.js', 'tools/phocinae_ask.js', 'hooks/guard.js',
  'skills/phocinae/SKILL.md', 'README.md', 'LICENSE']
for (const f of required) {
  if (existsSync(join(root, f))) ok('存在 ' + f)
  else fail('缺失 ' + f)
}

// 3) cordis.patch.yml 关键键（无 YAML 依赖的粗检；全量解析见 pyyaml 校验）
const yml = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
for (const needle of ['- insert:', 'id: phocinae', 'name: dsh-phocinae', 'endpoint:', '8155', 'gate:']) {
  if (yml.includes(needle)) ok('cordis.patch.yml 含 `' + needle + '`')
  else fail('cordis.patch.yml 缺 `' + needle + '`')
}

// 4) JS 模块可 import
for (const mod of ['index.js', 'tools/phocinae_ask.js', 'hooks/guard.js']) {
  try {
    await import(pathToFileURL(join(root, mod)).href)
    ok(mod + ' import 成功（语法 OK）')
  } catch (e) {
    fail(mod + ' import 失败: ' + e.message)
  }
}

if (failures > 0) {
  console.error('\n共 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('\n全部通过 ✓')
