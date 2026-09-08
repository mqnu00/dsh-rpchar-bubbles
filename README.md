# rpchar-bubbles

DSH Web 客户端插件:把多角色扮演(narrator)的回复渲染成**每个角色各自的独立聊天气泡**。

## 机制

- 以 `priority: -1` 影子覆盖 `conversation.chat.node` slot 的 `assistant-step` 键(核心渲染器为默认优先级 0;同一键位最低优先级者生效,这是客户端 slot 的官方行为)。
- 流式(running)阶段渲染为单个气泡原文,避免流式拼接闪烁;定型(settled)后按角色分隔格式拆分为多个气泡。
- 运行时仅依赖统一基座播种的 `react`(零跨包运行时依赖),`/client` bundle 手写为官方 `window.__ModuleLoader__.load({ id, factory })` 惰性 CJS 格式。

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
# cordis.patch.yml 追加(insert 形式,普通 name 行不会新增条目):
# - insert:
#     - id: rpchar-bubbles
#       name: 'rpchar-bubbles'
```

本地开发时也可用 `file:` 安装(pnpm 软链到源码目录):

```sh
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

- `v0.1.0` — 首个发布版:影子覆盖 `assistant-step` 渲染器,支持 narrator 🎭 分角色格式、稳定取名、降级与中断标记。
