'use strict';
// Minimal dependency-free XML parser. Enough for GDTF / MVR documents:
// elements, attributes, text, CDATA, comments, processing instructions.
// Returns a tree of { name, attrs: {}, children: [], text: '' }.

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeEntities(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return e in ENTITIES ? ENTITIES[e] : m;
  });
}

function parseAttrs(s) {
  const attrs = {};
  const re = /([^\s=\/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) attrs[m[1]] = decodeEntities(m[2] !== undefined ? m[2] : m[3]);
  return attrs;
}

function parseXML(src) {
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      stack[stack.length - 1].text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1].text += decodeEntities(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      stack[stack.length - 1].text += src.slice(lt + 9, end === -1 ? n : end);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) {
      // processing instruction or DOCTYPE
      const end = src.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    const gt = findTagEnd(src, lt);
    const tag = src.slice(lt + 1, gt);
    if (tag[0] === '/') {
      const name = tag.slice(1).trim();
      // pop to matching element (tolerant of mismatches)
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
    } else {
      const selfClose = tag.endsWith('/');
      const body = selfClose ? tag.slice(0, -1) : tag;
      const sp = body.search(/[\s\/]/);
      const name = sp === -1 ? body : body.slice(0, sp);
      const node = { name, attrs: sp === -1 ? {} : parseAttrs(body.slice(sp)), children: [], text: '' };
      stack[stack.length - 1].children.push(node);
      if (!selfClose) stack.push(node);
    }
    i = gt + 1;
  }
  return root;
}

function findTagEnd(src, start) {
  // find '>' not inside a quoted attribute value
  let q = null;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '>') return i;
  }
  return src.length;
}

// Helpers -----------------------------------------------------------------
function child(node, name) {
  return node ? node.children.find((c) => c.name === name) : undefined;
}
function children(node, name) {
  return node ? node.children.filter((c) => !name || c.name === name) : [];
}
function attr(node, name, def) {
  return node && node.attrs[name] !== undefined ? node.attrs[name] : def;
}
function text(node) {
  return node ? node.text.trim() : '';
}
function find(node, path) {
  // path like 'A/B/C' from node
  let cur = node;
  for (const p of path.split('/')) {
    cur = child(cur, p);
    if (!cur) return undefined;
  }
  return cur;
}
function walk(node, fn, depth = 0) {
  fn(node, depth);
  for (const c of node.children) walk(c, fn, depth + 1);
}

module.exports = { parseXML, child, children, attr, text, find, walk, decodeEntities };
