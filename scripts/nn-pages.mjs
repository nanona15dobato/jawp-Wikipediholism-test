#!/usr/bin/env node
// nn-pages.mjs — 静的サイト（GitHub Pages など）用の nanona-ui ビルドツール。依存なし（Node 18 以上）。
//
// ページの HTML に次の目印を書いておくと、公開用のフォルダ（既定 _site/）に出力するときに置き換える：
//   <!-- nn:head -->    テーマ判定・nanona.css・nanona.js（<head> 内に書く）
//   <!-- nn:header -->  共通ヘッダー（サイト名・メニューは nanona.config.json から）
//   <!-- nn:footer -->  共通フッター（中身は nanona.config.json から）
// テンプレートは nanona-ui（https://ui.nanona.me/v1/templates/）から取得する。
// あわせて sitemap.xml と .nojekyll を出力する。
//
// 使い方：
//   node scripts/nn-pages.mjs                         … ビルド（テンプレートは https://ui.nanona.me/v1 から取得）
//   node scripts/nn-pages.mjs --ui https://nanona-ui.pages.dev/v1
//                                                     … CI 用。ui.nanona.me は Cloudflare のボット対策で CI からの取得が止まるため、
//                                                       Pages の元アドレスから取得する（ページが読むのは ui.nanona.me のまま）
//   node scripts/nn-pages.mjs --ui ../nanona-ui/dist/v1 --serve 4400
//                                                     … ローカルの nanona-ui で確認（http://localhost:4400/ で配信）
//
// このファイルの元は nanona-ui リポジトリの tools/nn-pages.mjs。直すときは元を直して各リポジトリへ写す。

