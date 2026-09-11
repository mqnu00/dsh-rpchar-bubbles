/**
 * rpchar-bubbles parse/color/mixed-render unit tests.
 *
 * 加载真实 bundle(在 container 里直接取 __test 挂点)。
 * 不依赖任何第三方包即可跑通;若环境里有 jsdom,会额外跑"浏览器解析器"那几组
 * 端到端用例(HTML 的合法性由浏览器负责,所以那部分必须用真实 DOM 验)。
 */
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'

let registration
globalThis.window = {
  __ModuleLoader__: {
    load: (value) => { registration = value },
  },
}

const bundleUrl = new URL('../lib/client.js', import.meta.url)
const bundleSource = await readFile(bundleUrl, 'utf8')
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
assert.ok(segs4[0].text.includes('直接开口'))

// 6. 收尾分隔线粘在头行同一行(模型常见输出):必须仍识别为角色头
const gluedTail = [
  '你按下通话键，听筒里传来温柔带笑的女声：',
  '',
  '────────────────────────────────────────',
  '🎭 **钱慈惜**（国际知名钢琴家）────────────────────────────────────────',
  '喂——是你呀。想听肖邦，还是我最近最爱弹的那一支？',
  '',
  '────────────────────────────────────────',
  '',
  '你靠在床头，窗外的雨声细密了起来。',
].join('\n')
const segs5 = parseSegments(gluedTail)
assert.ok(segs5 !== null, 'glued trailing divider must still parse as character header')
assert.equal(segs5.length, 3, 'expect narrator + character + narrator')
assert.equal(segs5[1].kind, 'character')
assert.equal(segs5[1].name, '钱慈惜')
assert.equal(segs5[1].occupation, '国际知名钢琴家')
assert.ok(segs5[1].text.includes('喂——是你呀'), 'dialogue preserved in character bubble')
assert.ok(!segs5[1].text.includes('你靠在床头'), 'trailing narration must NOT be swallowed')
assert.equal(segs5[2].kind, 'narrator')
assert.ok(segs5[2].text.includes('窗外的雨声'), 'trailing narration kept as narrator segment')

// 7. 分隔线+头+收尾分隔线全部粘在一行的旧预设示例:同样应解析
const oneLineBlock = '──────────────────────────────────────── 🎭 **Alice Thornwood** (古代语言学者) ────────────────────────────────────────\n你知道吗，这个词在古代语中其实意味着"升华"。\n────────────────────────────────────────\n\n壁炉的火光映在墙上。'
const segs6 = parseSegments(oneLineBlock)
assert.ok(segs6 !== null, 'one-line block must parse')
assert.equal(segs6.length, 2, 'expect character + narrator')
assert.equal(segs6[0].kind, 'character')
assert.equal(segs6[0].name, 'Alice Thornwood')
assert.equal(segs6[0].occupation, '古代语言学者')
assert.ok(segs6[0].text.includes('升华'), 'dialogue kept, closing divider not included in text')

// 8. 角色头后正文先出现、分隔线随后出现 → 分隔线是段边界,不得被当装饰线
const lateSep = [
  '开头叙述。',
  '---',
  '🎭 **钱慈惜**（钢琴家）',
  '内容直接跟在头行后面，没有装饰分隔线。',
  '第二行内容。',
  '---',
  '结尾叙述不该被卷进角色气泡。',
].join('\n')
const segs7 = parseSegments(lateSep)
assert.ok(segs7 !== null)
assert.equal(segs7.length, 3, 'late separator must close the character segment')
assert.equal(segs7[1].kind, 'character')
assert.equal(segs7[1].name, '钱慈惜')
assert.ok(segs7[1].text.includes('第二行内容'))
assert.ok(!segs7[1].text.includes('结尾叙述'), 'character bubble must not swallow the closing narration')
assert.equal(segs7[2].kind, 'narrator')
assert.ok(segs7[2].text.includes('结尾叙述'))

