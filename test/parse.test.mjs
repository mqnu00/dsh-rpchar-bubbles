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

// 6. 收尾分隔线粘在头行同一行(模型常见输出):必须仍识别为角色头
//    例(真实会话 22:13 形态):
//      🎭 **钱慈惜**（国际知名钢琴家）────────────────────────────────────────
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
//    吞掉(吞掉会把后续叙述卷进角色气泡;修前 segs 只有 2 段,修后 3 段)
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

// ── 块级 HTML 提取/净化(酒馆式渲染) ────────────────────────────────

const { splitHtmlParts, sanitizeHtml } = mod.__test

// 11. 叙述文本 + <details> 状态面板:切成 text/html/text,面板内容完整保留
const statusHtml = [
  '你坐在床边，指尖还残留着方才点击卡面时那种酥麻的触电感。',
  '',
  '选择你的下一步行动：',
  '1. 打开【任务】面板，查看并接取那个带红点的新任务。',
  '',
  '<details>',
  '<summary><b><font color="#FFD700">【廖泽晖状态栏】</font></b></summary>',
  '<div style="background-color:#1e1e1e; color:#ffffff; border-radius:10px; padding:15px;">',
  '<ul style="list-style-type: none;"><li><b>姓名:</b> 廖泽晖</li></ul>',
  '</div>',
  '</details>',
  '',
  '窗外的天色渐渐染上橘红，那条通往河市的公路在地图上安静地亮着。',
].join('\n')
const hp = splitHtmlParts(statusHtml)
assert.ok(hp !== null, 'details panel must be extracted as html part')
assert.equal(hp.length, 3, 'expect text + html + text')
assert.equal(hp[0].kind, 'text')
assert.ok(hp[0].text.includes('你坐在床边'), 'leading narration stays markdown text')
assert.ok(!hp[0].text.includes('<details>'), 'panel not duplicated in text part')
assert.equal(hp[1].kind, 'html')
assert.ok(hp[1].html.startsWith('<details>'), 'html part starts at <details>')
assert.ok(hp[1].html.includes('<font color="#FFD700">') && hp[1].html.includes('</details>'),
  'nested inner tags preserved inside the html part')
assert.equal(hp[2].kind, 'text')
assert.ok(hp[2].text.includes('窗外的天色'), 'trailing narration stays markdown text')

// 12. 代码围栏内的标签不参与提取;围栏原文留在文本块里
const fenceHtml = '先说明。\n\n```html\n<div>围栏内的 div</div>\n```\n\n<details>\n<summary>状态</summary>\n</details>\n\n收尾。'
const fp = splitHtmlParts(fenceHtml)
assert.ok(fp !== null)
assert.equal(fp.length, 3, 'fence content untouched, real panel still extracted')
assert.ok(fp[0].kind === 'text' && fp[0].text.includes('```html') && fp[0].text.includes('围栏内的 div'),
  'fenced html sample stays inside the markdown text part')
assert.ok(fp[1].kind === 'html' && fp[1].html === '<details>\n<summary>状态</summary>\n</details>')

// 13. 行内标签(句中 <b>)不是块级 HTML → 不提取,整体退化为 markdown
assert.equal(splitHtmlParts('他是 <b>最强</b> 的剑士。'), null, 'inline tags must not split')
// 14. 未闭合的标签块 → 不提取(避免吞掉后半段正文)
assert.equal(splitHtmlParts('<details>\n<summary>x</summary>\n后面的正文'), null, 'unclosed block must not split')
// 15. 纯文本或只有空元素
assert.equal(splitHtmlParts('普通文本，没有标签。'), null)
assert.equal(splitHtmlParts('普通文本 <br> 一行。'), null, 'bare void tags alone are not blocks')

// 16. 净化:删 script/style/iframe/form 整段、事件属性、javascript: 链接
const dirty = '<script>alert(1)</script>前<style>body{}</style>中' +
  '<div onclick="evil()" href="javascript:alert(2)">x<img src=x onerror=alert(3)></div>' +
  '<iframe src="https://x"></iframe>后'
const clean = sanitizeHtml(dirty)
assert.ok(!/<\/?script/i.test(clean) && !/alert\(1\)/.test(clean), 'script element removed with its body')
assert.ok(!/<\/?style/i.test(clean) && !/body\{\}/.test(clean), 'style element removed with its body')
assert.ok(!/onclick|onerror/i.test(clean), 'event handler attributes removed')
assert.ok(!/javascript\s*:/i.test(clean), 'javascript: scheme removed')
assert.ok(!/<iframe/i.test(clean), 'iframe removed')
assert.ok(clean.includes('<div') && clean.includes('>x<img src=x') && clean.endsWith('后'),
  'benign structure kept')
assert.ok(clean.includes('中'), 'text between stripped elements preserved')

// ── 引用块内换行保真(人物卡档案这类整块引用被折叠成一段) ──────────────

const { hardBreakBlockquotes } = mod.__test

// 18. 连续 `>` 行、无空行 → 每行补硬换行;空 `>` 行(另起一段)不补
const cardQuote = [
  '> **【人物卡档案】**',
  '> ───────────────',
  '> 姓名：钱慈惜',
  '> 稀有度：SR（超稀有级）',
  '> 年龄：40',
  '',
  '> 新段落：xx',
].join('\n')
const hb = hardBreakBlockquotes(cardQuote)
const hbLines = hb.split('\n')
assert.ok(hbLines[0] === '> **【人物卡档案】** \\', 'first quote line gets a hard break')
assert.ok(hbLines[2] === '> 姓名：钱慈惜 \\', 'consecutive quote lines all hard-broken')
assert.ok(hbLines[4] === '> 年龄：40', 'line before a blank line keeps its soft end (paragraph ends)')
assert.ok(hbLines[6] === '> 新段落：xx', 'new paragraph unaffected')

