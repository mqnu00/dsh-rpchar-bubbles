# rpchar-bubbles

DSH Web 客户端插件:把多角色扮演(narrator)的回复渲染成**每个角色各自的独立聊天气泡**。

单纯用于聊天也可以，我觉得比默认的显示舒服很多，不如查看 thinking 不会直接出现一大截导致收都收不回去。

## 机制

- 以 `priority: -1` 影子覆盖 `conversation.chat.node` slot 的 `assistant-step` 键(核心渲染器为默认优先级 0;同一键位最低优先级者生效,这是客户端 slot 的官方行为)。
- 流式(running)阶段渲染为单个气泡的流式 markdown,避免流式拼接闪烁;定型(settled)后按角色分隔格式拆分为多个气泡。
- 气泡文本(叙述/角色对话/降级气泡)一律经基座播种的 `MarkdownText`(`@deepseek-ai/dsh-client-ui-primitives`,与核心聊天同款)渲染,markdown 显示为渲染结果而非原文;代码块复制按钮文案跟随 `t` 标准 seat,缺席时用组件默认文案。
- 酒馆式 **markdown + HTML 双模**渲染(定型后):气泡文本里的 HTML 由**浏览器自己的解析器**解析
  (`document.createElement('template')` + `innerHTML`,不 attach 到文档 → 不执行脚本、不加载资源),
  再映射成**白名单 React 元素**;元素内部的文本**回到 `MarkdownText`** —— 于是 `<details>` 是真折叠面板、
  面板正文里的 markdown 照常渲染、句中行内 HTML(`<b>`/`<span style>`)也不再显示成字面标签。
  标签容错(大小写/属性引号/跨行标签/错配闭合/实体/未闭合补全)全部由浏览器负责,插件不写 HTML 状态机。
- **不做 HTML 注入**:不拼 HTML 字符串、不做 innerHTML 注入、不需要 DOMPurify(基座里也没有)。
  安全靠三件事:标签白名单(表外的丢标签留内容)、属性白名单(`on*` 永不接、`href`/`src` 过协议校验、
  `style` 过属性白名单)、以及 React 的自动转义。单测里有"包内不得出现 innerHTML 注入"的守卫断言。
- **不确定性下的失败方向**:解析异常 / 无 DOM 环境 / 超长超深 → 退回 `MarkdownText`(最多"少一个框"),
  绝不"满屏尖括号"。模型输出的长尾无法穷举,所以设计的是"失败时最差长什么样"。
- 分泡泡与 HTML 的顺序:先把 HTML 换成占位符再跑 `parseSegments`。否则面板正文里的 `---`、`────`、
  `🎭` 会被当成段边界,把 `<details>` 撕成两半(两半都不完整 → 双双显示源码)。
- 引用块/整段换行保真:抄酒馆的 `simpleLineBreaks`,相邻非空行之间补硬换行(行尾反斜杠),让"一行一句"的
  输出各占一行;列表/标题/表格/代码围栏不补。该行为对整条消息生效(酒馆亦然),需要关掉时改
  `lib/client.js` 里的 `HARD_BREAK_SINGLE_NEWLINES`。
- 面板正文缩进会被 dedent 掉:模型常把 HTML 缩进 6~8 个空格,而 CommonMark 的 4 空格规则会把这类文本
  判成"缩进代码块",面板正文会整块变灰(酒馆同样会踩这个坑)。
- 运行时仅依赖统一基座播种的 `react` 与 `@deepseek-ai/dsh-client-ui-primitives`(均为 seed word,零跨包动态依赖),`/client` bundle 手写为官方 `window.__ModuleLoader__.load({ id, factory })` 惰性 CJS 格式。
- 引用块换行保真:模型常把"人物卡档案"这类面板写成连续 `>` 行且行间无空行,CommonMark 会把它们合并成一个引用段落、把软换行折叠成空格,导致整块内容连排。定型后渲染会给紧邻的 `>` 行行尾补硬换行(反斜杠),让每行各占一行;空 `>` 行(另起一段)不补,非引用文本不受影响。

## 依赖的角色回复格式(narrator 预设已按此输出)

```
叙述文本……
────────────────────────────────────────
🎭 **角色名** (职业)
────────────────────────────────────────

角色对话……

────────────────────────────────────────
🎭 **另一个角色** (职业)
────────────────────────────────────────
```