// 9. 无 🎭 的粗体标题(菜单/系统提示/卡牌名等)不是角色 → 整条降级为普通气泡
const menu = [
  '世界已加载完毕。GM 已上线。',
  '---',
  '**【地球OL】系统提示**',
  '> 世界档案载入完成。',
  '---',
  '**【开场1：办公室的余韵】**（默认起点）',
  '正文……',
  '---',
  '**【开场2：初探游戏界面】**',
  '正文……',
].join('\n')
assert.equal(parseSegments(menu), null, 'bold menu titles without 🎭 must not split')
const card = '**钱慈惜 · SR**\n*国际知名钢琴家*\n\n你用意念点击卡面……'
assert.equal(parseSegments(card), null, 'bold card header without 🎭 must not split')

// 10. 🎭 前缀仍为必需:即便行内含粗体名+括号职业
assert.equal(parseSegments('**Alice Thornwood** (古代语言学者)\n你好。'), null,
  'header without 🎭 emoji degrades to plain bubble')

// ── 11. 旁白段空行必须保留(曾经被整段丢掉 → 多段落并成一个软换行段) ──

const blankKeep = [
  '第一段。',
  '',
  '第二段。',
  '',
  '────────────────────────────────────────',
  '🎭 **A** (甲)',
  '────────────────────────────────────────',
  '台词。',
].join('\n')
assert.equal(parseSegments(blankKeep)[0].text, '第一段。\n\n第二段。',
  'narrator blank lines must survive (paragraph separation)')

// ── 纯函数:围栏切分 / dedent / 硬换行 ──────────────────────────────

const { splitFencedGroups, dedent, hardBreaks, setHardBreaks } = mod.__test

// 12. 代码围栏切成独立组(围栏里的 <tag> 只是代码,不能当 HTML 解析)
const fg = splitFencedGroups('前\n```html\n<div>x</div>\n```\n后')
assert.deepEqual(fg.map((g) => g.fence), [false, true, false], 'fence group split')
assert.equal(fg[1].lines.join('\n'), '```html\n<div>x</div>\n```', 'fenced source kept verbatim')

// 13. dedent:去掉公共前导空白(模型缩进 HTML 是常态,不然会被判成缩进代码块)
assert.equal(dedent('\n        生命 12/12\n\n        金币 30\n\n      ').trim(), '生命 12/12\n\n金币 30')
assert.equal(dedent('正文\n  第二行').trim(), '正文\n  第二行', 'relative indent preserved')
assert.equal(dedent('无缩进'), '无缩进')

// 14. hardBreaks:抄酒馆 simpleLineBreaks —— 相邻非空行之间补硬换行
assert.equal(hardBreaks('第一段。\n第二段。'), '第一段。 \\\n第二段。', 'single newline becomes a hard break')
assert.equal(hardBreaks('第一段。\n\n第二段。'), '第一段。\n\n第二段。', 'blank line unchanged (real paragraph)')
assert.equal(hardBreaks('> a\n> b'), '> a \\\n> b', 'blockquote lines hard-broken (人物卡档案)')
assert.equal(hardBreaks('- a\n- b'), '- a\n- b', 'list items untouched')
assert.equal(hardBreaks('# 标题\n- a'), '# 标题\n- a', 'heading untouched')
assert.equal(hardBreaks('| a | b |\n| - | - |'), '| a | b |\n| - | - |', 'table untouched')
assert.equal(hardBreaks('```\na\nb\n```'), '```\na\nb\n```', 'fenced code untouched')
assert.equal(hardBreaks('已带 \\\n下一行'), '已带 \\\n下一行', 'existing hard break not duplicated')
setHardBreaks(false)
assert.equal(hardBreaks('第一段。\n第二段。'), '第一段。\n第二段。', 'toggle can disable it')
setHardBreaks(true)

// ── 属性净化(白名单,不再用正则黑名单) ─────────────────────────────

const { reactProps, safeStyle, safeUrl, tables } = mod.__test