// 19. 非引用文本不受影响;单行引用(下一行不是 `>`)不补
assert.equal(hardBreakBlockquotes('普通段\n> 你好\n\n后续。'), '普通段\n> 你好\n\n后续。')
// 20. 已带硬换行的引用行不重复补
assert.equal(hardBreakBlockquotes('> a \\\n> b'), '> a \\\n> b')

// ── 缩进/嵌套的 <details> 面板(游荡者 那条消息的真实形态) ─────────────

// 21. 面板内 `<ul><li>` 与嵌套 `<details>` 紧跟在前一行、且带前导空格缩进;
//     此前 atLineStart 只看前一字符是否为换行,导致这些标签被丢出配平栈、
//     外层 <details> 被内层 </details> 提前闭合,剩余内容以原文漏出。
const nestedPanel = [
  '前文。你心意已决。',
  '',
  '<br>',
  '<details>',
  '<summary><b><font color="#FF69B4">【在场其他人物】</font></b></summary>',
  '<div style="background-color:#1e1e1e; color:#ffffff; padding:15px;">',
  '      <ul>',
  '        <li><details><summary><b><font color="#FFB6C1">人物A</font></b></summary>',
  '          <div style="border-left: 2px solid #FFB6C1; margin-top: 10px;">',
  '            <p><b>状态:</b> 非在场。</p>',
  '            <p><b>位置:</b> 河市。</p>',
  '          </div></details></li>',
  '        <li><details><summary><b><font color="#FFB6C1">人物B</font></b></summary>',
  '          <div style="border-left: 2px solid #FFB6C1;">',
  '            <p><b>状态:</b> 敌方。</p>',
  '            <p><b>位置:</b> 前方约20米。</p>',
  '          </div></details></li>',
  '      </ul>',
  '</div>',
  '</details>',
  '',
  '后文。天色已晚。',
].join('\n')
const np = splitHtmlParts(nestedPanel)
assert.ok(np !== null)
assert.equal(np.length, 4, 'expect text + <br> + panel + text')
assert.equal(np[0].kind, 'text')
assert.ok(np[0].text.includes('前文'), 'leading narration is markdown')
assert.equal(np[1].kind, 'html')
assert.equal(np[1].html, '<br>', 'standalone <br> rendered as its own html fragment, not raw text')
assert.equal(np[2].kind, 'html')
assert.equal(np[2].html.split('<details>').length - 1, 3, 'outer + 2 nested <details> all inside the panel')
assert.equal(np[2].html.split('</details>').length - 1, 3, 'all </details> matched inside the same panel')
assert.ok(np[2].html.includes('人物B') && np[2].html.includes('前方约20米'), 'second nested character fully kept')
assert.ok(!np[2].html.includes('<li><details><summary><b>人物B'.replace('<summary>', '')), 'no unbalanced leftover')
assert.equal(np[3].kind, 'text')
assert.ok(np[3].text.includes('后文'), 'trailing narration is markdown')

// 22. 面板后没有 <br>,只有面板与尾文:仍应只有 text+panel+text
const simplePanel = '开头。\n\n<details>\n<summary>标题</summary>\n</details>\n\n末尾。'
const sp = splitHtmlParts(simplePanel)
assert.equal(sp.length, 3)
assert.equal(sp[0].kind, 'text')
assert.equal(sp[1].kind, 'html' && 'html')
assert.ok(sp[1].html === '<details>\n<summary>标题</summary>\n</details>')
assert.equal(sp[2].kind, 'text')

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

// 17. 渲染冒烟:settled 消息中的面板经 dangerouslySetInnerHTML 输出;流式期间不启用
function collectHtml(el, out = [], depth = 0) {
  if (el === null || el === undefined || typeof el !== 'object' || depth > 14) return out
  if (Array.isArray(el)) {
    for (const item of el) collectHtml(item, out, depth + 1)
    return out
  }
  if (el.props && el.props.dangerouslySetInnerHTML) out.push(el.props.dangerouslySetInnerHTML.__html)
  let { children } = el
  if (typeof el.type === 'function') children = [el.type(el.props)]
  for (const child of children ?? []) collectHtml(child, out, depth + 1)
  return out
}
const settledHtmlView = rmod.__test.BubbleAssistantNodeView(nodeOf('settled', statusHtml))
const htmlOut = collectHtml(settledHtmlView)
assert.ok(htmlOut.length >= 1, 'settled view must emit an html panel')
assert.ok(htmlOut[0].includes('<details>') && htmlOut[0].includes('</details>'), 'panel rendered via innerHTML')
const settledHtmlMd = collectMarkdown(settledHtmlView)
assert.ok(settledHtmlMd.length >= 2, 'markdown text parts still rendered alongside html')
assert.ok(settledHtmlMd.some((p) => p.text.includes('你坐在床边')), 'leading markdown intact')
const runningHtmlView = rmod.__test.BubbleAssistantNodeView(nodeOf('running', statusHtml))
assert.equal(collectHtml(runningHtmlView).length, 0, 'streaming view must not emit html panels yet')
assert.ok(collectMarkdown(runningHtmlView).every((p) => p.streaming === true), 'streaming stays single markdown stream')

console.log('✅ all rpchar-bubbles parse/color tests passed')