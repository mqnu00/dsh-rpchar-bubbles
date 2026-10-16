/**
 * rpchar-bubbles — 多角色扮演独立气泡 UI (client 插件)
 *
 * 以 priority:-1 影子覆盖 conversation.chat.node 下核心的 'assistant-step'
 * 渲染器:把 narrator(旁白)按 🎭 **角色名** (职业) + ─── 分隔线格式输出的
 * 回复,拆成叙述 + 每个角色各自独立的聊天气泡。
 *
 * 手写 bundle(零构建依赖):格式与官方 client 包一致
 * (window.__ModuleLoader__.load({ id, factory })),运行时仅依赖统一基座
 * 播种的 react 与 @deepseek-ai/dsh-client-ui-primitives(核心聊天的
 * MarkdownText 即来自后者,气泡文本用它渲染,markdown 不再显示原文)。
 *
 * ── markdown + HTML 双模渲染(酒馆式) ────────────────────────────────
 * 基座的 MarkdownText 对 mdast 的 `html` 节点是 `case "html": return n.value`
 * (把 HTML 源码当文本子节点),所以 raw HTML 必须由本插件自己变成 React 元素。
 *
 * 做法与酒馆(SillyTavern: showdown + DOMPurify)等价,但不引入任何依赖:
 *   1. 整段文本先按代码围栏切成 [围栏段|普通段](围栏里的 `<tag>` 只是代码);
 *   2. 普通段交给**浏览器自己的 HTML 解析器**
 *      (`document.createElement('template')` + `innerHTML`,不 attach 到文档
 *      → 不执行脚本、不发起资源请求),拿到 DOM 子树;
 *   3. 块级元素换成"独占一行"的占位符、行内元素原地内联,拼成"伪文本";
 *      伪文本才交给 parseSegments(🎭 分泡泡)与 markdown 段落判定;
 *   4. 渲染时:文本 → MarkdownText(**HTML 元素内部的文本也回到 markdown 管线**,
 *      这就是"双模"),元素 → 白名单 React 元素(React 自动转义,不拼 HTML 字符串、
 *      不做 innerHTML 注入、不需要 DOMPurify)。
 *      —— 包内不允许出现 `dangerously...SetInnerHTML` 这个名字,单测里有守卫断言。
 * 于是 <details> 是真折叠面板、面板正文的 markdown 照常渲染、句中行内 HTML 也不漏;
 * 而 HTML 的容错(大小写/属性引号/跨行标签/错配闭合/实体/未闭合补全)全部由
 * 浏览器负责 —— 插件不写 HTML 状态机。
 *
 * 失败方向(不确定输出无法穷举,所以设计的是"失败时最差长什么样"):
 *   白名单外的标签丢标签留内容、解析异常退回 MarkdownText、无 DOM 环境整段走 markdown
 *   —— 最多"少一个框",绝不"满屏尖括号"。
 */