// 15. 事件属性 / 危险协议 / 非白名单属性
assert.equal(reactProps({ onclick: 'evil()' }).onclick, undefined, 'event handler dropped')
assert.equal(reactProps({ onerror: 'evil()' }).onerror, undefined)
assert.equal(reactProps({ href: 'javascript:alert(1)' }).href, undefined, 'javascript: href dropped')
assert.equal(reactProps({ href: 'java&#x73;cript:alert(1)' }).href, undefined, 'entity-encoded javascript: dropped')
assert.equal(reactProps({ href: 'java\tscript:alert(1)' }).href, undefined, 'whitespace-split javascript: dropped')
assert.equal(reactProps({ src: 'data:text/html;base64,xx' }).src, undefined, 'data:text/html dropped')
assert.equal(reactProps({ src: 'data:image/svg+xml;base64,xx' }).src, undefined, 'data:image/svg+xml dropped')
assert.equal(reactProps({ src: 'data:image/png;base64,AA' }).src, 'data:image/png;base64,AA', 'data:image/png kept')
assert.equal(reactProps({ 'data-x': '1' })['data-x'], undefined, 'non-whitelisted attribute dropped')
assert.equal(reactProps({ class: 'card' }).className, 'card', 'class → className')
assert.deepEqual(reactProps({ href: 'https://a.b' }).target, '_blank', 'links forced target=_blank')

// 16. style 白名单
assert.equal(safeStyle('position:fixed;color:red').position, undefined, 'position not allowed')
assert.equal(safeStyle('position:fixed;color:red').color, 'red', 'benign property kept')
assert.equal(safeStyle('display:ruby').display, undefined, 'unknown display value dropped')
assert.equal(safeStyle('background:url(http://evil/x)').background, undefined, 'url() dropped')
assert.equal(safeStyle('line-height:1.7').lineHeight, '1.7', 'camelCase conversion')
assert.equal(safeUrl('vbscript:x'), undefined)
assert.equal(safeUrl('mailto:a@b.c'), 'mailto:a@b.c')

// ── 片段拆分 / 渲染(用纯对象树,不需要 DOM) ────────────────────────

const { splitParts, tokenFor } = mod.__test
const el = (tag, attrs = {}, children = []) => ({
  kind: 'element', tag, attrs, children, block: tables.INLINE_TAGS[tag] !== 1,
})
const tx = (value) => ({ kind: 'text', value })

// 17. 块级槽位独占一行 → markdown / html / markdown 三段
const blockParts = splitParts('前文\n' + tokenFor(0) + '\n后文', [el('details', {}, [tx('正文')])])
assert.deepEqual(blockParts.map((p) => p.kind), ['markdown', 'html', 'markdown'])
assert.equal(blockParts[1].node.tag, 'details')

// 18. 行内槽位 → 整行合成一个行内混排片段(段落不会被拆开)
const inlineParts = splitParts('他说 ' + tokenFor(0) + ' 好', [el('b', {}, [tx('x')])])
assert.equal(inlineParts.length, 1, 'inline slot stays on its own line as one part')
assert.equal(inlineParts[0].kind, 'inline')
assert.deepEqual(inlineParts[0].items.map((i) => i.kind), ['markdown', 'html', 'markdown'])

// 19. 白名单外标签保留内容、DROP_WHOLE 连内容一起丢
const renderReact = {
  // React 的 createElement:第三个参数之后的 children 会盖掉 props.children;
  // 插件多数地方是 `createElement(tag, props)` + props.children,所以桩要两者都认。
  createElement: (type, props, ...children) => ({
    type,
    props,
    children: children.length > 0 ? children : [].concat(props?.children ?? []),
  }),
  Fragment: Symbol.for('react.fragment'),
  useState: (init) => [init, () => {}],
  memo: (fn) => fn,
}
const MARKDOWN_STUB = function MarkdownText() {}
const rmod = registration.factory((spec) => {
  if (spec === 'react') return renderReact
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return { MarkdownText: MARKDOWN_STUB }
  throw new Error(`unexpected require: ${spec}`)
})

function walk(el, out = [], depth = 0) {
  if (el === null || el === undefined || typeof el !== 'object' || depth > 20) return out
  if (Array.isArray(el)) { for (const item of el) walk(item, out, depth + 1); return out }
  out.push(el)
  let { children } = el
  if (typeof el.type === 'function' && el.type !== MARKDOWN_STUB) children = [el.type(el.props)]
  for (const child of children ?? []) walk(child, out, depth + 1)
  return out
}
const typesOf = (tree) => walk(tree).map((e) => e.type)
const markdownProps = (tree) => walk(tree).filter((e) => e.type === MARKDOWN_STUB).map((e) => e.props)
const ctx = { codeLabels: undefined, streaming: false }
// 渲染相关挂点必须取自 rmod(接真实桩的那份):mod 的 react 桩只返回字符串。
const { renderElement, renderInline } = rmod.__test

