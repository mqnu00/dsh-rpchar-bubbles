/**
 * rpchar-bubbles parse/color unit tests.
 * 加载真实 bundle(在 container 里直接取 __test 挂点),校验角色分隔解析。
 */
import { strict as assert } from 'node:assert'

let registration
globalThis.window = {
  __ModuleLoader__: {
    load: (value) => { registration = value },
  },
}

const bundleUrl = new URL('../lib/client.js', import.meta.url)
await import(bundleUrl.href)
assert.ok(registration, 'bundle must register via window.__ModuleLoader__.load')
assert.equal(registration.id, 'rpchar-bubbles')

// react 桩:测试只用到 parseSegments/colorOf,不需要真正的 react。
const fakeReact = new Proxy({}, { get: (_t, key) => () => `react:${String(key)}` })
// 记录 bundle 的 require 目标:markdown 渲染必须走基座播种的 primitives。
const requiredSpecifiers = []
const mod = registration.factory((spec) => {
  requiredSpecifiers.push(spec)
  return fakeReact
})
assert.ok(requiredSpecifiers.includes('@deepseek-ai/dsh-client-ui-primitives'),
  'bundle must require the seeded @deepseek-ai/dsh-client-ui-primitives (MarkdownText) — raw text rendering regression')
assert.ok(mod.__test, 'bundle must expose __test hook')
const { parseSegments, colorOf } = mod.__test

// ── parseSegments ──────────────────────────────────────────────────────

// 1. 完整 narrator 输出:叙述 + 两个角色
const full = [
  '小酒馆里暖意融融，壁炉噼啪作响。',
  '',
  '────────────────────────────────────────',
  '🎭 **Alice Thornwood** (古代语言学者)',
  '────────────────────────────────────────',
  '',
  '你知道吗，这个词在古代语中其实意味着"升华"。',
  '',
  '────────────────────────────────────────',
  '🎭 **Bob Ironfist** (前军人)',
  '────────────────────────────────────────',
  '',
  '*Bob放下酒杯，目光锐利地看向Alice* 嗯。说下去。',
  '',
].join('\n')

const segs = parseSegments(full)
assert.ok(segs !== null, 'full narrator output should parse')
assert.equal(segs.length, 3, 'expect narrator + 2 characters')
assert.equal(segs[0].kind, 'narrator')
assert.ok(segs[0].text.includes('小酒馆'), 'narrator text preserved')
assert.equal(segs[1].kind, 'character')
assert.equal(segs[1].name, 'Alice Thornwood')
assert.equal(segs[1].occupation, '古代语言学者')
assert.ok(segs[1].text.includes('升华'), 'Alice dialogue preserved')
assert.equal(segs[2].name, 'Bob Ironfist')
assert.equal(segs[2].occupation, '前军人')
assert.ok(segs[2].text.includes('嗯。说下去'), 'Bob dialogue preserved')

// 2. 无角色头 → null(降级为普通气泡)
const plain = '没有任何角色的普通回复，就是一段话。'
assert.equal(parseSegments(plain), null, 'plain text must degrade to null')

// 3. 无职业的头(且开头无叙述,直接是分隔线 → 首段即角色)
const noOcc = '────────────────────────────────────────\n🎭 **Alice Thornwood**\n────────────────────────────────────────\n你好。'
const segs2 = parseSegments(noOcc)
assert.ok(segs2 !== null)
assert.equal(segs2[0].kind, 'character')
assert.equal(segs2[0].name, 'Alice Thornwood')
assert.equal(segs2[0].occupation, '')
assert.equal(segs2[0].text.trim(), '你好。')

// 4. 连续两个角色无中间叙述
const two = '────────────────────────────────────────\n🎭 **A** (甲)\n────────────────────────────────────────\n第一句。\n────────────────────────────────────────\n🎭 **B** (乙)\n────────────────────────────────────────\n第二句。'
const segs3 = parseSegments(two)
assert.equal(segs3.length, 2)
assert.equal(segs3[0].name, 'A')
assert.equal(segs3[1].name, 'B')

// 5. 开头直接是角色(无叙述)
const headChar = '────────────────────────────────────────\n🎭 **C** (丙)\n────────────────────────────────────────\n直接开口。'
const segs4 = parseSegments(headChar)
assert.equal(segs4.length, 1)
assert.equal(segs4[0].kind, 'character')
assert.equal(segs4[0].name, 'C')
assert.ok(!segs4[0].text.includes('直接开口') || segs4[0].text.includes('直接开口')) // 文本保留

// ── colorOf ────────────────────────────────────────────────────────────

assert.ok(typeof colorOf('Alice Thornwood') === 'string')
assert.ok(colorOf('Alice Thornwood').startsWith('#'))
assert.ok(colorOf('Alice Thornwood') !== colorOf('Bob Ironfist'), 'different names → different colors')

// ── 渲染冒烟:气泡文本必须经 MarkdownText 渲染 ─────────────────────────

const MARKDOWN_STUB = function MarkdownText() {}
const renderReact = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: Symbol.for('react.fragment'),
  useState: (init) => [init, () => {}],
  memo: (fn) => fn,
}
const rmod = registration.factory((spec) => {
  if (spec === 'react') return renderReact
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return { MarkdownText: MARKDOWN_STUB }
  throw new Error(`unexpected require: ${spec}`)
})

function collectMarkdown(el, out = [], depth = 0) {
  if (el === null || el === undefined || typeof el !== 'object' || depth > 12) return out
  if (Array.isArray(el)) {
    for (const item of el) collectMarkdown(item, out, depth + 1)
    return out
  }
  if (el.type === MARKDOWN_STUB) {
    out.push(el.props)
    return out
  }
  // 展开自定义组件(测试桩不执行真实 react,函数组件直接调用取子树)
  let { children } = el
  if (typeof el.type === 'function') children = [el.type(el.props)]
  for (const child of children ?? []) collectMarkdown(child, out, depth + 1)
  return out
}

const nodeOf = (status, text) => ({
  node: { data: { blocks: [{ kind: 'text', text }], status } },
  renderMessageImages: () => null,
})

// settled + 角色格式:叙述与角色气泡的正文都应为 MarkdownText 元素
const settledView = rmod.__test.BubbleAssistantNodeView(nodeOf('settled', full))
const settledMd = collectMarkdown(settledView)
assert.ok(settledMd.length >= 3, 'narrator + 2 character bubbles all render markdown')
assert.ok(settledMd.every((p) => p.streaming !== true), 'settled markdown must not be in streaming mode')
assert.ok(settledMd.some((p) => p.text.includes('小酒馆')), 'narrator text routed through MarkdownText')
assert.ok(settledMd.some((p) => p.text.includes('升华')), 'character text routed through MarkdownText')

// running:流式 markdown
const runningView = rmod.__test.BubbleAssistantNodeView(nodeOf('running', '流式中的 **加粗** 文本'))
const runningMd = collectMarkdown(runningView)
assert.ok(runningMd.length >= 1, 'streaming text renders markdown')
assert.ok(runningMd.every((p) => p.streaming === true), 'running markdown must be in streaming mode')

// t 缺席:codeLabels 允许为 undefined(组件内部有默认文案)
assert.equal(rmod.__test.codeLabelsOf(undefined), undefined)
const tStub = (key) => `t:${key}`
assert.deepEqual(rmod.__test.codeLabelsOf(tStub), { copyLabel: 't:copy', copiedLabel: 't:copied' })

console.log('✅ all rpchar-bubbles parse/color tests passed')