window.__ModuleLoader__.load({
  id: "rpchar-bubbles",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var createElement = react.createElement;
    var Fragment = react.Fragment;
    var useState = react.useState;
    var memo = react.memo;
    /** 核心聊天同款 markdown 渲染器(基座播种,streaming 模式为增量解析)。 */
    var MarkdownText = primitives.MarkdownText;

    exports.name = "rpchar-bubbles";

    // ── 角色回复格式解析 ─────────────────────────────────────────────
    // 例:
    //   叙述文本……
    //   ────────────────────────────────────────
    //   🎭 **Alice Thornwood** (古代语言学者)
    //   ────────────────────────────────────────
    //   对话文本……
    //   ────────────────────────────────────────
    //   🎭 **Bob Ironfist** (前军人)
    //   ... ...
    //
    // 宽松容错两点(模型输出常见偏差):
    // 1. 头行必须带 🎭 —— 仅 `**粗体标题**`(菜单/UI/卡牌名)不是角色,不拆分;
    // 2. 头行允许粘着收尾分隔线(预设一度教的是 `──── 🎭 **名** (职业) ────`
    //    单行块),也允许行首自带分隔线,匹配前不再要求"行尾必须是职业括号"。

    var GLUE_RE = /[─━═\-—–_]{3,}\s*$/; // 头行自身带上的收尾分隔线
    var HEADER_RE = /^(?:[─━═\-—–_]{3,}\s*)?\u{1F3AD}\s*\*\*([^*]+)\*\*\s*(?:[（(]([^)）]*)[)）])?(?:\s*[─━═\-—–_]{3,})?\s*$/u;
    var SEPARATOR_RE = /^[─━═\-—–_]{3,}\s*$/;

    /** 按角色分隔格式把一段文本切分成叙述 + 角色段。找不到角色头时返回 null。 */
    function parseSegments(text) {
      var lines = String(text).split(/\r?\n/);
      var segments = []; // { kind:'narrator' } | { kind:'character', name, occupation, lines }
      var current = null;
      var sawCharacter = false;
      var expectDivider = false; // 角色头后、正文前的那条装饰分隔线

      function flush() {
        if (current !== null) {
          if (current.lines.some(function (l) { return l.trim() !== ''; })) {
            segments.push(current);
          }
          current = null;
        }
        expectDivider = false;
      }

      function pushNarratorLine(line) {
        if (current === null || current.kind !== 'narrator') {
          flush();
          current = { kind: 'narrator', lines: [] };
        }
        current.lines.push(line);
      }

      function pushCharacterLine(match, line) {
        if (current === null || current.kind !== 'character' || current.name !== match[1]) {
          flush();
          current = { kind: 'character', name: match[1].trim(), occupation: match[2] ? match[2].trim() : '', lines: [] };
          sawCharacter = true;
          // 头行若已自带收尾分隔线(粘连格式),装饰线已经内联,无需再期待下一行;
          // 标准三行格式的头行以职业括号收尾,仍期待紧随的装饰分隔线。
          expectDivider = !GLUE_RE.test(line);
        }
        current.lines.push(line);
        // 只有实际内容行才结束“期待装饰分隔线”状态;
        // 头部行本身(空字符串)必须保留该状态,让紧随的装饰分隔线归入角色段。
        if (line !== '') expectDivider = false;
      }

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var header = line.match(HEADER_RE);
        if (header !== null) {
          pushCharacterLine(header, '');
          continue;
        }
        if (SEPARATOR_RE.test(line)) {
          if (current !== null && current.kind === 'character' && expectDivider) {
            // 角色头后的装饰分隔线:保留在角色段内
            expectDivider = false;
          } else {
            // 正文与角色段之间的分隔线:结束当前段
            flush();
          }
          continue;
        }
        if (current !== null && current.kind === 'character') {
          current.lines.push(line);
          // 角色头后一旦出现正文,装饰线状态立即失效:此后任何分隔线
          // 都是段边界(否则头后隔了几段才出现的 `---` 会被误当装饰线
          // 吞掉,把后续叙述一并卷进角色气泡)。
          if (line !== '') expectDivider = false;
        } else if (current !== null) {
          // 旁白段的空行必须原样保留:markdown 的段落边界靠空行,
          // 模型"一行一段"的输出丢了空行就会被并成一个软换行段落。
          current.lines.push(line);
        } else if (line.trim() !== '') {
          // 段开始之前的空行仍然丢弃(每段首尾本来也会被归一化裁掉)
          pushNarratorLine(line);
        }
      }
      flush();

      if (!sawCharacter) return null;
      // 归一:去掉每段首尾空行
      return segments.map(function (seg) {
        var start = 0;
        var end = seg.lines.length;
        while (start < end && seg.lines[start].trim() === '') start++;
        while (end > start && seg.lines[end - 1].trim() === '') end--;
        return { kind: seg.kind, name: seg.name, occupation: seg.occupation, text: seg.lines.slice(start, end).join('\n') };
      });
    }

    // ── 混合渲染:HTML 交给浏览器解析,markdown 交给 MarkdownText ──────

    /** 允许渲染的标签。表外的标签丢标签、留内容(除非在 DROP_WHOLE 里)。 */
    var HTML_TAGS = {
      // 块级容器
      details: 1, summary: 1, div: 1, section: 1, article: 1, aside: 1, nav: 1,
      p: 1, blockquote: 1, hr: 1, br: 1, pre: 1, figure: 1, figcaption: 1,
      ul: 1, ol: 1, li: 1, dl: 1, dt: 1, dd: 1,
      table: 1, thead: 1, tbody: 1, tfoot: 1, tr: 1, th: 1, td: 1, caption: 1,
      h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1,
      // 行内
      span: 1, b: 1, strong: 1, i: 1, em: 1, u: 1, s: 1, del: 1, ins: 1,
      mark: 1, small: 1, sub: 1, sup: 1, kbd: 1, code: 1, a: 1, img: 1,
      font: 1, abbr: 1, cite: 1, q: 1, time: 1, var: 1, samp: 1, ruby: 1, rt: 1,
    };

    /** 行内标签:渲染时不产生换行;其余(含表外标签)一律按块级独占一行。 */
    var INLINE_TAGS = {
      a: 1, abbr: 1, b: 1, br: 1, cite: 1, code: 1, em: 1, font: 1, i: 1,
      img: 1, kbd: 1, mark: 1, q: 1, s: 1, samp: 1, small: 1, span: 1,
      strong: 1, sub: 1, sup: 1, time: 1, u: 1, var: 1,
    };

    /** 内容按原样保留、既不解析子标签也不解析 markdown。 */
    var VERBATIM_TAGS = { pre: 1, code: 1, kbd: 1 };

    /** 白名单外且应当"连内容一起丢"的标签(否则子文本会被转义显示出来)。 */
    var DROP_WHOLE = {
      script: 1, style: 1, iframe: 1, object: 1, embed: 1, form: 1, input: 1,
      select: 1, option: 1, textarea: 1, button: 1, template: 1, canvas: 1,
      video: 1, audio: 1, source: 1, track: 1, svg: 1, math: 1, base: 1,
      link: 1, meta: 1, title: 1, noscript: 1, xmp: 1, plaintext: 1,
    };

    /**
     * 内容模型是"行内"的容器:内部文本只能用轻量行内 markdown。
     * 不能塞 MarkdownText —— 它渲染出 <div class="markdown">,而 <div> 进
     * <summary> / <b> / <p> / <li> 是非法嵌套,会破坏折叠箭头与排版。
     */
    var INLINE_CONTAINERS = {
      summary: 1, span: 1, b: 1, strong: 1, i: 1, em: 1, u: 1, s: 1, del: 1,
      ins: 1, mark: 1, small: 1, sub: 1, sup: 1, kbd: 1, code: 1, a: 1,
      font: 1, abbr: 1, cite: 1, q: 1, time: 1, var: 1, samp: 1, ruby: 1, rt: 1,
      p: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1,
      li: 1, td: 1, th: 1, dt: 1, dd: 1, caption: 1, figcaption: 1,
    };

    /** 属性白名单:HTML 名 → React prop 名。表外的一律丢弃,`on*` 永不接。 */
    var ATTRS = {
      class: 'className', title: 'title', style: 'style',
      href: 'href', src: 'src', alt: 'alt', width: 'width', height: 'height',
      colspan: 'colSpan', rowspan: 'rowSpan', start: 'start', align: 'align',
      color: 'color', size: 'size', face: 'face', open: 'open',
    };

    /** style 属性白名单(只留排版类,不含 position/transform/filter 等)。 */
    var STYLE_PROPS = {
      color: 1, background: 1, 'background-color': 1,
      'font-size': 1, 'font-weight': 1, 'font-style': 1, 'font-family': 1,
      'line-height': 1, 'letter-spacing': 1, 'text-align': 1, 'text-decoration': 1,
      'text-transform': 1, 'text-indent': 1, 'vertical-align': 1,
      opacity: 1, width: 1, height: 1, 'max-width': 1, 'min-width': 1, 'max-height': 1,
      margin: 1, 'margin-top': 1, 'margin-right': 1, 'margin-bottom': 1, 'margin-left': 1,
      padding: 1, 'padding-top': 1, 'padding-right': 1, 'padding-bottom': 1, 'padding-left': 1,
      border: 1, 'border-color': 1, 'border-width': 1, 'border-style': 1, 'border-radius': 1,
      'border-left': 1, 'border-right': 1, 'border-top': 1, 'border-bottom': 1,
      display: 1, gap: 1, 'flex-direction': 1, 'align-items': 1, 'justify-content': 1,
      'list-style-type': 1, 'white-space': 1, 'word-break': 1, 'overflow-wrap': 1,
    };

    var DISPLAY_ALLOWED = {
      block: 1, inline: 1, 'inline-block': 1, flex: 1, 'inline-flex': 1,
      grid: 1, 'inline-grid': 1, none: 1, contents: 1, table: 1, 'table-row': 1,
      'table-cell': 1, 'list-item': 1,
    };

    /**
     * 去掉文本节点的公共前导空白。
     * 模型经常把 HTML 缩进(实测有 6~8 个空格),而 CommonMark 的 4 空格规则
     * 会把这类文本判成"缩进代码块"——面板正文会整块变成灰色代码块。
     * (酒馆同样会踩:showdown 的 HTML 块判定是 `^ {0,3}`。)
     */
    function dedent(text) {
      var lines = String(text).split('\n');
      var indent = -1;
      var i;
      for (i = 0; i < lines.length; i++) {
        if (lines[i].trim() === '') continue;
        var width = lines[i].match(/^[ \t]*/)[0].length;
        if (indent === -1 || width < indent) indent = width;
      }
      if (indent <= 0) return text;
      var out = [];
      for (i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.trim() === '') { out.push(''); continue; }
        out.push(line.replace(/^[ \t]+/, function (ws) { return ws.slice(Math.min(ws.length, indent)); }));
      }
      return out.join('\n');
    }

    /**
     * 抄酒馆的 `simpleLineBreaks: true`:相邻非空行之间补一个硬换行(行尾反斜杠)。
     * CommonMark 会把单换行折叠成空格,模型"一行一句"的输出就会挤成一整段;
     * 酒馆里单换行就等于换行,所以它的用户从来不需要关心空行。
     * 块级结构(列表/标题/表格/围栏)不补,避免破坏它们。
     */
    var HARD_BREAK_SINGLE_NEWLINES = true;
    var BLOCK_START_RE = /^\s*(?:[-*+]|\d+[.)])\s|^\s*#{1,6}\s|^\s*\|/;

    function hardBreaks(text) {
      if (HARD_BREAK_SINGLE_NEWLINES !== true) return text;
      var lines = String(text).split('\n');
      var out = [];
      var inFence = false;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (/^\s*[`~]{3,}/.test(line)) {
          inFence = !inFence;
          out.push(line);
          continue;
        }
        var next = i + 1 < lines.length ? lines[i + 1] : null;
        var breakable = inFence !== true && line.trim() !== '' &&
          next !== null && next.trim() !== '' &&
          !BLOCK_START_RE.test(line) && !BLOCK_START_RE.test(next) &&
          !/\\\s*$/.test(line);
        out.push(breakable ? line.replace(/\s*$/, ' \\') : line);
      }
      return out.join('\n');
    }

    /**
     * 按代码围栏把文本切成 [围栏段|普通段]。围栏里的 `<tag>` 只是代码,
     * 浏览器并不知道什么是 markdown 围栏 —— 不先切出来就会被误当 HTML 解析。
     */
    function splitFencedGroups(text) {
      var lines = String(text).split('\n');
      var groups = [];
      var plain = [];
      var fenced = [];
      var fenceChar = null;

      function flushPlain() {
        if (plain.length > 0) { groups.push({ fence: false, lines: plain }); plain = []; }
      }
      function flushFence() {
        if (fenced.length > 0) { groups.push({ fence: true, lines: fenced }); fenced = []; }
      }

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (fenceChar === null) {
          var open = line.match(/^\s*([`~])\1{2,}/);
          if (open !== null) {
            flushPlain();
            fenceChar = open[1];
            fenced = [line];
          } else {
            plain.push(line);
          }
        } else {
          fenced.push(line);
          if (new RegExp('^\\s*' + fenceChar + '{3,}\\s*$').test(line)) {
            fenceChar = null;
            flushFence();
          }
        }
      }
      flushPlain();
      flushFence();
      return groups;
    }

    // ── HTML → 纯对象树(解析交给浏览器) ───────────────────────────────

    /** DOM 节点 → { kind:'text' } | { kind:'element', tag, attrs, children, block }。 */
    function domToTree(node) {
      if (node === null || node === undefined) return null;
      if (node.nodeType === 3) return { kind: 'text', value: node.data };
      if (node.nodeType !== 1) return null; // 注释 / doctype:丢弃
      var tag = String(node.tagName || '').toLowerCase();
      var attrs = {};
      var list = node.attributes;
      for (var i = 0; list !== undefined && list !== null && i < list.length; i++) {
        attrs[String(list[i].name).toLowerCase()] = list[i].value;
      }
      var children = [];
      var kids = node.childNodes;
      for (var j = 0; kids !== undefined && kids !== null && j < kids.length; j++) {
        var child = domToTree(kids[j]);
        if (child !== null) children.push(child);
      }
      return { kind: 'element', tag: tag, attrs: attrs, children: children, block: INLINE_TAGS[tag] !== 1 };
    }

    /**
     * HTML 源码 → 纯对象树数组。**HTML 的合法性完全由浏览器负责**:
     * 标签大小写、属性引号(含无引号/全角冒号)、跨行标签、错配闭合、
     * 实体解码、未闭合自动补全 —— 全部是 `template.innerHTML` 解析器的行为,
     * 我们只读结果。不 attach 到文档 ⇒ 不执行脚本、不发起资源请求。
     * 返回 null 表示当前环境没有 DOM(整段降级为 markdown)。
     */
    function htmlToTree(html) {
      if (typeof document === 'undefined' || document === null) return null;
      var template = document.createElement('template');
      template.innerHTML = String(html);
      var out = [];
      var kids = template.content.childNodes;
      for (var i = 0; i < kids.length; i++) {
        var node = domToTree(kids[i]);
        if (node !== null) out.push(node);
      }
      return out;
    }

    // ── 伪文本:把 HTML 位置固定下来,再交给 🎭 分泡泡与 markdown 判定 ──
    // 块级元素 → 独占一行的占位符;行内元素 → 原地内联的占位符。
    // 这样 parseSegments 再也看不到面板正文(里面的 `---`、`────`、`🎭`
    // 都不会被判成段边界),而面板正文里的 markdown 又能在渲染期回到
    // MarkdownText —— 两个目标同时达成。

    var SLOT_TOKEN_RE = /^\uE000RPH(\d+)\uE001$/;
    var SLOT_ANY_RE = /\uE000RPH(\d+)\uE001/g;

    function tokenFor(index) { return '\uE000RPH' + index + '\uE001'; }

    // 行内代码(`` `…` ``)里的 `<tag>` 只是代码,不是 HTML —— 但浏览器不知道
    // 那是 markdown 行内代码。解析前先把代码片段换成哨兵文本,解析完再还原,
    // 这样 `` `<details>` `` 不会被变成真的折叠面板。
    var INLINE_CODE_RE = /`[^`\n]*`/g;
    var CODE_TOKEN_RE = /\uE002(\d+)\uE003/g;

    function maskInlineCode(source) {
      var spans = [];
      var text = String(source).replace(INLINE_CODE_RE, function (match) {
        spans.push(match);
        return '\uE002' + (spans.length - 1) + '\uE003';
      });
      return { text: text, spans: spans };
    }

    function restoreInlineCode(nodes, spans) {
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.kind === 'text') {
          node.value = node.value.replace(CODE_TOKEN_RE, function (_all, index) {
            return spans[Number(index)] === undefined ? '' : spans[Number(index)];
          });
        } else {
          restoreInlineCode(node.children, spans);
        }
      }
      return nodes;
    }

    function treeToPseudo(nodes, slots) {
      var out = '';
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.kind === 'text') { out += node.value; continue; }
        var token = tokenFor(slots.length);
        slots.push(node);
        out += node.block === true ? '\n' + token + '\n' : token;
      }
      return out;
    }

    /**
     * 整段文本 → { text: 伪文本, slots: [元素节点] }。
     * 无 DOM 环境下 slots 为空、text 原样返回(调用方整段走 MarkdownText)。
     */
    function buildPseudo(text) {
      var groups = splitFencedGroups(text);
      var slots = [];
      var chunks = [];
      for (var i = 0; i < groups.length; i++) {
        if (i > 0) chunks.push('\n');
        var source = groups[i].lines.join('\n');
        if (groups[i].fence === true) { chunks.push(source); continue; }
        if (source.indexOf('<') === -1) { chunks.push(source); continue; }
        var masked = maskInlineCode(source);
        var tree = htmlToTree(masked.text);
        if (tree === null) { chunks.push(source); continue; }
        chunks.push(treeToPseudo(restoreInlineCode(tree, masked.spans), slots));
      }
      return { text: chunks.join(''), slots: slots };
    }

    /** 伪文本 → 渲染片段:markdown / 块级 HTML / 同一行内的行内混排。 */
    function splitParts(text, slots) {
      var lines = String(text).split('\n');
      var parts = [];
      var buffer = [];

      function flushMarkdown() {
        if (buffer.length === 0) return;
        var joined = buffer.join('\n');
        buffer = [];
        if (joined.trim() !== '') parts.push({ kind: 'markdown', text: joined });
      }

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var blockHit = line.trim().match(SLOT_TOKEN_RE);
        if (blockHit !== null && slots[Number(blockHit[1])] !== undefined) {
          flushMarkdown();
          parts.push({ kind: 'html', node: slots[Number(blockHit[1])] });
          continue;
        }
        if (line.indexOf('\uE000RPH') === -1) { buffer.push(line); continue; }
        // 句中行内 HTML:整行作为一个行内混排片段(文本用行内 markdown,
        // 元素用 React 元素),段落因此不会被拆成多个块。
        flushMarkdown();
        parts.push({ kind: 'inline', items: splitInlineItems(line, slots) });
      }
      flushMarkdown();
      return parts;
    }

    function splitInlineItems(line, slots) {
      var items = [];
      var cursor = 0;
      var m;
      SLOT_ANY_RE.lastIndex = 0;
      while ((m = SLOT_ANY_RE.exec(line)) !== null) {
        var node = slots[Number(m[1])];
        if (node === undefined) continue;
        if (m.index > cursor) items.push({ kind: 'markdown', text: line.slice(cursor, m.index) });
        items.push({ kind: 'html', node: node });
        cursor = m.index + m[0].length;
      }
      if (cursor < line.length) items.push({ kind: 'markdown', text: line.slice(cursor) });
      return items;
    }

    // ── 属性净化(白名单,不拼 HTML 字符串) ────────────────────────────

    function safeUrl(value) {
      var v = String(value).trim();
      if (/^(https?:|mailto:)/i.test(v)) return v;
      if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(v)) return v;
      return undefined; // javascript: / data:text/html / vbscript: 等一律拒绝
    }

    function safeStyle(value) {
      var out = {};
      var parts = String(value).split(';');
      for (var i = 0; i < parts.length; i++) {
        var at = parts[i].indexOf(':');
        if (at === -1) continue;
        var name = parts[i].slice(0, at).trim().toLowerCase();
        var val = parts[i].slice(at + 1).trim();
        if (val === '' || STYLE_PROPS[name] !== 1) continue;
        if (/url\s*\(|expression\s*\(|@import|javascript\s*:/i.test(val)) continue;
        if (name === 'display' && DISPLAY_ALLOWED[val.toLowerCase()] !== 1) continue;
        out[name.replace(/-([a-z])/g, function (_all, ch) { return ch.toUpperCase(); })] = val;
      }
      return out;
    }

    function reactProps(attrs) {
      var props = {};
      for (var name in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, name)) continue;
        if (/^on/.test(name)) continue;              // 事件属性永不接
        var prop = ATTRS[name];
        if (prop === undefined) continue;            // 白名单外的属性丢弃
        var value = attrs[name];
        if (prop === 'style') { props.style = safeStyle(value); continue; }
        if (prop === 'href' || prop === 'src') {
          var url = safeUrl(value);
          if (url === undefined) continue;
          props[prop] = url;
          if (prop === 'href') { props.target = '_blank'; props.rel = 'noopener noreferrer'; }
          continue;
        }
        props[prop] = value;
      }
      return props;
    }

    // ── 渲染:元素 → React 元素;文本 → MarkdownText(双模的关键一步) ──

    /** 轻量行内 markdown → React(不出 div,行内容器里也能用)。 */
    var INLINE_MD_RE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|~~[^~\n]+~~|\[[^\]\n]+\]\([^)\s]+\))/g;

    function renderInline(text) {
      var out = [];
      var last = 0;
      var m;
      INLINE_MD_RE.lastIndex = 0;
      while ((m = INLINE_MD_RE.exec(String(text))) !== null) {
        if (m.index > last) out.push(text.slice(last, m.index));
        var token = m[0];
        var key = 'im' + m.index;
        if (token.slice(0, 2) === '**') out.push(createElement('strong', { key: key }, token.slice(2, -2)));
        else if (token.charAt(0) === '*') out.push(createElement('em', { key: key }, token.slice(1, -1)));
        else if (token.charAt(0) === '`') out.push(createElement('code', { key: key }, token.slice(1, -1)));
        else if (token.slice(0, 2) === '~~') out.push(createElement('del', { key: key }, token.slice(2, -2)));
        else {
          var link = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
          var url = link === null ? undefined : safeUrl(link[2]);
          out.push(url === undefined ? token : createElement('a',
            { key: key, href: url, target: '_blank', rel: 'noopener noreferrer' }, link[1]));
        }
        last = m.index + token.length;
      }
      if (last < text.length) out.push(text.slice(last));
      return out;
    }

    function inlineContext(ctx) {
      return { inline: true, labels: ctx.labels, streaming: false };
    }

    /** `pre`/`code`/`kbd`:内容整段当纯文本(React 会自动转义)。 */
    function verbatimContent(node) {
      var text = '';
      for (var i = 0; i < node.children.length; i++) {
        var child = node.children[i];
        text += child.kind === 'text' ? child.value : verbatimContent(child);
      }
      return text;
    }

    function renderTree(nodes, ctx) {
      var out = [];
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.kind === 'text') {
          if (node.value === '') continue;
          if (ctx.inline === true) {
            out.push(createElement(Fragment, { key: 't' + i }, renderInline(node.value)));
          } else if (node.value.trim() !== '') {
            // ★ HTML 元素内部的文本回到 markdown 管线 —— 这就是"双模"
            out.push(createElement(MarkdownText, {
              key: 't' + i,
              text: hardBreaks(dedent(node.value)),
              labels: ctx.labels,
            }));
          }
          continue;
        }
        var child = renderElement(node, ctx, 'e' + i);
        if (child !== null) out.push(child);
      }
      return out;
    }

    function renderElement(node, ctx, key) {
      var tag = node.tag;
      var childCtx = INLINE_CONTAINERS[tag] === 1 ? inlineContext(ctx) : ctx;

      if (HTML_TAGS[tag] !== 1) {
        if (DROP_WHOLE[tag] === 1) return null;   // 连内容一起丢
        return createElement(Fragment, { key: key }, renderTree(node.children, childCtx));
      }

      var props = reactProps(node.attrs);
      props.key = key;

      if (VERBATIM_TAGS[tag] === 1) {
        var significant = [];
        for (var i = 0; i < node.children.length; i++) {
          var child = node.children[i];
          if (child.kind === 'text' && child.value.trim() === '') continue;
          significant.push(child);
        }
        if (tag === 'pre' && significant.length === 1 &&
            significant[0].kind === 'element' && significant[0].tag === 'code') {
          var codeProps = reactProps(significant[0].attrs);
          codeProps.children = verbatimContent(significant[0]);
          props.children = createElement('code', codeProps);
        } else {
          props.children = verbatimContent(node);
        }
        return createElement(tag, props);
      }

      props.children = renderTree(node.children, childCtx);
      return createElement(tag, props);
    }

    // ── 角色颜色(按名字稳定取色) ─────────────────────────────────────
    var PALETTE = [
      '#ff7eb6', '#7ee787', '#79c0ff', '#ffa657', '#d2a8ff',
      '#f0883e', '#a5d6ff', '#ffd166', '#6bc3b5', '#f78c6b',
    ];

    function colorOf(name) {
      var h = 0;
      for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
      return PALETTE[h % PALETTE.length];
    }

    // ── 小部件 ─────────────────────────────────────────────────────────

    // 气泡内文本一律走 MarkdownText(核心同款),不能设 white-space:pre-wrap
    // ——.markdown 样式会继承它,把 markdown 源码换行原样保留导致双倍空行。
    var bubbleBase = {
      alignSelf: 'flex-start',
      maxWidth: '85%',
      borderRadius: 12,
      padding: '8px 12px',
      fontSize: 14,
      lineHeight: 1.55,
      color: '#1c1c21',
      wordBreak: 'break-word',
    };

    var narratorStyle = Object.assign({}, bubbleBase, {
      background: 'rgba(0,0,0,0.04)',
      border: '1px solid rgba(0,0,0,0.1)',
      color: '#1c1c21',
    });

    function characterStyle(color) {
      return Object.assign({}, bubbleBase, {
        background: 'rgba(0,0,0,0.035)',
        border: '1px solid rgba(0,0,0,0.09)',
        borderLeft: '3px solid ' + color,
      });
    }

    function headerStyle(color) {
      return {
        display: 'inline-block',
        background: color,
        color: '#14141a',
        borderRadius: 999,
        padding: '1px 9px',
        fontSize: 12,
        fontWeight: 600,
        marginBottom: 5,
        letterSpacing: 0.3,
      };
    }

    var occupationStyle = {
      display: 'inline-block',
      marginLeft: 8,
      fontSize: 12,
      color: 'rgba(28,28,33,0.55)',
      fontWeight: 400,
    };

    /** 折叠的 Think 行(与核心视觉近似,不依赖内部组件)。 */
    function ReasoningRow(props) {
      var text = props.text;
      var running = props.running;
      var open = useState(false);
      var first = text.split(/\n/)[0] || '';
      return createElement(
        'div',
        {
          style: {
            margin: '4px 0',
            padding: '4px 10px',
            borderRadius: 8,
            background: 'rgba(0,0,0,0.05)',
            cursor: 'pointer',
            fontSize: 13,
          },
          onClick: function () { open[1](!open[0]); },
          title: 'Think',
        },
        createElement('span', { style: { color: 'rgba(28,28,33,0.6)' } },
          running ? '● Think' : '🧠 Think: ' + first),
        open[0] && createElement(
          'div',
          {
            style: {
              marginTop: 4,
              color: 'rgba(28,28,33,0.82)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 220,
              overflowY: 'auto',
              fontSize: 12.5,
              lineHeight: 1.5,
            },
          },
          text,
        ),
      );
    }

    /**
     * markdown 围栏/脚注文案(dsh 0.2 的 `MarkdownText` 只认 `labels`)。
     *
     * ★ 这是 0.1 → 0.2 的破坏性改名:`MarkdownText` 的 props 从 `codeLabels`
     *   (`{copyLabel, copiedLabel}`)换成必填的 `labels`(`{code: {...}, footnotes}`),
     *   内部渲染围栏时直接读 `labels.code.copyLabel`。少传/传错名字 → 只要正文里
     *   出现 ``` 围栏就抛 TypeError,整个 slot entry 崩掉(表现为"这条回复没有气泡")。
     *   dsh 0.2 的 bundle 里已经找不到 `codeLabels` 这个 prop 名。
     *
     * - 与核心 `markdownLabels(t)` 同构(同一个 chat 席位,同样的 6 个键);
     * - `t` 缺席时用同一套英文默认值,**绝不返回 undefined**(少一个键就是崩溃);
     * - 引用必须按 `t` 缓存:MarkdownText 的流式缓存认对象身份,每帧新建一个 labels
     *   会让整条消息每帧重排(核心注释里写明的约束)。
     */
    var FALLBACK_MARKDOWN_LABELS = {
      code: {
        copyLabel: 'Copy',
        copiedLabel: 'Copied',
        toolbarLabels: {
          codeLabel: 'Code block',
          wrapLabel: 'Wrap lines',
          unwrapLabel: 'Unwrap lines',
        },
      },
      footnotes: 'Footnotes',
    };

    var markdownLabelsCache = typeof WeakMap === 'function' ? new WeakMap() : null;

    function markdownLabelsOf(t) {
      if (typeof t !== 'function') return FALLBACK_MARKDOWN_LABELS;
      var cached = markdownLabelsCache !== null ? markdownLabelsCache.get(t) : undefined;
      if (cached !== undefined) return cached;
      function text(key, fallback) {
        var value = t(key);
        return typeof value === 'string' && value !== '' ? value : fallback;
      }
      var labels = {
        code: {
          copyLabel: text('copy', FALLBACK_MARKDOWN_LABELS.code.copyLabel),
          copiedLabel: text('copied', FALLBACK_MARKDOWN_LABELS.code.copiedLabel),
          toolbarLabels: {
            codeLabel: text('codeBlock.title', FALLBACK_MARKDOWN_LABELS.code.toolbarLabels.codeLabel),
            wrapLabel: text('codeBlock.wrap', FALLBACK_MARKDOWN_LABELS.code.toolbarLabels.wrapLabel),
            unwrapLabel: text('codeBlock.unwrap', FALLBACK_MARKDOWN_LABELS.code.toolbarLabels.unwrapLabel),
          },
        },
        footnotes: text('markdown.footnotes', FALLBACK_MARKDOWN_LABELS.footnotes),
      };
      if (markdownLabelsCache !== null) markdownLabelsCache.set(t, labels);
      return labels;
    }

    var richColumnStyle = {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minWidth: 0,
    };

    /** 单个片段:markdown → MarkdownText,块级 HTML → React 元素树,行内混排 → 一行内并列。 */
    function renderPart(part, key, labels) {
      if (part.kind === 'markdown') {
        return createElement(MarkdownText, { key: key, text: hardBreaks(part.text), labels: labels });
      }
      if (part.kind === 'html') {
        return createElement(Fragment, { key: key },
          renderElement(part.node, { labels: labels, streaming: false }, 'slot' + key));
      }
      var items = [];
      for (var i = 0; i < part.items.length; i++) {
        var item = part.items[i];
        if (item.kind === 'html') {
          items.push(createElement(Fragment, { key: 'i' + i },
            renderElement(item.node, { labels: labels, streaming: false }, 'in' + key + '_' + i)));
        } else {
          items.push(createElement(Fragment, { key: 'i' + i }, renderInline(item.text)));
        }
      }
      return createElement('div', { key: key, style: { minWidth: 0 } }, items);
    }

    /**
     * 气泡正文:markdown 文本 + HTML 的混合渲染(酒馆式双模)。
     *
     * - 流式期间不拆:增量文本里的标签还不完整,保持与核心聊天一致的流式解析。
     * - settled 后:先 buildPseudo() 把 HTML 元素抽成占位符(伪文本交给
     *   parseSegments 分泡泡用),再按片段渲染 —— 文本走 MarkdownText、
     *   元素走白名单 React 元素,元素内部的文本又回到 MarkdownText。
     * - 纯 markdown 时退化成一个 MarkdownText,与之前完全一致。
     * - props.slots 由调用方传入(整条消息共用一份伪文本,占位符编号才连得上);
     *   缺省时本地算一份(降级气泡 / 无 🎭 头时的路径)。
     */
    function RichMarkdown(props) {
      var text = props.text;
      var labels = props.labels;
      if (props.streaming === true) {
        return createElement(MarkdownText, { text: text, streaming: true, labels: labels });
      }
      var pseudo = props.slots === undefined ? buildPseudo(text) : { text: text, slots: props.slots };
      var parts = splitParts(pseudo.text, pseudo.slots);
      if (parts.length === 1 && parts[0].kind === 'markdown') {
        return createElement(MarkdownText, { text: hardBreaks(parts[0].text), labels: labels });
      }
      return createElement('div', { style: richColumnStyle },
        parts.map(function (part, i) { return renderPart(part, i, labels); }));
    }

    /** 简单文本气泡(streaming 或未匹配角色格式时使用)。 */
    function PlainBubble(props) {
      var blocks = props.blocks;
      var streaming = props.streaming;
      var interrupted = props.interrupted;
      var renderMessageImages = props.renderMessageImages;
      var labels = props.labels;

      var children = [];
      var textParts = [];
      var key = 0;

      function flushText() {
        if (textParts.length === 0) return;
        var text = textParts.join('\n');
        textParts = [];
        children.push(createElement(
          'div', { key: key++, style: narratorStyle },
          createElement(RichMarkdown, { text: text, streaming: streaming === true, labels: labels }),
        ));
      }

      for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        if (block === undefined) continue;
        if (block.kind === 'text') {
          textParts.push(block.text);
        } else if (block.kind === 'reasoning') {
          flushText();
          children.push(createElement(ReasoningRow, { key: key++, text: block.text, running: streaming && i === blocks.length - 1 }));
        } else if (block.kind === 'image') {
          flushText();
          var group = [block];
          while (i + 1 < blocks.length) {
            var next = blocks[i + 1];
            if (next === undefined || next.kind !== 'image') break;
            group.push(next);
            i += 1;
          }
          var images = group.map(function (b) { return { attachment: b.attachment }; });
          children.push(createElement(Fragment, { key: key++ },
            renderMessageImages({ images: images, align: 'start' })));
        } else if (block.kind === 'tool-call') {
          // 工具行由 ChatView 的 tool 组渲染,这里跳过
        } else {
          flushText();
          children.push(createElement(
            'pre', { key: key++, style: { fontSize: 12, color: '#9a5a00', overflowX: 'auto' } },
            JSON.stringify(block.block, null, 2),
          ));
        }
      }
      flushText();

      if (interrupted) {
        children.push(createElement(
          'div', { key: key++, style: { color: '#c03030', fontSize: 13, fontStyle: 'italic' } },
          '· 已中断',
        ));
      }
      return createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, children);
    }

    /** 气泡列表:叙述 + 每角色一个气泡。 */
    function BubbleList(props) {
      var segments = props.segments;
      var slots = props.slots;
      var interrupted = props.interrupted;
      var labels = props.labels;

      return createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: '2px 0' } },
        segments.map(function (seg, i) {
          if (seg.kind === 'narrator') {
            return createElement(
              'div',
              { key: i, style: narratorStyle },
              createElement(RichMarkdown, { text: seg.text, slots: slots, labels: labels }),
            );
          }
          var color = colorOf(seg.name);
          return createElement(
            'div',
            { key: i, style: characterStyle(color) },
            createElement(
              'div',
              null,
              createElement('span', { style: headerStyle(color) }, '🎭 ' + seg.name),
              seg.occupation !== '' && createElement('span', { style: occupationStyle }, seg.occupation),
            ),
            createElement(
              'div',
              { style: { marginTop: 2 } },
              createElement(RichMarkdown, { text: seg.text, slots: slots, labels: labels }),
            ),
          );
        }),
        interrupted && createElement(
          'div',
          { key: 'interrupted', style: { color: '#c03030', fontSize: 13, fontStyle: 'italic' } },
          '· 已中断',
        ),
      );
    }

    // ── 主渲染器(影子覆盖 'assistant-step') ───────────────────────────
    function BubbleAssistantNodeView(props) {
      var node = props.node;
      var data = node.data;
      var status = data.status;
      var groupPart = props.groupPart;
      var renderMessageImages = props.renderMessageImages;
      var labels = markdownLabelsOf(props.t);
      var blocks = data.blocks;

      // dsh 0.2 会把"既有思考又有正文"的同一步按 groupPart 发两次渲染事件
      // (reasoning 进过程区,response 进回答区;核心 AssistantMarkdown 同样
      // 按此分流)。不认识它就会把 Think+正文整段渲染两遍 —— 重复气泡根因。
      if (groupPart === 'reasoning') {
        var reasoningBlocks = blocks.filter(function (b) {
          return b !== undefined && b.kind === 'reasoning';
        });
        var reasoningVisible = reasoningBlocks.some(function (b) { return b.text.trim() !== ''; });
        if (reasoningBlocks.length === 0 || (status !== 'running' && !reasoningVisible)) return null;
        return createElement(PlainBubble, {
          blocks: reasoningBlocks,
          streaming: status === 'running',
          interrupted: false,
          renderMessageImages: renderMessageImages,
          labels: labels,
        });
      }

      // 中断标记与核心同条件:只在 response/无分流/整步仅思考时展示一次。
      var reasonOnly = !blocks.some(function (b) {
        return b !== undefined && b.kind !== 'reasoning' && b.kind !== 'tool-call';
      });
      var interrupted = status === 'interrupted' &&
        (groupPart === undefined || groupPart === 'response' || reasonOnly);

      if (groupPart === 'response') {
        blocks = blocks.filter(function (b) { return b !== undefined && b.kind !== 'reasoning'; });
      }

      // 流式中不拆气泡(避免闪烁),settled/interrupted 后按格式拆分;
      // 没有角色头时降级为普通气泡。
      if (status === 'running') {
        return createElement(PlainBubble, {
          blocks: blocks,
          streaming: true,
          interrupted: false,
          renderMessageImages: renderMessageImages,
          labels: labels,
        });
      }

      var hasVisible = blocks.some(function (b) {
        if (b === undefined) return false;
        if (b.kind === 'tool-call') return false;
        if (b.kind === 'text' || b.kind === 'reasoning') return b.text.trim() !== '';
        return true;
      });
      if (!hasVisible) return null;

      var textParts = [];
      var otherBlocks = [];
      for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        if (block === undefined) continue;
        if (block.kind === 'text') textParts.push(block.text);
        else otherBlocks.push(block);
      }
      // 先把 HTML 抽成占位符再分泡泡:否则面板正文里的 `---`、`────`、
      // `🎭` 会被 parseSegments 当成段边界,把 <details> 撕成两半。
      var pseudo = buildPseudo(textParts.join('\n'));
      var segments = parseSegments(pseudo.text);

      if (segments === null) {
        return createElement(PlainBubble, {
          blocks: blocks,
          streaming: false,
          interrupted: interrupted,
          renderMessageImages: renderMessageImages,
          labels: labels,
        });
      }
      return createElement(BubbleList, {
        segments: segments,
        slots: pseudo.slots,
        interrupted: interrupted,
        labels: labels,
      });
    }

    var BubbleAssistantNodeViewMemo = memo(BubbleAssistantNodeView);

    exports.apply = function apply(ctx) {
      ctx.slots.inject('conversation.chat.node', function () {
        return ctx.slots.register(
          { name: 'conversation.chat.node', key: 'assistant-step', priority: -1 },
          BubbleAssistantNodeViewMemo,
        );
      });
    };

    exports.inject = ['slots'];

    // 仅测试挂点:使解析/取色/渲染逻辑可被 node 单测覆盖。
    exports.__test = {
      parseSegments: parseSegments,
      colorOf: colorOf,
      matchHeader: function (line) { return HEADER_RE.test(line); },
      headerSource: String(HEADER_RE),
      BubbleAssistantNodeView: BubbleAssistantNodeView,
      markdownLabelsOf: markdownLabelsOf,
      // 混合渲染
      buildPseudo: buildPseudo,
      maskInlineCode: maskInlineCode,
      restoreInlineCode: restoreInlineCode,
      splitParts: splitParts,
      splitInlineItems: splitInlineItems,
      splitFencedGroups: splitFencedGroups,
      htmlToTree: htmlToTree,
      domToTree: domToTree,
      treeToPseudo: treeToPseudo,
      renderTree: renderTree,
      renderElement: renderElement,
      renderInline: renderInline,
      reactProps: reactProps,
      safeStyle: safeStyle,
      safeUrl: safeUrl,
      dedent: dedent,
      hardBreaks: hardBreaks,
      setHardBreaks: function (on) { HARD_BREAK_SINGLE_NEWLINES = on === true; },
      tokenFor: tokenFor,
      tables: {
        HTML_TAGS: HTML_TAGS,
        INLINE_TAGS: INLINE_TAGS,
        VERBATIM_TAGS: VERBATIM_TAGS,
        DROP_WHOLE: DROP_WHOLE,
        INLINE_CONTAINERS: INLINE_CONTAINERS,
        ATTRS: ATTRS,
      },
    };

    return module.exports;
  },
});