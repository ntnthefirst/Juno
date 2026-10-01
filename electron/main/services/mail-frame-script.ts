/**
 * The script that tidies quoted history inside the sandboxed reader frame.
 *
 * Mail clients quote in different ways: Gmail and Thunderbird nest a
 * blockquote, Apple Mail adds a cite attribute, Outlook does not quote at all
 * and puts a header block above the old message, and a plain-text client sends
 * lines that start with arrows, at any depth, sometimes one line to a div.
 * Rather than a pattern per client in the main process, which has no DOM, the
 * frame normalises what it was given, with a real one.
 *
 * It runs inside the opaque-origin frame on markup that has already been
 * sanitised, and it only moves and wraps nodes: it adds no element a message
 * could not already contain and reads nothing outside the frame. Written as a
 * string so no compiler helper can leak into it, and kept free of backslashes
 * outside the two patterns that need them.
 */
export const QUOTE_SCRIPT = String.raw`(() => {
  const MARKER = /^\s*>/;
  const MARKERS = /^\s*>\s?/;

  function depthOf(text) {
    let depth = 0;
    let rest = text;
    for (;;) {
      const m = MARKERS.exec(rest);
      if (!m) break;
      depth += 1;
      rest = rest.slice(m[0].length);
    }
    return { depth, text: rest };
  }

  // Lines, each with its quote depth, back to nodes: runs of quoted lines
  // become a blockquote holding the same thing one level shallower.
  function build(lines) {
    const frag = document.createDocumentFragment();
    let i = 0;
    while (i < lines.length) {
      let end = i;
      if (lines[i].depth > 0) {
        while (end < lines.length && lines[end].depth > 0) end += 1;
        const quote = document.createElement('blockquote');
        quote.appendChild(build(lines.slice(i, end).map((l) => ({ depth: l.depth - 1, text: l.text }))));
        frag.appendChild(quote);
      } else {
        while (end < lines.length && lines[end].depth === 0) end += 1;
        lines.slice(i, end).forEach((l, n, all) => {
          frag.appendChild(document.createTextNode(l.text));
          if (n < all.length - 1) frag.appendChild(document.createElement('br'));
        });
      }
      i = end;
    }
    return frag;
  }

  function insideQuote(node) {
    return !!(node.parentElement && node.parentElement.closest('blockquote'));
  }

  // Text and line breaks only: the shape a plain-text mail takes once it has
  // been put in an HTML part.
  function isLineBlock(el) {
    if (!el.childNodes.length) return false;
    return Array.prototype.every.call(el.childNodes, (n) => n.nodeType === 3 || (n.nodeType === 1 && n.tagName === 'BR'));
  }

  function linesOf(el) {
    const lines = [''];
    el.childNodes.forEach((n) => {
      if (n.nodeType === 1) lines.push('');
      else lines[lines.length - 1] += n.nodeValue;
    });
    return lines.map(depthOf);
  }

  // One container holding several arrowed lines separated by breaks.
  function convertBreakLines() {
    document.querySelectorAll('p, div, pre, td, span').forEach((el) => {
      if (insideQuote(el) || !isLineBlock(el)) return;
      const lines = linesOf(el);
      if (!lines.some((l) => l.depth > 0)) return;
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(build(lines));
    });
  }

  // One arrowed line to a block, which is how some clients write them.
  function convertBlockLines() {
    const parents = new Set();
    document.querySelectorAll('p, div').forEach((el) => {
      if (isLineBlock(el) && MARKER.test(el.textContent || '') && el.parentElement) parents.add(el.parentElement);
    });
    parents.forEach((parent) => {
      if (parent.closest('blockquote')) return;
      const kids = Array.prototype.slice.call(parent.children);
      let run = [];
      const flush = () => {
        if (run.length) {
          const lines = [];
          run.forEach((el) => linesOf(el).forEach((line) => lines.push(line)));
          const frag = build(lines);
          const wrapper = document.createElement('div');
          wrapper.appendChild(frag);
          parent.insertBefore(wrapper, run[0]);
          run.forEach((el) => parent.removeChild(el));
        }
        run = [];
      };
      kids.forEach((el) => {
        const quoted = (el.tagName === 'P' || el.tagName === 'DIV') && isLineBlock(el) && MARKER.test(el.textContent || '');
        if (quoted) run.push(el);
        else flush();
      });
      flush();
    });
  }

  // Outlook writes no quote: a header block, then the old message, to the end.
  function wrapFromHeader() {
    const header = document.querySelector('#divRplyFwdMsg, #appendonsend, [id^="divRplyFwdMsg"], .OutlookMessageHeader');
    if (!header || header.closest('blockquote')) return;
    let start = header;
    if (start.id === 'appendonsend') start = start.nextElementSibling || start;
    if (start.previousElementSibling && start.previousElementSibling.tagName === 'HR') start = start.previousElementSibling;
    const wrapper = document.createElement('blockquote');
    const parent = start.parentNode;
    if (!parent) return;
    parent.insertBefore(wrapper, start);
    while (wrapper.nextSibling) wrapper.appendChild(wrapper.nextSibling);
  }

  try {
    wrapFromHeader();
    // Blocks first, so a run of arrowed lines written one to a block is one
    // quote and not a quote per line.
    convertBlockLines();
    convertBreakLines();
  } catch (error) {
    // A message that confuses the tidying is shown as it came.
  }
})();`;