const tree = rmod.__test.renderElement(
  el('div', { onclick: 'evil()' }, [
    el('script', {}, [tx('alert(1)')]),
    el('b', {}, [tx('粗体')]),
    el('custom-thing', {}, [tx('保留内容')]),
  ]), ctx, 'k')
assert.ok(typesOf(tree).includes('b'), 'whitelisted tag rendered as a React element')
assert.ok(!typesOf(tree).includes('script'), 'script dropped with its content')
assert.ok(!typesOf(tree).includes('custom-thing'), 'unknown tag dropped')
assert.ok(markdownProps(tree).some((p) => p.text.includes('保留内容')), 'unknown tag keeps its children')
assert.equal(renderElement(el('div', {}, []), ctx, 'k').props.onclick, undefined, 'event props never passed')

// 20. 元素内部的文本回到 MarkdownText(= 双模的关键一步),并带 dedent/hardBreaks
const panel = rmod.__test.renderElement(
  el('details', {}, [
    el('summary', {}, [tx('状态')]),
    el('div', {}, [tx('\n        生命 12/12\n\n        金币 30\n      ')]),
  ]), ctx, 'k')
const panelMd = markdownProps(panel)
assert.ok(typesOf(panel).includes('details'), 'details rendered as a real React <details>')
assert.ok(panelMd.some((p) => p.text.includes('生命 12/12')), 'panel body goes through MarkdownText')
assert.ok(panelMd.every((p) => !p.text.startsWith(' ')), 'panel body dedented (no indent-code-block)')
assert.ok(panelMd.some((p) => !p.text.includes('<div')), 'no raw tag text fed to markdown')

// 21. 行内 markdown → React(行内容器里也能用)
assert.ok(typesOf(rmod.__test.renderInline('a **b** c')).includes('strong'))
assert.ok(typesOf(rmod.__test.renderInline('a `c` d')).includes('code'))

// 22. 源码守卫:不再有任何 innerHTML 注入面
assert.ok(!bundleSource.includes('dangerouslySetInnerHTML'),
  'bundle must not use dangerouslySetInnerHTML (guard)')
assert.ok(!/innerHTML\s*=/.test(bundleSource.replace(/template\.innerHTML/g, '')) ||
  !/document\.createElement\('div'\)[\s\S]{0,80}innerHTML/.test(bundleSource),
  'no HTML string injection besides the inert <template> parse')

// ── 浏览器解析器端到端(有 jsdom 才跑) ─────────────────────────────

let jsdom = null
try {
  jsdom = await import('jsdom')
} catch {
  console.log('ℹ️  未安装 jsdom:跳过"浏览器解析器"端到端用例(npm i -D jsdom 可启用)')
}

