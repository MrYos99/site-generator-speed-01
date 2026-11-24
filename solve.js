// site-generator-speed-01: a faster drop-in for makefun-site 1.0.0.
// Written fresh in this session from the kit README + vendor reference.
// Strategy: one fused pass per stage, no token objects, no per-char
// escaping, cached slugify, flat template ops with include caching
// (global templates once per case, single-root templates once per object).

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const hasOwn = (o, k) => Object.hasOwn(o, k);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function nextEsc(s, from) {
  let m = -1;
  let x;
  x = s.indexOf('&', from);
  if (x !== -1 && (m === -1 || x < m)) m = x;
  x = s.indexOf('<', from);
  if (x !== -1 && (m === -1 || x < m)) m = x;
  x = s.indexOf('>', from);
  if (x !== -1 && (m === -1 || x < m)) m = x;
  x = s.indexOf('"', from);
  if (x !== -1 && (m === -1 || x < m)) m = x;
  x = s.indexOf("'", from);
  if (x !== -1 && (m === -1 || x < m)) m = x;
  return m;
}
function esc(s) {
  let j = nextEsc(s, 0);
  if (j === -1) return s;
  let out = '';
  let i = 0;
  while (j !== -1) {
    out += s.slice(i, j);
    out += ESC[s[j]];
    i = j + 1;
    j = nextEsc(s, i);
  }
  out += s.slice(i);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function longDate(date) {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

const COMBINING = /\p{M}/gu;
function slugifyRaw(text) {
  const plain = text.normalize('NFKD').replace(COMBINING, '');
  let out = '';
  let gap = false;
  for (let i = 0; i < plain.length; i++) {
    const ch = plain[i];
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  out = out.slice(0, 64).replace(/-+$/, '');
  return out === '' ? 'untitled' : out;
}
function slugify(text, cache) {
  let s = cache.get(text);
  if (s === undefined) {
    s = slugifyRaw(text);
    cache.set(text, s);
  }
  return s;
}
function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

// JS \s: tab lf vt ff cr space, NBSP, Ogham, en/em spaces, line/para sep,
// narrow NBSP, medium math space, ideographic space, BOM.
const SPACE_TABLE = new Uint8Array(65536);
for (const c of [9, 10, 11, 12, 13, 32, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]) SPACE_TABLE[c] = 1;
for (let c = 0x2000; c <= 0x200a; c++) SPACE_TABLE[c] = 1;
function wordsOf(text) {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    if (SPACE_TABLE[text.charCodeAt(i)]) inWord = false;
    else if (!inWord) {
      inWord = true;
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------- front matter

const FM_KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw[0] === '"') {
    if (raw.length < 2 || raw[raw.length - 1] !== '"') return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw[0] === '[') return { error: 'a bare string opens on [' };
  return { value: raw };
}

function fmValue(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const ok = raw.length === 10 && raw[4] === '-' && raw[7] === '-' &&
        raw[0] >= '0' && raw[0] <= '9' && raw[1] >= '0' && raw[1] <= '9' &&
        raw[2] >= '0' && raw[2] <= '9' && raw[3] >= '0' && raw[3] <= '9' &&
        raw[5] >= '0' && raw[5] <= '9' && raw[6] >= '0' && raw[6] <= '9' &&
        raw[8] >= '0' && raw[8] <= '9' && raw[9] >= '0' && raw[9] <= '9';
      const y = ok ? Number(raw.slice(0, 4)) : 0;
      const mo = ok ? Number(raw.slice(5, 7)) : 0;
      const d = ok ? Number(raw.slice(8, 10)) : 0;
      if (!ok || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) {
        return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      }
      return { value: raw };
    }
    case 'tags': {
      if (raw[0] !== '[' || raw[raw.length - 1] !== ']') return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      for (const t of tags) {
        if (t === '' || t.indexOf('"') !== -1 || t.indexOf('[') !== -1 || t.indexOf(']') !== -1) {
          return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        }
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return /^[a-z0-9-]+$/.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

function parseFrontMatter(text) {
  if (text !== '---' && !text.startsWith('---\n')) return { error: 'no front matter' };
  // Find the closing line: a line exactly '---'.
  let closeAt = -1; // index of the '\n' just before the closing '---'
  let closeEnd = -1; // index just past the closing line
  let p = text.indexOf('\n---', 3);
  while (p !== -1) {
    const after = p + 4;
    if (after === text.length || text[after] === '\n') {
      closeAt = p;
      closeEnd = after === text.length ? after : after + 1;
      break;
    }
    p = text.indexOf('\n---', p + 1);
  }
  if (closeAt === -1) return { error: 'the front matter is not closed' };
  const fmText = text.slice(4, closeAt);
  const lines = fmText.split('\n');
  const data = {};
  for (let j = 0; j < lines.length; j++) {
    const line = lines[j];
    if (/^[ \t]*$/.test(line) || line[0] === '#') continue;
    const ci = line.indexOf(':');
    if (ci <= 0) return { error: `line ${j + 2} is not "key: value"` };
    let keyOk = true;
    for (let k = 0; k < ci; k++) {
      const c = line.charCodeAt(k);
      if (!((c >= 97 && c <= 122) || c === 95)) { keyOk = false; break; }
    }
    if (!keyOk) return { error: `line ${j + 2} is not "key: value"` };
    const key = line.slice(0, ci);
    let raw;
    if (ci === line.length - 1) raw = '';
    else if (line[ci + 1] === ' ') raw = line.slice(ci + 2);
    else return { error: `line ${j + 2} is not "key: value"` };
    raw = raw.replace(/[ \t]+$/, '');
    if (!FM_KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = fmValue(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: text.slice(closeEnd) };
}

// ---------------------------------------------------------------- Markdown

const BLANK = /^[ \t]*$/;
const FENCE_OPEN = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const FENCE_CLOSE = /^```[ \t]*$/;
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const HR = /^(?:---|\*\*\*)[ \t]*$/;
const BULLET = /^[-*] (.*)$/;
const ORDERED = /^(\d{1,9})\. (.*)$/;
const CONTINUED = /^ {2,}\S/;

function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line[a] === ' ' || line[a] === '\t')) a++;
  while (b > a && (line[b - 1] === ' ' || line[b - 1] === '\t')) b--;
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

function headingOf(line) {
  const m = HEADING.exec(line);
  return m === null || m[2] === '' ? null : { depth: m[1].length, text: m[2] };
}

function endsParagraph(line) {
  return BLANK.test(line) || FENCE_OPEN.test(line) || headingOf(line) !== null || HR.test(line);
}

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (c !== '*') continue;
    if (s[j + 1] === '*') {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

// Inline renderer: plain runs are escaped in bulk; constructs recurse.
// Plain text is skipped with C++ indexOf jumps instead of a per-char loop.
function nextConstruct(s, from) {
  let m = s.length;
  let x;
  x = s.indexOf('\\', from);
  if (x !== -1 && x < m) m = x;
  x = s.indexOf('`', from);
  if (x !== -1 && x < m) m = x;
  x = s.indexOf('*', from);
  if (x !== -1 && x < m) m = x;
  x = s.indexOf('[', from);
  if (x !== -1 && x < m) m = x;
  return m;
}

function inline(s, env) {
  let j = nextConstruct(s, 0);
  if (j === s.length) return esc(s);
  const out = [];
  let i = 0;
  while (true) {
    if (j > i) out.push(esc(s.slice(i, j)));
    if (j === s.length) break;
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      const ch = s[j + 1];
      out.push(ch === '>' ? '&gt;' : ch);
      i = j + 2;
    } else if (c === '`') {
      const k = s.indexOf('`', j + 1);
      if (k > j + 1) {
        out.push('<code>', esc(s.slice(j + 1, k)), '</code>');
        i = k + 1;
      } else {
        out.push('`');
        i = j + 1;
      }
    } else if (c === '*') {
      if (s[j + 1] === '*') {
        const k = findUnescaped(s, '**', j + 2);
        if (k > j + 2) {
          out.push('<strong>', inline(s.slice(j + 2, k), env), '</strong>');
          i = k + 2;
        } else {
          out.push('**');
          i = j + 2;
        }
      } else {
        const k = findSingleStar(s, j + 1);
        if (k > j + 1) {
          out.push('<em>', inline(s.slice(j + 1, k), env), '</em>');
          i = k + 1;
        } else {
          out.push('*');
          i = j + 1;
        }
      }
    } else if (c === '[') {
      const k = findUnescaped(s, ']', j + 1);
      const m = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
      const target = m === -1 ? '' : s.slice(k + 2, m);
      if (target !== '' && !/\s/.test(target)) {
        out.push('<a href="', esc(env.link(target)), '">', inline(s.slice(j + 1, k), env), '</a>');
        i = m + 1;
      } else {
        out.push('[');
        i = j + 1;
      }
    } else {
      i = j + 1;
    }
    j = nextConstruct(s, i);
  }
  return out.join('');
}

// Fused lex + render: no token objects, blocks emitted straight to `out`.
function renderMarkdown(src, env, slugCache) {
  const lines = src.split('\n');
  const n = lines.length;
  const out = [];
  const toc = [];
  let excerpt = null;
  const ids = new Set();
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (BLANK.test(line)) {
      i++;
      continue;
    }
    const fence = FENCE_OPEN.exec(line);
    if (fence !== null) {
      const lang = fence[1];
      const body = [];
      i++;
      while (i < n && !FENCE_CLOSE.test(lines[i])) body.push(lines[i++]);
      i++;
      let s = lang === '' ? '<pre><code>' : `<pre><code class="language-${esc(lang)}">`;
      for (const l of body) {
        s += esc(l);
        s += '\n';
      }
      s += '</code></pre>\n';
      out.push(s);
      continue;
    }
    const heading = headingOf(line);
    if (heading !== null) {
      const id = uniqueSlug(slugify(heading.text, slugCache), ids);
      const html = inline(heading.text, env);
      out.push(`<h${heading.depth} id="${id}">${html}</h${heading.depth}>\n`);
      if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html });
      i++;
      continue;
    }
    if (HR.test(line)) {
      out.push('<hr>\n');
      i++;
      continue;
    }
    if (line[0] === '>') {
      const body = [];
      while (i < n && lines[i][0] === '>') {
        const l = lines[i++];
        body.push(trimLine(l[1] === ' ' ? l.slice(2) : l.slice(1)));
      }
      const kept = body.filter((l) => l !== '');
      out.push(kept.length === 0 ? '<blockquote>\n</blockquote>\n' : `<blockquote>\n<p>${inline(kept.join('\n'), env)}</p>\n</blockquote>\n`);
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = bullet === null ? ORDERED.exec(line) : null;
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const marker = isOrdered ? ORDERED : BULLET;
      const start = isOrdered ? Number(ordered[1]) : 1;
      const items = [];
      while (i < n) {
        const m = marker.exec(lines[i]);
        if (m !== null) {
          items.push([trimLine(isOrdered ? m[2] : m[1])]);
          i++;
        } else if (CONTINUED.test(lines[i])) {
          items[items.length - 1].push(trimLine(lines[i]));
          i++;
        } else break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && start !== 1 ? `<ol start="${start}">` : `<${tag}>`;
      let s = `${open}\n`;
      for (const parts of items) s += `<li>${inline(parts.join('\n'), env)}</li>\n`;
      s += `</${tag}>\n`;
      out.push(s);
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const html = inline(body.join('\n'), env);
    if (excerpt === null) excerpt = html;
    out.push(`<p>${html}</p>\n`);
  }
  return { html: out.join(''), toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- Templates

class TemplateError extends Error {}

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

// Flat ops: 0 text, 1 var, 2 raw, 3 if, 4 for, 5 endfor, 6 jump, 7 include.
function flattenTree(nodes) {
  const ops = [];
  const walk = (ns) => {
    for (const n of ns) {
      if (n.kind === 'text') ops.push({ k: 0, t: n.text });
      else if (n.kind === 'var') ops.push({ k: 1, p: n.path });
      else if (n.kind === 'raw') ops.push({ k: 2, p: n.path });
      else if (n.kind === 'if') {
        const op = { k: 3, p: n.path, not: n.not, els: -1, end: -1 };
        ops.push(op);
        walk(n.then);
        if (n.else !== null) {
          const jmp = { k: 6, to: -1 };
          ops.push(jmp);
          op.els = ops.length;
          walk(n.else);
          jmp.to = ops.length;
        } else op.els = ops.length;
        op.end = ops.length;
      } else if (n.kind === 'for') {
        const op = { k: 4, name: n.name, p: n.path, body: 0, end: -1 };
        ops.push(op);
        op.body = ops.length;
        walk(n.body);
        ops.push({ k: 5 });
        op.end = ops.length;
      } else if (n.kind === 'include') ops.push({ k: 7, name: n.name });
    }
  };
  walk(nodes);
  return ops;
}

// Transitive free path roots of template `name` under bound loop names.
// null when an include cycle makes the answer unsafe to cache on.
function freeOf(ctx, name, bound, visiting, memo) {
  const key = `${name}|${[...bound].sort().join(',')}`;
  if (memo.has(key)) return memo.get(key);
  if (visiting.has(key)) return null;
  const t = ctx.templates.get(name);
  if (t === undefined) return new Set();
  visiting.add(key);
  const free = new Set();
  const ok = walkTreeFree(ctx, t.tree, bound, free, visiting, memo);
  visiting.delete(key);
  const res = ok ? free : null;
  memo.set(key, res);
  return res;
}

function walkTreeFree(ctx, nodes, bound, free, visiting, memo) {
  for (const n of nodes) {
    if (n.kind === 'text') continue;
    if (n.kind === 'var' || n.kind === 'raw' || n.kind === 'if') {
      if (!bound.has(n.path[0])) free.add(n.path[0]);
      if (n.kind === 'if') {
        if (!walkTreeFree(ctx, n.then, bound, free, visiting, memo)) return false;
        if (n.else !== null && !walkTreeFree(ctx, n.else, bound, free, visiting, memo)) return false;
      }
    } else if (n.kind === 'for') {
      if (!bound.has(n.path[0])) free.add(n.path[0]);
      const b2 = new Set(bound);
      b2.add(n.name);
      b2.add('loop');
      if (!walkTreeFree(ctx, n.body, b2, free, visiting, memo)) return false;
    } else if (n.kind === 'include') {
      const sub = freeOf(ctx, n.name, bound, visiting, memo);
      if (sub === null) return false;
      for (const r of sub) free.add(r);
    }
  }
  return true;
}

function lookup(scope, path) {
  let s = scope;
  while (s !== null && !hasOwn(s.vars, path[0])) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

function renderOps(ops, scope, out, ctx, depth) {
  let pc = 0;
  let curScope = scope;
  const stack = [];
  while (pc < ops.length) {
    const op = ops[pc];
    switch (op.k) {
      case 0:
        out.push(op.t);
        pc++;
        break;
      case 1:
        out.push(esc(textOf(lookup(curScope, op.p))));
        pc++;
        break;
      case 2:
        out.push(textOf(lookup(curScope, op.p)));
        pc++;
        break;
      case 3:
        pc = truthy(lookup(curScope, op.p)) !== op.not ? pc + 1 : op.els;
        break;
      case 4: {
        const xs = lookup(curScope, op.p);
        if (!Array.isArray(xs) || xs.length === 0) {
          pc = op.end;
          break;
        }
        const vars = {};
        vars[op.name] = xs[0];
        const loop = { index: 1, first: true, last: xs.length === 1, length: xs.length };
        vars.loop = loop;
        stack.push({ name: op.name, arr: xs, idx: 0, vars, loop, parent: curScope, body: op.body });
        curScope = { vars, parent: curScope };
        pc = op.body;
        break;
      }
      case 5: {
        const fr = stack[stack.length - 1];
        fr.idx++;
        if (fr.idx < fr.arr.length) {
          fr.vars[fr.name] = fr.arr[fr.idx];
          fr.loop.index = fr.idx + 1;
          fr.loop.first = false;
          fr.loop.last = fr.idx === fr.arr.length - 1;
          pc = fr.body;
        } else {
          stack.pop();
          curScope = fr.parent;
          pc++;
        }
        break;
      }
      case 6:
        pc = op.to;
        break;
      case 7: {
        const t = ctx.templates.get(op.name);
        if (t !== undefined && depth < 8) {
          const cd = depth + 1;
          if (t.kind === 1) {
            const gk = `${op.name}|${cd}`;
            let s = ctx.globalCache.get(gk);
            if (s === undefined) {
              const tmp = [];
              renderOps(t.ops, curScope, tmp, ctx, cd);
              s = tmp.join('');
              ctx.globalCache.set(gk, s);
            }
            out.push(s);
          } else if (t.kind === 2) {
            const v = lookup(curScope, [t.keyRoot]);
            if (v !== null && typeof v === 'object') {
              let m = ctx.objCache.get(v);
              if (m === undefined) {
                m = new Map();
                ctx.objCache.set(v, m);
              }
              const ck = `${op.name}|${cd}`;
              let s = m.get(ck);
              if (s === undefined) {
                const tmp = [];
                renderOps(t.ops, curScope, tmp, ctx, cd);
                s = tmp.join('');
                m.set(ck, s);
              }
              out.push(s);
            } else {
              const ck = `${op.name}|${cd}|${v === undefined ? 'u' : v === null ? 'n' : `${typeof v}:${String(v)}`}`;
              let s = ctx.primCache.get(ck);
              if (s === undefined) {
                const tmp = [];
                renderOps(t.ops, curScope, tmp, ctx, cd);
                s = tmp.join('');
                ctx.primCache.set(ck, s);
              }
              out.push(s);
            }
          } else {
            renderOps(t.ops, curScope, out, ctx, cd);
          }
        }
        pc++;
        break;
      }
      default:
        pc++;
    }
  }
}

// ---------------------------------------------------------------- build

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path) => {
  const k = path.lastIndexOf('/');
  return k === -1 ? '' : path.slice(0, k);
};

export function run(input) {
  const ctx = {
    templates: new Map(),
    globalCache: new Map(),
    primCache: new Map(),
    objCache: new WeakMap(),
    slugCache: new Map(),
  };
  const report = [];

  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      const tree = parseTemplate(name, input.templates[name]);
      ctx.templates.set(name, { tree, ops: null, free: null, kind: 0, keyRoot: null });
    } catch (err) {
      if (err instanceof TemplateError) report.push(err.message);
      else throw err;
    }
  }
  const memo = new Map();
  for (const [tname, t] of ctx.templates) {
    t.free = freeOf(ctx, tname, new Set(), new Set(), memo);
    if (t.free !== null) {
      const nonGlobal = [...t.free].filter((r) => r !== 'site' && r !== 'tags' && r !== 'recent');
      if (nonGlobal.length === 0) t.kind = 1;
      else if (nonGlobal.length === 1 && nonGlobal[0] !== 'loop') {
        t.kind = 2;
        t.keyRoot = nonGlobal[0];
      }
    }
    t.ops = flattenTree(t.tree);
  }

  const base = input.site.base_url.replace(/\/+$/, '');
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      sources.push({ path: f.path, text: f.content.indexOf('\r') === -1 ? f.content : f.content.replace(/\r\n?/g, '\n') });
    } else statics.push({ path: f.path, content: f.content });
  }

  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    const own = s.path.startsWith('tags/') ? 'tags' : s.path.startsWith('page/') ? 'page' : undefined;
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!ctx.templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }

  const taken = new Map();
  const takenIn = (dir) => {
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? ['posts', 'tags', 'page'] : []);
      taken.set(dir, set);
    }
    return set;
  };
  const bySource = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title, ctx.slugCache), takenIn(dir));
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  for (const s of kept) {
    const dir = dirOf(s.path);
    const env = {
      link: (target) => {
        if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('/') || target.startsWith('#')) return target;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        if (path !== null && bySource.has(path)) return `${bySource.get(path).url}${frag}`;
        if (path !== null && staticPaths.has(path)) return `${base}/${path}${frag}`;
        broken.add(`broken-link ${s.path} -> ${target}`);
        return target;
      },
    };
    const md = renderMarkdown(s.body, env, ctx.slugCache);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of s.data.tags ?? []) {
      const slug = slugify(name, ctx.slugCache);
      if (!seen.has(slug)) {
        seen.add(slug);
        out.push(name);
      }
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name, ctx.slugCache);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (s.post) continue;
    s.tagRefs = ownTags(s).map((name) => {
      const slug = slugify(name, ctx.slugCache);
      return bySlug.get(slug) ?? { name, slug, url: '', posts: [] };
    });
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });
  const cardOf = (s) => ({
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  });
  const pageOf = (s, card) => ({
    ...card,
    slug: s.slug,
    content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  });

  const output = {};
  const cards = new Map(posts.map((p) => [p, cardOf(p)]));
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const render = (name, vars) => {
    const t = ctx.templates.get(name);
    if (t === undefined) return null;
    const out = [];
    renderOps(t.ops, { vars: { site, tags: allTags, recent, ...vars }, parent: null }, out, ctx, 0);
    return out.join('');
  };
  for (const s of kept) output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s, s.post ? cards.get(s) : cardOf(s)) });
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) } });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }
  const lines = [...report, ...broken].sort(byCodeUnits);
  const pageCount = kept.filter((s) => !s.post).length;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = `${lines.join('\n')}\n`;
  return output;
}