import { readFile, writeFile, mkdir, rm, readdir, copyFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const UI_DEFAULT = 'https://ui.nanona.me/v1';
const DEFAULT_EXCLUDE = ['.git', '.github', '.gitignore', 'node_modules', 'scripts', 'nanona.config.json', 'AGENTS.md', 'CLAUDE.md', '_config.yml'];

/* ---------- 引数と設定 ---------- */

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const root = process.cwd();
let config = JSON.parse(await readFile(path.join(root, 'nanona.config.json'), 'utf8'));

// "extends"：ヘッダー・フッターの中身を別の JSON（URL かパス）から引き継ぐ。
// 同じドメインの複数リポジトリでヘッダーを共通にするときに使う。手元では --extends でパスに差し替えられる
const extendsSource = opt('--extends') || config.extends;
if (extendsSource) {
  const base = /^https?:\/\//.test(extendsSource)
    ? await fetch(extendsSource).then((r) => {
      if (!r.ok) throw new Error(`${extendsSource} を取得できません（HTTP ${r.status}）`);
      return r.json();
    })
    : JSON.parse(await readFile(path.resolve(root, extendsSource), 'utf8'));
  config = { ...base, ...config };
}
const uiSource = opt('--ui') || UI_DEFAULT;
const outDir = path.join(root, opt('--out') || config.out || '_site');
const servePort = opt('--serve');
const basePath = ensureSlashes(config.basePath || '/');

function ensureSlashes(p) {
  return ('/' + p + '/').replace(/\/+/g, '/');
}

/* ---------- テンプレート ---------- */

const isUrl = /^https?:\/\//.test(uiSource);
const uiDir = isUrl ? null : path.resolve(root, uiSource);
async function loadUi(file) {
  if (isUrl) {
    const res = await fetch(`${uiSource.replace(/\/$/, '')}/${file}`);
    if (!res.ok) {
      // 原因を調べやすいように、Cloudflare などの応答の手がかりを出す
      const hints = ['server', 'cf-ray', 'cf-mitigated', 'cf-cache-status']
        .map((h) => res.headers.get(h) && `${h}: ${res.headers.get(h)}`).filter(Boolean).join(', ');
      const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
      throw new Error(`${file} を取得できません（HTTP ${res.status}）${hints ? `\n  ${hints}` : ''}${body ? `\n  ${body}` : ''}`);
    }
    return res.text();
  }
  return readFile(path.join(uiDir, file), 'utf8');
}
const stripComment = (s) => s.replace(/^<!--[\s\S]*?-->\s*/, '');

// ローカルの nanona-ui で確認するときは、CSS・JS の参照先もそちらに向ける
// （--ui がフォルダのときは --serve のサーバーが /__nanona-ui/ で配信する）
// ページに書く CSS・JS の参照先。取得元（--ui）とは別で、既定は常に https://ui.nanona.me/v1。
// CI では Cloudflare のボット対策を避けるため --ui https://nanona-ui.pages.dev/v1 から取得するが、ページは ui.nanona.me を読む。
// --ui にフォルダを渡して --serve で確認するときだけ、確認用サーバーの /__nanona-ui/ を読む
const uiPublicBase = (opt('--ui-public') || (!isUrl && servePort ? '/__nanona-ui' : UI_DEFAULT)).replace(/\/$/, '');
const rebase = (s) => s.split(UI_DEFAULT).join(uiPublicBase);

const tpl = {
  head: rebase(stripComment(await loadUi('templates/head.html'))),
  header: stripComment(await loadUi('templates/header.html')),
  footer: stripComment(await loadUi('templates/footer.html')),
};

/* ---------- 置き換え ---------- */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// URL のパスを比較用にそろえる（index.html と末尾の / を落とす）
const norm = (p) => p.replace(/index\.html$/, '').replace(/(.)\/$/, '$1');

// メニュー（子項目 children を含む）を平らにした一覧
const flatNav = (nav) => nav.flatMap((item) => [item, ...flatNav(item.children || [])]);

// ページのパス（basePath からの絶対パス）に対して、メニューの現在地を決める
function currentHref(pagePath, nav) {
  const here = norm(pagePath);
  let best = null;
  for (const item of flatNav(nav)) {
    if (/^https?:/.test(item.href)) continue;
    const p = norm(new URL(item.href, 'http://x' + pagePath).pathname);
    const hit = here === p || (p !== norm(basePath) && here.startsWith(p + '/'));
    if (hit && (!best || p.length > best.length)) best = { href: item.href, length: p.length };
  }
  return best && best.href;
}

// メニュー項目を <li> にする。子項目があればサブメニュー（.nn-header__sub）を付け、
// 子が現在地なら親にも .nn-header__parent--current を付ける
function renderNavItems(items, current, indent) {
  return items.map((item) => {
    const children = item.children || [];
    const isCurrent = item.href === current;
    const childCurrent = flatNav(children).some((c) => c.href === current);
    const attrs = (isCurrent ? ' aria-current="page"' : '') + (childCurrent ? ' class="nn-header__parent--current"' : '');
    const link = `<a href="${esc(item.href)}"${attrs}>${esc(item.label)}</a>`;
    if (children.length === 0) return `${indent}<li>${link}</li>`;
    return `${indent}<li class="nn-header__has-sub">${link}\n` +
      `${indent}  <ul class="nn-header__sub">\n${renderNavItems(children, current, indent + '    ')}\n${indent}  </ul>\n` +
      `${indent}</li>`;
  }).join('\n');
}

function renderHeader(pagePath) {
  const nav = config.nav || [];
  const current = currentHref(pagePath, nav);
  let html = tpl.header
    .replace('{{title_href}}', () => esc(config.titleHref || basePath))
    .replace('{{title}}', () => esc(config.title))
    .replace('{{nav_label}}', () => esc(config.navLabel || `${config.title}のメニュー`))
    .replace('{{tools}}', () => config.tools || '')
    .replace('{{nav}}', () => renderNavItems(nav, current, '        '));
  if (nav.length === 0) {
    html = html.replace(/[ \t]*<!-- nn:nav -->[\s\S]*?<!-- \/nn:nav -->\n?/g, '').replace(' nn-header--has-nav', '');
  } else {
    html = html.replace(/[ \t]*<!-- \/?nn:nav -->\n/g, '');
  }
  if (config.home === false) html = html.replace(/\s*<a class="nn-header__home"[^>]*>[^<]*<\/a>/, '');
  return html.trim();
}

// note：ページ固有のフッター文（出典など）。共通の中身の上に置く
function renderFooter(note) {
  const content = (note ? `    <div class="nn-footer__note">\n${note}\n    </div>\n` : '') + (config.footer || '');
  let html = tpl.footer.replace('{{content}}', () => content);
  if (config.home === false) html = html.replace(/\s*<div class="nn-footer__base">[\s\S]*?<\/div>/, '');
  return html.trim();
}

function transform(source, pagePath) {
  if (!source.includes('<!-- nn:')) return null;
  // <!-- nn:footer-note --> … <!-- /nn:footer-note --> で囲んだ部分は、ページから外してフッターへ移す
  let note = '';
  source = source.replace(/[ \t]*<!-- nn:footer-note -->([\s\S]*?)<!-- \/nn:footer-note -->[ \t]*\r?\n?/, (m, inner) => {
    note = inner.replace(/^\s*\n|\s*$/g, '');
    return '';
  });
  return source
    .replace('<!-- nn:head -->', () => tpl.head.trim())
    .replace('<!-- nn:header -->', () => renderHeader(pagePath))
    .replace('<!-- nn:footer -->', () => renderFooter(note));
}

/* ---------- 出力 ---------- */

const exclude = new Set([...DEFAULT_EXCLUDE, ...(config.exclude || []), path.basename(outDir)]);
const pages = [];

async function walk(dir, rel = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (exclude.has(relPath) || exclude.has(entry.name)) continue;
    const from = path.join(dir, entry.name);
    const to = path.join(outDir, relPath);
    if (entry.isDirectory()) {
      await mkdir(to, { recursive: true });
      await walk(from, relPath);
    } else if (entry.name.endsWith('.html')) {
      const pagePath = basePath + relPath;
      const out = transform(await readFile(from, 'utf8'), pagePath);
      if (out !== null) {
        await writeFile(to, out);
        pages.push(relPath);
      } else {
        await copyFile(from, to);
      }
    } else {
      await copyFile(from, to);
    }
  }
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await walk(root);
await writeFile(path.join(outDir, '.nojekyll'), '');

// sitemap.xml（以前の jekyll-sitemap の代わり）
if (config.siteUrl) {
  const site = config.siteUrl.replace(/\/?$/, '/');
  const skip = config.sitemapExclude || [];
  const urls = pages
    .filter((p) => !skip.some((s) => p === s || p.startsWith(s.replace(/\/?$/, '/'))))
    .map((p) => `  <url><loc>${esc(site + p.replace(/(^|\/)index\.html$/, '$1'))}</loc></url>`);
  await writeFile(path.join(outDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
}

console.log(`nn-pages: ${pages.length} ページに nanona-ui を差し込みました → ${path.relative(root, outDir) || '.'}`);

/* ---------- 確認用サーバー ---------- */

if (servePort) {
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.xml': 'application/xml' };
  createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file;
    if (!isUrl && p.startsWith('/__nanona-ui/')) file = path.join(uiDir, p.slice('/__nanona-ui/'.length));
    else if (p.startsWith(basePath)) file = path.join(outDir, p.slice(basePath.length));
    else if (p === '/') { res.writeHead(302, { Location: basePath }).end(); return; }
    else { res.writeHead(404).end(); return; }
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      res.writeHead(200, { 'Content-Type': (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end('Not found');
    }
  }).listen(Number(servePort), () => console.log(`確認用：http://localhost:${servePort}${basePath}`));
}