if (jsdom !== null) {
  globalThis.document = new jsdom.JSDOM('').window.document
  const { buildPseudo, htmlToTree, domToTree } = mod.__test

  // 23. HTML 交给浏览器:大小写 / 未闭合 / 错配 / 无引号属性 / 实体 全部容错
  const t1 = htmlToTree('<DETAILS><SUMMARY>x</SUMMARY>正文')
  assert.equal(t1[0].tag, 'details', 'uppercase tag normalized by the browser')
  assert.equal(t1[0].children[0].tag, 'summary', 'unclosed tags auto-closed by the browser')
  const t2 = htmlToTree('<div style=line-height:1.7>a</div>')
  assert.equal(t2[0].attrs.style, 'line-height:1.7', 'unquoted attribute parsed')
  const t3 = htmlToTree('<b><i>x</b></i>')
  assert.equal(t3[0].tag, 'b', 'misnested tags repaired by the browser')
  assert.equal(t3[0].children[0].tag, 'i')

  // 24. 面板正文里的 `---` / `🎭` 不再撕裂气泡(真实会话 c7a30426 的形态)
  const panelText = [
    '酒廊里油灯昏黄。',
    '────────────────────────────────────────',
    '🎭 **Bob Ironfist** (前军人)',
    '────────────────────────────────────────',
    '嗯。坐。',
    '',
    '<details><summary>世界资料 · 已激活</summary>',
    '<div style="line-height:1.7">',
    '',
    '**Ashport**：分为三区。',
    '',
    '---',
    '',
    '🎭 **守钟人教会** (秘密组织)',
    '',
    '**钟塔**：每天二十九响。',
    '',
    '</div></details>',
  ].join('\n')
  const pseudo = buildPseudo(panelText)
  assert.ok(!pseudo.text.includes('<details>'), 'HTML replaced by a placeholder before segment split')
  assert.ok(!pseudo.text.includes('钟塔'), 'panel body stays out of the pseudo text')
  assert.equal(pseudo.slots.length, 1, 'one block slot')
  const segsP = parseSegments(pseudo.text)
  assert.equal(segsP.length, 2, 'panel must NOT be torn by the inner --- / 🎭')
  assert.equal(segsP[1].kind, 'character')
  assert.ok(segsP[1].text.includes('\uE000RPH0\uE001'), 'placeholder carried into the segment')

  // 25. 端到端:面板是真 <details>,正文回 markdown 管线,脚本被丢
  const nodeOf = (status, text) => ({
    node: { data: { blocks: [{ kind: 'text', text }], status } },
    renderMessageImages: () => null,
  })
  const settled = rmod.__test.BubbleAssistantNodeView(nodeOf('settled', panelText))
  assert.ok(typesOf(settled).includes('details'), 'settled view renders a real <details> panel')
  assert.ok(typesOf(settled).includes('summary'), 'summary rendered as an element')
  const settledMd = markdownProps(settled)
  assert.ok(settledMd.some((p) => p.text.includes('**Ashport**')), 'panel body back on the markdown pipeline')
  assert.ok(settledMd.some((p) => p.text.includes('**钟塔**')), 'second paragraph of the panel rendered')
  assert.ok(!settledMd.some((p) => p.text.includes('<div')), 'no raw <div> text reaches markdown')
  assert.ok(!typesOf(settled).includes('script'), 'script dropped')

  const scripted = '前。\n<details><summary>x</summary><script>alert(1)</script>正文</details>\n后。'
  const sv = rmod.__test.BubbleAssistantNodeView(nodeOf('settled', scripted))
  assert.ok(!typesOf(sv).includes('script'), 'script inside a panel dropped')

  // 26. 句中行内 HTML:渲染成真正的行内元素,不显示字面标签
  const inlineView = rmod.__test.BubbleAssistantNodeView(nodeOf('settled',
    '叙述。\n────────────────────────────────────────\n🎭 **A** (甲)\n────────────────────────────────────────\n他说 <b>轻一点</b>，然后灯灭了。'))
  assert.ok(typesOf(inlineView).includes('b'), 'inline <b> in mid-sentence rendered as an element')
  assert.ok(!markdownProps(inlineView).some((p) => p.text.includes('<b>')), 'no literal <b> text')

  // 27. 代码围栏里的标签仍是源码(不被当 HTML)
  const fenced = '说明。\n```html\n<details><summary>x</summary></details>\n```\n\n<details><summary>y</summary>真面板</details>'
  const fv = buildPseudo(fenced)
  assert.equal(fv.slots.length, 1, 'only the real panel is a slot; the fenced sample is not')
  assert.ok(fv.text.includes('<details><summary>x</summary></details>'), 'fenced sample stays verbatim text')

  // 27b. 行内代码里的标签同样只是源码(浏览器不知道那是 markdown 行内代码)
  const inlineCode = buildPseudo('说明：`<details>` 是折叠标签，`<b>x</b>` 是粗体。')
  assert.equal(inlineCode.slots.length, 0, 'inline code with tags must NOT become elements')
  assert.ok(inlineCode.text.includes('`<details>`') && inlineCode.text.includes('`<b>x</b>`'),
    'inline code preserved verbatim')
  const mixedCode = buildPseudo('先 `a < b`，然后 <details><summary>s</summary>正文</details>')
  assert.equal(mixedCode.slots.length, 1, 'real panel still extracted alongside inline code')
  assert.ok(mixedCode.text.includes('`a < b`'), 'inline code kept when the line also has real HTML')

  // 28. 流式期间不拆(增量文本里的标签还不完整)
  const running = rmod.__test.BubbleAssistantNodeView(nodeOf('running', panelText))
  assert.ok(!typesOf(running).includes('details'), 'streaming view must not emit panels yet')
  assert.ok(markdownProps(running).every((p) => p.streaming === true), 'streaming stays a single markdown stream')

  // 29. 无 DOM 环境降级:整段走 markdown(最多"少一个框",不会满屏尖括号)
  const savedDocument = globalThis.document
  delete globalThis.document
  const noDom = buildPseudo('<details><summary>x</summary>\n\n正文\n\n</details>')
  assert.equal(noDom.slots.length, 0, 'no DOM → no slots')
  assert.ok(noDom.text.includes('<details>'), 'no DOM → text passed through untouched')
  globalThis.document = savedDocument

  // 30. 安全:实体编码的协议由浏览器解码后再校验(正则黑名单的经典绕过点)
  const dirty = '前。\n<div class="x"><a href="java&#x73;cript:alert(1)">x</a>' +
    '<img src="data:text/html;base64,AA" alt="i"><b>保留</b><script>alert(2)</script></div>\n后。'
  const dirtyView = rmod.__test.BubbleAssistantNodeView(nodeOf('settled', dirty))
  const dirtyNodes = walk(dirtyView)
  const anchors = dirtyNodes.filter((e) => e.type === 'a')
  const images = dirtyNodes.filter((e) => e.type === 'img')
  assert.equal(anchors.length, 1, 'anchor rendered')
  assert.equal(anchors[0].props.href, undefined,
    'entity-encoded javascript: is decoded by the DOM, then rejected by the whitelist')
  assert.equal(images.length, 1, 'img rendered')
  assert.equal(images[0].props.src, undefined, 'data:text/html rejected')
  assert.equal(anchors[0].props.class, undefined, 'class never leaked as a raw prop')
  assert.ok(typesOf(dirtyView).includes('b'), 'benign tag kept')
  assert.ok(!typesOf(dirtyView).includes('script'), 'script kept out')
}

