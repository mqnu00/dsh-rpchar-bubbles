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
        } else if (line.trim() === '') {
          // 段间空行:不开启新段
          continue;
        } else {
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

    // ── 气泡文本中的块级 HTML(酒馆式渲染) ────────────────────────────
    // MarkdownText 会把模型输出的原始 HTML 当普通文本转义显示;酒馆 AI 会
    // 直接把 <details> 状态面板这类块级 HTML 渲染出来。做法:settled 后把
    // "独占一行、完整闭合的顶层元素"提取为 HTML 块原样渲染(dangerously
    // SetInnerHTML + 净化),其余文本继续走 MarkdownText;流式期间不提取
    // (增量文本不完整,避免闪烁);代码围栏(```)内的标签不参与提取。

    var VOID_TAGS = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };

    /** 把代码围栏内的字符替换为空格(保留长度与换行),供标签扫描跳过围栏内容。 */
    function fenceMask(text) {
      var lines = text.split('\n');
      var out = [];
      var fenceChar = null;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var open = fenceChar === null ? line.match(/^\s*([`~])\1{2,}/) : null;
        var close = fenceChar !== null && /^\s*[`~]{3,}\s*$/.test(line);
        if (open !== null) {
          fenceChar = open[1];
          out.push(line);
        } else if (close) {
          fenceChar = null;
          out.push(line);
        } else if (fenceChar !== null) {
          out.push(line.replace(/[^\s]/g, ' '));
        } else {
          out.push(line);
        }
      }
      return out.join('\n');
    }

    /**
     * 标签前(自本行行首起)是否只有空白。模型输出的面板标签常带前导空格缩进
     * (如 `      <ul>`、`        <li><details>`),不能只看前一字符是不是换行。
     */
    function whitespaceToLineStart(mask, index) {
      var i = index;
      while (i > 0 && mask.charAt(i - 1) !== '\n') i--;
      return mask.slice(i, index).trim() === '';
    }

    /**
     * 把文本切成 [text|html] 两部分序列:html = 独占一行开头、完整配平的
     * 顶层元素区间;无任何完整块时返回 null(调用方整体走 MarkdownText)。
     */
    function splitHtmlParts(text) {
      text = String(text);
      if (text.indexOf('<') === -1 || text.indexOf('>') === -1) return null;
      var mask = fenceMask(text);
      var re = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>/g;
      var stack = [];
      var blocks = [];
      var start = -1;
      var m;
      while ((m = re.exec(mask)) !== null) {
        var tok = m[0];
        if (tok.slice(0, 4) === '<!--') continue; // 注释:不参与配平
        var closing = tok.charAt(1) === '/';
        var name = closing
          ? tok.slice(2, -1).trim().toLowerCase()
          : tok.slice(1).split(/[\s/>]/)[0].toLowerCase();
        if (!closing) {
          if (VOID_TAGS[name] === 1 || /\/\s*>$/.test(tok)) {
            // 自闭合/空元素(如 `<br>`):不进配平栈;若在顶层且独占一行,
            // 单独成一小块,避免 `<br>` 以原文显示。
            if (stack.length === 0 && whitespaceToLineStart(mask, m.index)) {
              blocks.push([m.index, m.index + tok.length]);
            }
            continue;
          }
          if (stack.length === 0) {
            // 只有"独占一行(允许前导空白)"的容器才开启新的顶层块;
            // 句中的行内标签(如 <b>)不开启,留在 markdown 原文里。
            if (!whitespaceToLineStart(mask, m.index)) continue;
            start = m.index;
          }
          // 顶层块内部:无论是否缩进/与兄弟同行,一律压栈配平(否则嵌套的
          // `<li><details>`、`<div>` 会漏配平,使外层 `<details>` 被提前闭合)。
          stack.push(name);
        } else {
          if (stack.length === 0) continue; // 无对应开的闭合:忽略
          var top = stack[stack.length - 1];
          if (top !== name) continue; // 错配/孤立的闭合标签:忽略
          stack.pop();
          if (stack.length === 0 && start !== -1) {
            blocks.push([start, m.index + tok.length]);
            start = -1;
          }
        }
      }
      if (blocks.length === 0) return null;
      var parts = [];
      var cursor = 0;
      for (var b = 0; b < blocks.length; b++) {
        var s = blocks[b][0];
        var e = blocks[b][1];
        if (s < cursor) continue; // 防御:异常嵌套不产生重叠区间
        if (s > cursor) parts.push({ kind: 'text', text: text.slice(cursor, s) });
        parts.push({ kind: 'html', html: text.slice(s, e) });
        cursor = e;
      }
      if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) });
      // 丢弃纯空白文本块(如面板之间的空行),避免产生空 markdown 段
      return parts.filter(function (p) { return p.kind === 'html' || p.text.trim() !== ''; });
    }

    /** 净化模型输出的 HTML:删 script/style/iframe/form 等整段、事件属性与 javascript: 链接。 */
    function sanitizeHtml(html) {
      return String(html)
        .replace(/<(script|style|iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<\/?(?:script|style|iframe|object|embed|form|base|link|meta|title)\b[^>]*>/gi, '')
        .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/\s(?:href|src|action)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, function (all, val) {
          return /^["']?\s*javascript\s*:/i.test(val) ? '' : all;
        });
    }

    /**
     * 保留引用块内的换行:连续 `>` 行且中间无空行时,CommonMark 会把它们合并
     * 成一个引用段落,段落内的软换行被折叠成空格,导致"人物卡档案"这类整块
     * 引用被渲染成一行连排文字。这里把紧邻的 `>` 非空行行尾补一个硬换行
     * (反斜杠 + 换行),让每行各占一行;行间有空 `>`(另起一段)时不补。
     */
    function hardBreakBlockquotes(text) {
      var lines = String(text).split('\n');
      var out = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var isQuote = /^\s*>/.test(line);
        if (!isQuote) {
          out.push(line);
          continue;
        }
        var nextQuote = i + 1 < lines.length && /^\s*>/.test(lines[i + 1]);
        var blankQuote = /^\s*>\s*$/.test(line); // 空 `>` 行 = 引用内另起一段
        if (nextQuote && !blankQuote && !/\\\s*$/.test(line)) {
          out.push(line.replace(/\s*$/, ' \\'));
        } else {
          out.push(line);
        }
      }
      return out.join('\n');
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

    /** 代码块复制按钮文案(沿用核心 AssistantMarkdown 的 t 键;t 缺席时交给组件默认值)。 */
    function codeLabelsOf(t) {
      if (typeof t !== 'function') return undefined;
      return { copyLabel: t('copy'), copiedLabel: t('copied') };
    }

    var htmlPanelStyle = {
      width: '100%',
      minWidth: 0,
      boxSizing: 'border-box',
      overflowX: 'auto',
    };

    /** 单个块级 HTML 面板:净化后原样渲染(酒馆式)。 */
    function HtmlPanel(props) {
      return createElement(
        'div',
        { style: htmlPanelStyle },
        createElement('div', { dangerouslySetInnerHTML: { __html: sanitizeHtml(props.html) } }),
      );
    }

    var richColumnStyle = {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minWidth: 0,
    };

    /**
     * 气泡正文:markdown 文本与块级 HTML 的混合渲染。流式期间或纯文本时
     * 退化为单个 MarkdownText,保证与核心聊天的流式解析行为一致。
     */
    function RichMarkdown(props) {
      var text = props.text;
      var codeLabels = props.codeLabels;
      if (props.streaming === true) {
        return createElement(MarkdownText, { text: text, streaming: true, codeLabels: codeLabels });
      }
      var parts = splitHtmlParts(text);
      if (parts === null) {
        var collapsedText = hardBreakBlockquotes(text);
        return createElement(MarkdownText, { text: collapsedText, codeLabels: codeLabels });
      }
      var children = [];
      var key = 0;
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (part.kind === 'text') {
          children.push(createElement(
            MarkdownText, { key: key++, text: hardBreakBlockquotes(part.text), codeLabels: codeLabels }));
        } else {
          children.push(createElement(HtmlPanel, { key: key++, html: part.html }));
        }
      }
      return createElement('div', { style: richColumnStyle }, children);
    }

    /** 简单文本气泡(streaming 或未匹配角色格式时使用)。 */
    function PlainBubble(props) {
      var blocks = props.blocks;
      var streaming = props.streaming;
      var interrupted = props.interrupted;
      var renderMessageImages = props.renderMessageImages;
      var codeLabels = props.codeLabels;

      var children = [];
      var textParts = [];
      var key = 0;

      function flushText() {
        if (textParts.length === 0) return;
        var text = textParts.join('\n');
        textParts = [];
        children.push(createElement(
          'div', { key: key++, style: narratorStyle },
          createElement(RichMarkdown, { text: text, streaming: streaming === true, codeLabels: codeLabels }),
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
      var interrupted = props.interrupted;
      var codeLabels = props.codeLabels;

      return createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: '2px 0' } },
        segments.map(function (seg, i) {
          if (seg.kind === 'narrator') {
            return createElement(
              'div',
              { key: i, style: narratorStyle },
              createElement(RichMarkdown, { text: seg.text, codeLabels: codeLabels }),
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
              createElement(RichMarkdown, { text: seg.text, codeLabels: codeLabels }),
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
      var blocks = data.blocks;
      var status = data.status;
      var renderMessageImages = props.renderMessageImages;
      var codeLabels = codeLabelsOf(props.t);

      // 流式中不拆气泡(避免闪烁),settled/interrupted 后按格式拆分;
      // 没有角色头时降级为普通气泡。
      if (status === 'running') {
        return createElement(PlainBubble, {
          blocks: blocks,
          streaming: true,
          interrupted: false,
          renderMessageImages: renderMessageImages,
          codeLabels: codeLabels,
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
      var segments = parseSegments(textParts.join('\n'));

      if (segments === null) {
        return createElement(PlainBubble, {
          blocks: blocks,
          streaming: false,
          interrupted: status === 'interrupted',
          renderMessageImages: renderMessageImages,
          codeLabels: codeLabels,
        });
      }
      return createElement(BubbleList, {
        segments: segments,
        interrupted: status === 'interrupted',
        codeLabels: codeLabels,
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
      codeLabelsOf: codeLabelsOf,
      splitHtmlParts: splitHtmlParts,
      sanitizeHtml: sanitizeHtml,
      hardBreakBlockquotes: hardBreakBlockquotes,
      RichMarkdown: RichMarkdown,
      HtmlPanel: HtmlPanel,
    };

    return module.exports;
  },
});