/**
 * rpchar-bubbles — 多角色扮演独立气泡 UI (client 插件)
 *
 * 以 priority:-1 影子覆盖 conversation.chat.node 下核心的 'assistant-step'
 * 渲染器:把 narrator(旁白)按 🎭 **角色名** (职业) + ─── 分隔线格式输出的
 * 回复,拆成叙述 + 每个角色各自独立的聊天气泡。
 *
 * 手写 bundle(零构建依赖):格式与官方 client 包一致
 * (window.__ModuleLoader__.load({ id, factory })),运行时仅依赖统一基座
 * 播种的 react。
 */
window.__ModuleLoader__.load({
  id: "rpchar-bubbles",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");
    var createElement = react.createElement;
    var Fragment = react.Fragment;
    var useState = react.useState;
    var memo = react.memo;

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

    var HEADER_RE = /^[\u{1F3AD}]?\s*\*\*([^*]+)\*\*\s*(?:[（(]([^)）]*)[)）])?\s*$/u;
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
          expectDivider = true;
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

    var bubbleBase = {
      alignSelf: 'flex-start',
      maxWidth: '85%',
      borderRadius: 12,
      padding: '8px 12px',
      fontSize: 14,
      lineHeight: 1.55,
      color: '#1c1c21',
      whiteSpace: 'pre-wrap',
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

    /** 简单文本气泡(streaming 或未匹配角色格式时使用)。 */
    function PlainBubble(props) {
      var blocks = props.blocks;
      var streaming = props.streaming;
      var interrupted = props.interrupted;
      var renderMessageImages = props.renderMessageImages;

      var children = [];
      var textParts = [];
      var key = 0;

      function flushText() {
        if (textParts.length === 0) return;
        var text = textParts.join('\n');
        textParts = [];
        children.push(createElement(
          'div', { key: key++, style: narratorStyle },
          text,
          streaming && createElement('span', { style: { color: 'rgba(28,28,33,0.55)' } }, ' ▍'),
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

      return createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: '2px 0' } },
        segments.map(function (seg, i) {
          if (seg.kind === 'narrator') {
            return createElement(
              'div',
              { key: i, style: narratorStyle },
              seg.text,
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
            createElement('div', { style: { marginTop: 2 } }, seg.text),
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

      // 流式中不拆气泡(避免闪烁),settled/interrupted 后按格式拆分;
      // 没有角色头时降级为普通气泡。
      if (status === 'running') {
        return createElement(PlainBubble, {
          blocks: blocks,
          streaming: true,
          interrupted: false,
          renderMessageImages: renderMessageImages,
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
        });
      }
      return createElement(BubbleList, {
        segments: segments,
        interrupted: status === 'interrupted',
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

    // 仅测试挂点:使解析/取色逻辑可被 node 单测覆盖。
    exports.__test = {
      parseSegments: parseSegments,
      colorOf: colorOf,
      matchHeader: function (line) { return HEADER_RE.test(line); },
      headerSource: String(HEADER_RE),
    };

    return module.exports;
  },
});