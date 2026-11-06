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

/**
 * Tells the window about a link under the pointer, so the window can draw the
 * popover with the real address. The frame draws nothing and follows nothing:
 * it posts the address and where the link is, and the window decides.
 *
 * It uses what the frame already has, which is running its own nonced script
 * and posting to its parent. The sandbox gains nothing. The address is the
 * data-href the sanitiser kept, the place a person would be sent, never the
 * words on the link.
 */
export const LINK_SCRIPT = String.raw`(() => {
  let current = null;

  function anchorOf(target) {
    return target && target.closest ? target.closest('a[data-href]') : null;
  }

  function report(anchor) {
    if (anchor === current) return;
    current = anchor;
    if (!anchor) {
      parent.postMessage({ type: 'juno.mail.link', href: null }, '*');
      return;
    }
    const box = anchor.getBoundingClientRect();
    parent.postMessage(
      {
        type: 'juno.mail.link',
        href: anchor.getAttribute('data-href'),
        rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      },
      '*',
    );
  }

  document.addEventListener('mouseover', (event) => report(anchorOf(event.target)));
  document.documentElement.addEventListener('mouseleave', () => report(null));
  document.addEventListener('click', (event) => {
    const anchor = anchorOf(event.target);
    if (!anchor) return;
    event.preventDefault();
    parent.postMessage({ type: 'juno.mail.linkClick', href: anchor.getAttribute('data-href') }, '*');
  });
})();`;

/**
 * Find in this message. The window owns the bar and the query; the frame owns
 * the text, so it does the searching and the highlighting and reports back how
 * many matches there are and where the current one is.
 *
 * It only wraps matched text in mark elements and unwraps them again, which is
 * a change the sanitiser would have allowed. It accepts messages from its
 * parent only, reads nothing outside the frame and gains no permission.
 */
export const FIND_SCRIPT = String.raw`(() => {
  let marks = [];
  let current = -1;

  function clear() {
    marks.forEach((mark) => {
      const holder = mark.parentNode;
      if (!holder) return;
      holder.replaceChild(document.createTextNode(mark.textContent || ''), mark);
      holder.normalize();
    });
    marks = [];
    current = -1;
  }

  function search(query) {
    clear();
    const needle = query.toLowerCase();
    if (!needle) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
    nodes.forEach((node) => {
      const tag = node.parentElement ? node.parentElement.tagName : '';
      if (tag === 'SCRIPT' || tag === 'STYLE') return;
      const text = node.nodeValue || '';
      const lower = text.toLowerCase();
      // A letter whose lower case is longer would shift every offset below.
      if (lower.length !== text.length) return;
      const spans = [];
      for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + needle.length)) {
        spans.push([at, at + needle.length]);
      }
      if (!spans.length || !node.parentNode) return;
      const fragment = document.createDocumentFragment();
      let last = 0;
      spans.forEach((span) => {
        if (span[0] > last) fragment.appendChild(document.createTextNode(text.slice(last, span[0])));
        const mark = document.createElement('mark');
        mark.className = 'juno-find';
        mark.textContent = text.slice(span[0], span[1]);
        fragment.appendChild(mark);
        marks.push(mark);
        last = span[1];
      });
      if (last < text.length) fragment.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(fragment, node);
    });
  }

  function show(index) {
    marks.forEach((mark) => mark.classList.remove('juno-find-current'));
    current = marks.length ? ((index % marks.length) + marks.length) % marks.length : -1;
    let top = null;
    if (current >= 0) {
      marks[current].classList.add('juno-find-current');
      top = marks[current].getBoundingClientRect().top;
    }
    parent.postMessage({ type: 'juno.mail.findResult', count: marks.length, current, top }, '*');
  }

  window.addEventListener('message', (event) => {
    if (event.source !== parent) return;
    const data = event.data;
    if (!data || data.type !== 'juno.mail.find') return;
    if (data.action === 'clear') {
      clear();
      parent.postMessage({ type: 'juno.mail.findResult', count: 0, current: -1, top: null }, '*');
    } else if (data.action === 'search') {
      search(String(data.query || ''));
      show(0);
    } else if (data.action === 'next') {
      show(current + 1);
    } else if (data.action === 'previous') {
      show(current - 1);
    }
  });
})();`;