未匹配该格式的回复自动降级为普通气泡。

## 示例

<img width="878" height="868" alt="image" src="https://github.com/user-attachments/assets/11f19525-ab14-4cfd-a6bc-9584abc0d5e4" />


## 安装到 profile

```sh
dsh plugin --profile rpchar-test add https://github.com/mqnu00/dsh-rpchar-bubbles.git
```

本包声明了 `dsh.bundle.patch`(`cordis.patch.yml`,内含 insert 条目),`add` 会自动把插件挂进 profile 的 bundles layer,无需手动改 patch。`file:` 安装时 pnpm 会复制内容,重新 `add` 前(或 `remove` 后再 `add`)才能拿到源码新改动:

```sh
dsh plugin --profile rpchar-test remove rpchar-bubbles
dsh plugin --profile rpchar-test add file:/path/to/dsh-rpchar-bubbles
```

> 修改 host 半或 bundle 后需把 `lib/` 同步到 profile 包目录并重启实例。

## 测试

```sh
node test/parse.test.mjs            # 解析/取色/混合渲染单测(直接加载真实 bundle)
npm i -D jsdom                      # 可选:装上才会跑"浏览器解析器"那组端到端用例
```

没装 jsdom 也能跑(会打印一行提示并跳过 DOM 相关用例),但 HTML 的合法判定本来就交给浏览器,
所以**强烈建议装上**。

## 排查"面板这次又没渲染出来"

模型输出是长尾分布,别猜,直接看渲染树:

```sh
node tools/inspect-render.mjs <session.jsonl|text.txt|-> [--streaming] [--raw]
#   <session.jsonl>  dsh 会话导出的明文 JSONL(自动取最后一条 assistant 消息)
#   --streaming      按流式渲染看
#   --raw            打印伪文本(HTML 已换成占位符)与槽位,用于定位"哪一段被切走了"
node tools/inspect-render.mjs - --raw < 某段回复.txt
```

## 文件

- `lib/client.js` — 手写 client bundle(源码即产物)
- `lib/index.js` — host 半入口(空 apply)
- `test/parse.test.mjs` — 单测(经 `__test` 挂点覆盖真实代码)
- `tools/inspect-render.mjs` — 把一段回复喂进插件、打印渲染树(排查用)

## 版本

- `v0.1.6` — **markdown + HTML 双模**:HTML 解析交给浏览器(`<template>`),元素变白名单 React 元素、
  元素内文本回 `MarkdownText`;删掉正则净化与 HTML 注入;修旁白段空行丢失;HTML 占位符先于 `parseSegments`
  (面板不再被正文里的 `---`/`🎭` 撕裂);面板正文 dedent;抄酒馆 `simpleLineBreaks` 补硬换行。
- `v0.1.5` — HTML 提取支持缩进与嵌套:行首判定改为"换行至此标签前仅空白";进入顶层块后所有非空元素都参与配平,修复嵌套 `<li><details>`/`<div>` 导致外层 `<details>` 被内层 `</details>` 提前闭合、后续内容漏成原文的问题;顶层 `<br>` 单独成 HTML 片段,不再以原文显示。
- `v0.1.4` — 引用块换行保真:连续 `>` 行且无空行时在行尾补硬换行,避免"人物卡档案"这类整块引用被折叠成一段连排文字。
- `v0.1.3` — 酒馆式 HTML 渲染:气泡文本中独占一行且完整闭合的块级 HTML(如 `<details>` 状态面板)原样渲染(净化后经 `dangerouslySetInnerHTML`);代码围栏内标签不误判;行内标签不拆行;流式期间不启用。
- `v0.1.2` — 解析器收紧 + 容错:角色头必须带 🎭(纯 `**粗体标题**` 菜单/UI 不再误拆);头行允许粘着收尾分隔线(兼容 `──── 🎭 **名** (职业) ────` 单行块);角色头后正文先出现时,后续分隔线一律按段边界处理,不再被当装饰线吞掉导致叙述卷进角色气泡。
- `v0.1.1` — 气泡文本改经基座播种的 `MarkdownText` 渲染,markdown 显示渲染结果而非原文;声明 `dsh.bundle`,`dsh plugin add` 自动挂进 profile layer。
- `v0.1.0` — 首个发布版:影子覆盖 `assistant-step` 渲染器,支持 narrator 🎭 分角色格式、稳定取名、降级与中断标记。
