# rpchar-bubbles

DSH Web 客户端插件:把多角色扮演(narrator)的回复渲染成**每个角色各自的独立聊天气泡**。

单纯用于聊天也可以，我觉得比默认的显示舒服很多，不如查看 thinking 不会直接出现一大截导致收都收不回去。

## 机制

- 以 `priority: -1` 影子覆盖 `conversation.chat.node` slot 的 `assistant-step` 键(核心渲染器为默认优先级 0;同一键位最低优先级者生效,这是客户端 slot 的官方行为)。
- 流式(running)阶段渲染为单个气泡的流式 markdown,避免流式拼接闪烁;定型(settled)后按角色分隔格式拆分为多个气泡。
- 气泡文本(叙述/角色对话/降级气泡)一律经基座播种的 `MarkdownText`(`@deepseek-ai/dsh-client-ui-primitives`,与核心聊天同款)渲染,markdown 显示为渲染结果而非原文;代码块复制按钮文案跟随 `t` 标准 seat,缺席时用组件默认文案。
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

- `v0.1.1` — 气泡文本改经基座播种的 `MarkdownText` 渲染,markdown 显示渲染结果而非原文;声明 `dsh.bundle`,`dsh plugin add` 自动挂进 profile layer。
- `v0.1.0` — 首个发布版:影子覆盖 `assistant-step` 渲染器,支持 narrator 🎭 分角色格式、稳定取名、降级与中断标记。
