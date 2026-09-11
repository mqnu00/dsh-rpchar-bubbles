#!/usr/bin/env node
/**
 * inspect-render.mjs — 把一段回复喂进插件,打印它会被渲染成什么。
 *
 * 模型输出是不确定的:遇到"这次面板又没渲染出来"时,别猜,直接看渲染树。
 *
 *   node tools/inspect-render.mjs <session.jsonl|text.txt|->  [--streaming] [--raw]
 *
 *   <session.jsonl>  dsh 会话导出的明文 JSONL(取最后一条 assistant 消息的正文)
 *   <text.txt|->     直接给文本,`-` 表示从 stdin 读
 *   --streaming      按流式(running)渲染,而不是 settled
 *   --raw            额外打印伪文本(占位符形态),用于排查"哪一段被切走了"
 *
 * 依赖 jsdom 才能走"浏览器解析器"那一步(HTML 的真实解析);缺了会自动提示。
 */
import fs from 'node:fs'

const args = process.argv.slice(2)
const streaming = args.includes('--streaming')
const showRaw = args.includes('--raw')
const target = args.find((a) => !a.startsWith('--'))

if (target === undefined) {
  console.error('用法: node tools/inspect-render.mjs <session.jsonl|text.txt|-> [--streaming] [--raw]')
  process.exit(2)
}

let jsdom = null
try {
  jsdom = await import('jsdom')
} catch {
  console.error('⚠️  未安装 jsdom:HTML 会被当成纯文本(装上才走浏览器解析器):npm i -D jsdom')
}
if (jsdom !== null) globalThis.document = new jsdom.JSDOM('').window.document

let registration
globalThis.window = { __ModuleLoader__: { load: (value) => { registration = value } } }
new Function('window', fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))(globalThis.window)

const MARKDOWN_STUB = function MarkdownText() {}
const react = {
  // 与 React 一致:第三个参数之后的 children 会盖掉 props.children。
  createElement: (type, props, ...children) => ({
    type, props, children: children.length > 0 ? children : [].concat(props?.children ?? []),
  }),
  Fragment: Symbol.for('react.fragment'),
  useState: (init) => [init, () => {}],
  memo: (fn) => fn,
}
const mod = registration.factory((spec) => (spec === 'react' ? react : { MarkdownText: MARKDOWN_STUB }))

function readInput() {
  if (target === '-') return fs.readFileSync(0, 'utf8')
  const text = fs.readFileSync(target, 'utf8')
  if (!target.endsWith('.jsonl')) return text
  const rows = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  const last = rows.filter((e) => e.type === 'assistant/message').pop()
  if (last === undefined) throw new Error('这份 JSONL 里没有 assistant/message')
  return last.data.message.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
}

const source = readInput()

if (showRaw) {
  const pseudo = mod.__test.buildPseudo(source)
  console.log('=== 伪文本(HTML 已换成占位符)===\n' + pseudo.text)
  console.log('\n=== 槽位 ===')
  pseudo.slots.forEach((slot, i) => {
    console.log(`[${i}] <${slot.tag}> block=${slot.block === true} children=${slot.children.length}`)
  })
  console.log()
}

const view = mod.__test.BubbleAssistantNodeView({
  node: { data: { blocks: [{ kind: 'text', text: source }], status: streaming ? 'running' : 'settled' } },
  renderMessageImages: () => null,
})

const tags = []
const markdownTexts = []

;(function collect(el, depth = 0) {
  if (el === null || el === undefined || typeof el !== 'object' || depth > 32) return
  if (Array.isArray(el)) { for (const item of el) collect(item, depth); return }
  if (el.type === MARKDOWN_STUB) { markdownTexts.push(String(el.props.text)); return }
  if (typeof el.type === 'function') { collect(el.type(el.props), depth + 1); return }
  if (el.type !== react.Fragment) tags.push(String(el.type))
  for (const child of el.children ?? []) collect(child, depth + 1)
})(view)

function outline(el, depth = 0, out = []) {
  if (el === null || el === undefined || typeof el !== 'object' || depth > 32) return out
  if (Array.isArray(el)) { for (const item of el) outline(item, depth, out); return out }
  const pad = '  '.repeat(depth)
  if (el.type === MARKDOWN_STUB) {
    const text = String(el.props.text)
    out.push(`${pad}MarkdownText(${JSON.stringify(text.length > 54 ? text.slice(0, 54) + '…' : text)})`)
    return out
  }
  if (typeof el.type === 'function') {
    out.push(`${pad}<${el.type.name || 'Component'}>`)
    outline(el.type(el.props), depth + 1, out)
    return out
  }
  if (el.type === react.Fragment) { outline(el.children, depth, out); return out }
  out.push(`${pad}<${String(el.type)}>`)
  for (const child of el.children ?? []) outline(child, depth + 1, out)
  return out
}

console.log(`=== 渲染树(${streaming ? 'running/流式' : 'settled'}）===`)
console.log(outline(view).join('\n'))

console.log('\n=== 判据 ===')
const dangerous = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'button', 'input', 'svg']
console.log('元素种类            :', [...new Set(tags)].join(', ') || '(无)')
console.log('危险元素            :', tags.filter((t) => dangerous.includes(t)).join(', ') || '无')
console.log('markdown 片段数      :', markdownTexts.length)
console.log('尖括号源码漏进 markdown:', markdownTexts.some((t) => /<\/?[a-z][a-z0-9-]*(\s|>|\/)/i.test(t)) ? '⚠️ 有' : '无')
console.log('占位符漏出          :', markdownTexts.some((t) => t.includes('\uE000RPH')) ? '⚠️ 有' : '无')