// ── colorOf ────────────────────────────────────────────────────────────

assert.ok(typeof colorOf('Alice Thornwood') === 'string')
assert.ok(colorOf('Alice Thornwood').startsWith('#'))
assert.ok(colorOf('Alice Thornwood') !== colorOf('Bob Ironfist'), 'different names → different colors')

// ── 渲染冒烟:气泡文本必须经 MarkdownText 渲染 ─────────────────────────

const settledView = rmod.__test.BubbleAssistantNodeView(
  { node: { data: { blocks: [{ kind: 'text', text: full }], status: 'settled' } }, renderMessageImages: () => null })
const settledMd = markdownProps(settledView)
assert.ok(settledMd.length >= 3, 'narrator + 2 character bubbles all render markdown')
assert.ok(settledMd.every((p) => p.streaming !== true), 'settled markdown must not be in streaming mode')
assert.ok(settledMd.some((p) => p.text.includes('小酒馆')), 'narrator text routed through MarkdownText')
assert.ok(settledMd.some((p) => p.text.includes('升华')), 'character text routed through MarkdownText')

const runningView = rmod.__test.BubbleAssistantNodeView(
  { node: { data: { blocks: [{ kind: 'text', text: '流式中的 **加粗** 文本' }], status: 'running' } }, renderMessageImages: () => null })
const runningMd = markdownProps(runningView)
assert.ok(runningMd.length >= 1, 'streaming text renders markdown')
assert.ok(runningMd.every((p) => p.streaming === true), 'running markdown must be in streaming mode')

// t 缺席:codeLabels 允许为 undefined(组件内部有默认文案)
assert.equal(rmod.__test.codeLabelsOf(undefined), undefined)
const tStub = (key) => `t:${key}`
assert.deepEqual(rmod.__test.codeLabelsOf(tStub), { copyLabel: 't:copy', copiedLabel: 't:copied' })

console.log('✅ all rpchar-bubbles tests passed')
