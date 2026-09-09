# rpchar-bubbles

DSH Web 客户端插件:把多角色扮演(narrator)的回复渲染成**每个角色各自的独立聊天气泡**。

单纯用于聊天也可以，我觉得比默认的显示舒服很多，不如查看 thinking 不会直接出现一大截导致收都收不回去。

## 机制

- 以 `priority: -1` 影子覆盖 `conversation.chat.node` slot 的 `assistant-step` 键(核心渲染器为默认优先级 0;同一键位最低优先级者生效,这是客户端 slot 的官方行为)。
- 流式(running)阶段渲染为单个气泡的流式 markdown,避免流式拼接闪烁;定型(settled)后按角色分隔格式拆分为多个气泡。
- 气泡文本(叙述/角色对话/降级气泡)一律经基座播种的 `MarkdownText`(`@deepseek-ai/dsh-client-ui-primitives`,与核心聊天同款)渲染,markdown 显示为渲染结果而非原文;代码块复制按钮文案跟随 `t` 标准 seat,缺席时用组件默认文案。
- 酒馆式 HTML:定型后,气泡文本里"独占一行、完整闭合的顶层元素"(如模型输出的 `<details>` 状态面板)会作为 HTML 原样渲染(经 `dangerouslySetInnerHTML`,先净化:删 `script`/`style`/`iframe`/`form` 整段、`on*` 事件属性与 `javascript:` 链接);其余文本继续走 `MarkdownText`。支持带前导空格缩进的标签与嵌套结构(`<ul>`/`<li>`/内层 `<details>`):行首判定看"换行到此标签前是否只有空白",一旦进入顶层块,内部所有非空元素都参与栈配平,不会因缩进/同行而被丢出、导致外层 `<details>` 被内层 `</details>` 提前闭合;顶层的 `<br>` 单独成一小块,不会以原文显示。代码围栏内的标签不会误判,句中的行内标签(如 `<b>`)不拆行、留在 markdown 里按原文显示,流式期间不启用 HTML 渲染。
- 引用块换行保真:模型常把"人物卡档案"这类面板写成连续 `>` 行且行间无空行,CommonMark 会把它们合并成一个引用段落、把软换行折叠成空格,导致整块内容连排。定型后渲染会给紧邻的 `>` 行行尾补硬换行(反斜杠),让每行各占一行;空 `>` 行(另起一段)不补,非引用文本不受影响。
- 运行时仅依赖统一基座播种的 `react` 与 `@deepseek-ai/dsh-client-ui-primitives`(均为 seed word,零跨包动态依赖),`/client` bundle 手写为官方 `window.__ModuleLoader__.load({ id, factory })` 惰性 CJS 格式。

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
node test/parse.test.mjs   # 解析/取色单测(直接加载真实 bundle)
```

## 文件

- `lib/client.js` — 手写 client bundle(源码即产物)
- `lib/index.js` — host 半入口(空 apply)
- `test/parse.test.mjs` — 单测(经 `__test` 挂点覆盖真实代码)

## 版本

- `v0.1.5` — HTML 提取支持缩进与嵌套:行首判定改为"换行至此标签前仅空白";进入顶层块后所有非空元素都参与配平,修复嵌套 `<li><details>`/`<div>` 导致外层 `<details>` 被内层 `</details>` 提前闭合、后续内容漏成原文的问题;顶层 `<br>` 单独成 HTML 片段,不再以原文显示。
- `v0.1.4` — 引用块换行保真:连续 `>` 行且无空行时在行尾补硬换行,避免"人物卡档案"这类整块引用被折叠成一段连排文字。
- `v0.1.3` — 酒馆式 HTML 渲染:气泡文本中独占一行且完整闭合的块级 HTML(如 `<details>` 状态面板)原样渲染(净化后经 `dangerouslySetInnerHTML`);代码围栏内标签不误判;行内标签不拆行;流式期间不启用。
- `v0.1.2` — 解析器收紧 + 容错:角色头必须带 🎭(纯 `**粗体标题**` 菜单/UI 不再误拆);头行允许粘着收尾分隔线(兼容 `──── 🎭 **名** (职业) ────` 单行块);角色头后正文先出现时,后续分隔线一律按段边界处理,不再被当装饰线吞掉导致叙述卷进角色气泡。
- `v0.1.1` — 气泡文本改经基座播种的 `MarkdownText` 渲染,markdown 显示渲染结果而非原文;声明 `dsh.bundle`,`dsh plugin add` 自动挂进 profile layer。
- `v0.1.0` — 首个发布版:影子覆盖 `assistant-step` 渲染器,支持 narrator 🎭 分角色格式、稳定取名、降级与中断标记。
