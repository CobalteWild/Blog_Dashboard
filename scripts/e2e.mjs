import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:8833/?skip=1';
const SHOT = 'D:/FAKU/Documents/Blog/Github Pages/admin/_shot_e2e.png';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForSelector('.EasyMDEContainer', { timeout: 10000 });
check('编辑器初始化', true);

// 1. 布局
const layout = await page.evaluate(() => {
  const r = (s) => Math.round(document.querySelector(s).getBoundingClientRect().height);
  return { wrap: r('.editor-wrap'), cm: r('.CodeMirror') };
});
check('编辑器撑满高度', layout.cm > layout.wrap * 0.7, `${layout.cm}/${layout.wrap}px`);

// 2. front-matter 往返
const fm = await page.evaluate(() => {
  const b = window.__blog;
  const doc = {
    title: '测试：标题 "带引号" 与特殊字符 #',
    date: new Date('2026-10-27T15:30:00'),
    categories: ['技术'],
    tags: ['GitHub Pages', 'Hexo'],
    excerpt: '这是摘要',
    draft: false,
    body: '正文内容',
  };
  const text = b.buildFrontMatter(doc) + doc.body;
  const parsed = b.splitFrontMatter(text);
  return { text, parsedTitle: parsed.data.title, parsedTags: parsed.data.tags, body: parsed.body };
});
check('front-matter 生成', fm.text.startsWith('---\ntitle: '), fm.text.split('\n')[1]);
check('front-matter 往返 title', fm.parsedTitle === '测试：标题 "带引号" 与特殊字符 #', String(fm.parsedTitle));
check('front-matter 往返 tags', Array.isArray(fm.parsedTags) && fm.parsedTags.length === 2, JSON.stringify(fm.parsedTags));
check('front-matter 正文剥离', fm.body === '正文内容', JSON.stringify(fm.body));

// 3. 分屏预览 + KaTeX
await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  cm.setValue([
    '# 标题一',
    '',
    '行内公式 $E = mc^2$ 应该被渲染。',
    '',
    '$$',
    '\\int_0^1 x^2 \\, dx = \\frac{1}{3}',
    '$$',
    '',
    '代码里的 `$not_math$` 不应渲染。',
    '',
    '![测试图](/images/2026/10/demo.webp)',
  ].join('\n'));
});
await page.click('button.split');
await new Promise((r) => setTimeout(r, 1200));

const preview = await page.evaluate(() => {
  const el = document.querySelector('#sidePreview');
  if (!el) return null;
  const pane = el.parentElement;
  return {
    katexCount: el.querySelectorAll('.katex').length,
    katexDisplay: el.querySelectorAll('.katex-display').length,
    hasH1: !!el.querySelector('h1'),
    codeDollar: el.querySelector('code')?.textContent || '',
    imgSrc: el.querySelector('img')?.getAttribute('src') || '',
    paneVisible: getComputedStyle(pane).display !== 'none',
    paneWidth: Math.round(pane.getBoundingClientRect().width),
    toolbarHeight: Math.round(document.querySelector('.editor-toolbar').getBoundingClientRect().height),
    sidebarVisible: !!document.querySelector('.sidebar'),
    metaVisible: !!document.querySelector('.meta'),
  };
});
check('分屏面板可见', !!preview && preview.paneVisible && preview.paneWidth > 300, `w=${preview?.paneWidth}`);
check('分屏时表单/侧栏仍存在', preview && preview.sidebarVisible && preview.metaVisible);
check('KaTeX 行内公式渲染', preview && preview.katexCount >= 2, `katex=${preview?.katexCount}`);
check('KaTeX 块级公式渲染', preview && preview.katexDisplay >= 1, `display=${preview?.katexDisplay}`);
check('代码内 $ 不被当作公式', preview && preview.codeDollar === '$not_math$', preview?.codeDollar);
check('标题渲染', preview && preview.hasH1);

// 4. 自动本地保存（IndexedDB，不再是 localStorage 草稿）
await new Promise((r) => setTimeout(r, 2200));
const autoSave = await page.evaluate(async () => {
  const legacyDraft = localStorage.getItem('blog-admin:draft:v1');
  const files = await window.__blog.localStoreList();
  const withBody = files.filter((f) => (f.content || '').length > 50);
  return { legacyDraftExists: !!legacyDraft, fileCount: files.length, bodyCount: withBody.length };
});
check('不再写 localStorage 草稿', autoSave.legacyDraftExists === false, JSON.stringify(autoSave));
check('自动保存进本地库', autoSave.bodyCount > 0, JSON.stringify(autoSave));

await page.screenshot({ path: SHOT });
check('截图已保存', true, SHOT);

// 5. 本地图片识别
const refs = await page.evaluate(() => {
  const body = [
    '![a](./img/a.png)',
    '![b](https://example.com/b.png)',
    '![c](/images/2026/10/c.webp)',
    '![d](img/d.png "标题")',
    '![e](data:image/png;base64,xxx)',
  ].join('\n\n');
  return window.__blog.findLocalImageRefs(body);
});
check('识别本地图片', refs.length === 2, JSON.stringify(refs.map((r) => r.path)));
check('排除外链与站内绝对路径',
  refs.every((r) => !r.path.startsWith('http') && !r.path.startsWith('/')),
  JSON.stringify(refs.map((r) => r.path)));

// 6. 导入含本地图片的 md
const imported = await page.evaluate(async () => {
  const text = '---\ntitle: 导入测试\ndate: 2026-10-01 10:00:00\ntags:\n  - 测试\n---\n\n正文\n\n![本地图](assets/pic-1.png)\n';
  const file = new File([text], 'imported.md', { type: 'text/markdown' });
  await window.__blog.importMarkdown(file);
  return {
    title: document.querySelector('#fTitle').value,
    hintHidden: document.querySelector('#imageHint').hidden,
    hintText: document.querySelector('#imageHintText').textContent,
    pending: window.__blog.state.pendingLocalImages.length,
    body: window.__blog.editor.value(),
  };
});
check('导入 md 填充标题', imported.title === '导入测试', imported.title);
check('导入后显示图片提示', !imported.hintHidden && imported.pending === 1, imported.hintText);
check('正文完整导入', imported.body.includes('![本地图](assets/pic-1.png)'));

// 7. 定时构建 workflow
const wfHexo = await page.evaluate(() => window.__blog.buildScheduledWorkflow());
check('workflow 含每小时 cron', wfHexo.includes("- cron: '0 * * * *'"));
check('workflow 使用 hexo 构建', wfHexo.includes('npx hexo generate'));
const wfHugo = await page.evaluate(() => {
  window.__blog.state.settings.framework = 'hugo';
  const s = window.__blog.buildScheduledWorkflow();
  window.__blog.state.settings.framework = 'hexo';
  return s;
});
check('workflow 切换为 hugo 构建', wfHugo.includes('hugo --minify'));

// 8. 定时发布提示
let dialogMsg = null;
page.once('dialog', async (d) => { dialogMsg = d.message(); await d.dismiss(); });
await page.evaluate(() => {
  Object.assign(window.__blog.state.settings, { owner: 'o', repo: 'r', token: 't' });
  document.querySelector('#fTitle').value = '未来文章';
  const d = new Date(Date.now() + 36e5);
  const p = (n) => String(n).padStart(2, '0');
  document.querySelector('#fDate').value =
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
});
await page.click('#btnPublish');
await new Promise((r) => setTimeout(r, 600));
check('未来日期触发定时提示', !!dialogMsg && dialogMsg.includes('未来'), (dialogMsg || '').slice(0, 30));
const statusAfter = await page.evaluate(() => document.querySelector('#statusText').textContent);
check('取消后状态为已取消', statusAfter.includes('已取消'), statusAfter);

// 9. 图床上传路径与请求格式（mock fetch，不发真实请求）
const uploaded = await page.evaluate(async () => {
  const origFetch = window.fetch;
  const calls = [];
  window.fetch = async (url, opts = {}) => {
    calls.push({
      url: String(url),
      method: opts.method || 'GET',
      body: opts.body ? JSON.parse(opts.body) : null,
    });
    return new Response(JSON.stringify({ content: { sha: 'deadbeef' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    // 填充噪点，保证 PNG 体积远大于 WebP，从而走进压缩路径
    const img = ctx.createImageData(800, 600);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = Math.random() * 255;
      img.data[i + 1] = Math.random() * 255;
      img.data[i + 2] = Math.random() * 255;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const file = new File([blob], 'pic.png', { type: 'image/png' });
    const url = await window.__blog.uploadImage(file);
    return { url, calls };
  } finally {
    window.fetch = origFetch;
  }
});
const upCall = uploaded.calls[0] || {};
check('图片提交到 <图片目录>/年/月/', /\/contents\/source\/images\/\d{4}\/\d{2}\/[^/]+\.webp$/.test(upCall.url || ''), upCall.url);
check('图片提交方式为 PUT', upCall.method === 'PUT', upCall.method);
check('图片内容为 base64', /^[A-Za-z0-9+/=]+$/.test(upCall.body?.content || ''), (upCall.body?.content || '').slice(0, 16));
check('返回文章内可用的路径', /^\/images\/\d{4}\/\d{2}\/[^/]+\.webp$/.test(uploaded.url || ''), uploaded.url);

// 10. 中文文件名编码
const enc = await page.evaluate(async () => {
  const origFetch = window.fetch;
  let captured = null;
  window.fetch = async (url, opts) => {
    captured = { url: String(url), body: opts.body ? JSON.parse(opts.body) : null };
    return new Response(JSON.stringify({ content: { sha: 'x' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await window.__blog.putFile('source/_posts/2026-10-27-中文标题.md', '# hi', 'post: 中文标题', 'sha1');
    return captured;
  } finally {
    window.fetch = origFetch;
  }
});
check('中文文件名已 URL 编码', (enc.url || '').includes(encodeURIComponent('中文标题')), (enc.url || '').slice(-60));
check('更新文件时带上 sha', enc.body?.sha === 'sha1');
check('提交包含 branch', enc.body?.branch === 'main', enc.body?.branch);

// 11. 连接状态判定：目录不存在不能算连接失败
const conn = await page.evaluate(async () => {
  const b = window.__blog;
  const dot = document.querySelector('#connDot');
  const status = () => document.querySelector('#statusText').textContent;
  const json = (obj, code = 200) => new Response(JSON.stringify(obj), {
    status: code,
    headers: { 'Content-Type': 'application/json' },
  });

  const setup = () => Object.assign(b.state.settings, {
    owner: 'o', repo: 'r', token: 't', branch: 'main', postsPath: 'source/_posts',
  });

  const run = async (handler) => {
    // 每次都从干净的本地库开始，避免自动保存的文件影响断言
    try { await b.localStoreClear(); } catch {}
    const orig = window.fetch;
    window.fetch = handler;
    try {
      await b.loadPosts();
    } finally {
      window.fetch = orig;
    }
    return {
      ok: dot.classList.contains('ok'),
      bad: dot.classList.contains('bad'),
      status: status(),
    };
  };

  const out = {};
  setup();
  out.dirMissing = await run(async (url) => {
    const u = String(url);
    if (u.endsWith('/repos/o/r')) {
      return json({ full_name: 'o/r', default_branch: 'main', private: false, size: 0 });
    }
    if (u.includes('/git/trees/')) {
      return json({ tree: [{ path: 'index.html', type: 'blob', sha: 'a' }], truncated: false });
    }
    return json({ message: 'Not Found' }, 404);
  });

  setup();
  out.repo404 = await run(async () => json({ message: 'Not Found' }, 404));

  setup();
  out.auth401 = await run(async () => json({ message: 'Bad credentials' }, 401));

  setup();
  out.network = await run(async () => { throw new TypeError('Failed to fetch'); });

  return out;
});
await page.evaluate(async () => { try { await window.__blog.localStoreClear(); } catch {} });
check('没有文章时仍显示已连接', conn.dirMissing.ok && !conn.dirMissing.bad, conn.dirMissing.status);
check('没有文章时显示 0 篇', /0 篇文章/.test(conn.dirMissing.status), conn.dirMissing.status);
check('仓库 404 显示失败', conn.repo404.bad && !conn.repo404.ok, conn.repo404.status);
check('401 提示 Token 问题', conn.auth401.bad && /Token/.test(conn.auth401.status), conn.auth401.status);
check('网络异常提示无法连接', conn.network.bad && /无法连接/.test(conn.network.status), conn.network.status);

// 12. Hexo 骨架文件
const hexo = await page.evaluate(() => {
  const b = window.__blog;
  Object.assign(b.state.settings, {
    owner: 'FAKUMARER', repo: 'blog', branch: 'main',
    siteUrl: 'https://fakumare.github.io/blog', token: 't',
  });
  const files = b.buildHexoFiles();
  return {
    count: files.length,
    paths: files.map((f) => f.path),
    site: b.deriveSite(),
    config: files.find((f) => f.path === '_config.yml').content,
    pkg: files.find((f) => f.path === 'package.json').content,
  };
});
check('生成 7 个骨架文件', hexo.count === 7, hexo.paths.join(', '));
check('推导出子路径 root', hexo.site.root === '/blog/' && hexo.site.imagePrefix === '/blog/images', JSON.stringify(hexo.site));
check('配置写入 root 与 future:false', hexo.config.includes('root: /blog/') && hexo.config.includes('future: false'));
check('配置启用 katex 插件', hexo.config.includes('@traptitech/markdown-it-katex'));
check('package.json 合法', (() => { try { JSON.parse(hexo.pkg); return true; } catch { return false; } })());

// 13. 批量提交的 API 序列
const seq = await page.evaluate(async () => {
  const b = window.__blog;
  const calls = [];
  const orig = window.fetch;
  window.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    calls.push({ method, u: u.replace('https://api.github.com/repos/FAKUMARER/blog', '') });
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/git/ref/heads/main') && method === 'GET') return json({ object: { sha: 'head1' } });
    if (u.includes('/git/commits/head1')) return json({ tree: { sha: 'tree1' } });
    if (u.endsWith('/git/trees') && method === 'POST') return json({ sha: 'tree2' });
    if (u.endsWith('/git/commits') && method === 'POST') return json({ sha: 'commit2' });
    if (u.endsWith('/git/refs/heads/main') && method === 'PATCH') return json({ object: { sha: 'commit2' } });
    return json({});
  };
  try {
    await b.commitFiles([{ path: 'a.md', content: 'x' }], 'test');
  } finally {
    window.fetch = orig;
  }
  return calls;
});
check('读取分支 HEAD', seq[0]?.method === 'GET' && seq[0].u === '/git/ref/heads/main', JSON.stringify(seq[0]));
check('读取父提交 tree', seq[1]?.u === '/git/commits/head1', JSON.stringify(seq[1]));
check('创建新 tree', seq[2]?.method === 'POST' && seq[2].u === '/git/trees');
check('创建 commit', seq[3]?.method === 'POST' && seq[3].u === '/git/commits');
check('更新分支引用', seq[4]?.method === 'PATCH' && seq[4].u === '/git/refs/heads/main');
check('共 6 次 API 调用（第 6 次为 Action 状态探测）', seq.length === 6 && seq[5].u.includes('/actions/runs'), String(seq.length));

// 14. Token 权限检查
const perm = await page.evaluate(async () => {
  const b = window.__blog;
  const set = (id, v) => { document.querySelector(id).value = v; };
  set('#sOwner', 'o');
  set('#sRepo', 'r');
  set('#sBranch', 'main');
  set('#sToken', 'github_pat_test123');
  set('#sSiteUrl', '');
  set('#sPosts', 'source/_posts');
  set('#sImages', 'source/images');
  set('#sPrefix', '/images');

  const orig = window.fetch;
  window.fetch = async (url) => {
    const u = String(url);
    const json = (o, code = 200, h = {}) => new Response(JSON.stringify(o), {
      status: code,
      headers: { 'Content-Type': 'application/json', ...h },
    });
    if (u.endsWith('/user')) {
      return json({ login: 'FAKUMARER' }, 200, { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4998' });
    }
    if (u.endsWith('/repos/o/r')) {
      return json({ full_name: 'o/r', private: false, permissions: { push: true, admin: false, pull: true } });
    }
    if (u.includes('/actions/workflows')) return json({ total_count: 0 });
    if (u.endsWith('/pages')) return json({ message: 'Not Found' }, 404);
    return json({});
  };
  try {
    await b.checkTokenPermissions();
  } finally {
    window.fetch = orig;
  }
  return {
    visible: !document.querySelector('#permResult').hidden,
    items: [...document.querySelectorAll('#permList li')].map((li) => ({ cls: li.className, text: li.textContent })),
  };
});
check('权限面板可见', perm.visible);
check('列出 7 项常用权限', perm.items.length === 7, String(perm.items.length));
check('识别 token 类型', perm.items.some((i) => i.text.includes('fine-grained token')), perm.items[0]?.text);
check('识别写权限', perm.items.some((i) => i.cls.includes('ok') && i.text.includes('可以提交文章')), '');
check('识别 Pages 未启用', perm.items.some((i) => i.text.includes('尚未启用')), '');
check('显示 API 配额', perm.items.some((i) => i.text.includes('4998/5000')), '');

const permBad = await page.evaluate(async () => {
  const orig = window.fetch;
  window.fetch = async () => new Response(JSON.stringify({ message: 'Bad credentials' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
  try {
    await window.__blog.checkTokenPermissions();
  } finally {
    window.fetch = orig;
  }
  return [...document.querySelectorAll('#permList li')].map((li) => li.textContent);
});
check('无效 token 只报一行错误', permBad.length === 1 && permBad[0].includes('Token 无效'), permBad[0]);

// 15. 分类目录与文章 URL
const paths = await page.evaluate(() => {
  const b = window.__blog;
  Object.assign(b.state.settings, {
    owner: 'FAKUMARER', repo: 'blog', branch: 'main',
    siteUrl: 'https://fakumare.github.io/blog',
    postsPath: 'source/_posts', imagePrefix: '/blog/images',
  });
  b.updateVisitSite();
  return {
    folder: b.sanitizeFolder('技术'),
    folderEmpty: b.sanitizeFolder(''),
    folderBad: b.sanitizeFolder('a/b:c*d'),
    folderSpace: b.sanitizeFolder(' 机器学习 '),
    url1: b.postUrl({ name: '2026-10-27-hello.md', path: 'source/_posts/技术/2026-10-27-hello.md', folder: '技术' }),
    url2: b.postUrl({ name: 'no-date.md', path: 'source/_posts/临时/no-date.md', folder: '临时' }),
    visit: (() => {
      const a = document.querySelector('#siteLink');
      const r = document.querySelector('#repoLink');
      if (!a || !r) return { hidden: true, href: null, disabled: true };
      return { hidden: a.classList.contains('disabled'), href: a.getAttribute('href'), repoHref: r.getAttribute('href') };
    })(),
  };
});
check('分类名保持不变', paths.folder === '技术', paths.folder);
check('空分类落到临时', paths.folderEmpty === '临时', paths.folderEmpty);
check('非法字符被清除', paths.folderBad === 'abcd', paths.folderBad);
check('空格转成连字符', paths.folderSpace === '机器学习', paths.folderSpace);
check('按日期与目录推断文章 URL', paths.url1 === 'https://fakumare.github.io/blog/2026/10/27/技术/2026-10-27-hello/', paths.url1);
check('无法推断时返回 null', paths.url2 === null, String(paths.url2));
check('顶栏博客链接', !paths.visit.hidden && paths.visit.href === 'https://fakumare.github.io/blog/', paths.visit.href);

// 16. 列表渲染子目录与跳转按钮
const listInfo = await page.evaluate(async () => {
  const b = window.__blog;
  const orig = window.fetch;
  window.fetch = async (url) => {
    const u = String(url);
    const json = (o, code = 200) => new Response(JSON.stringify(o), {
      status: code, headers: { 'Content-Type': 'application/json' },
    });
    if (u.endsWith('/repos/FAKUMARER/blog')) {
      return json({ full_name: 'FAKUMARER/blog', default_branch: 'main', private: false, size: 0 });
    }
    if (u.includes('/git/trees/')) {
      return json({
        tree: [
          { path: 'source/_posts/技术/2026-10-27-a.md', type: 'blob', sha: 's1' },
          { path: 'source/_posts/临时/2026-10-28-b.md', type: 'blob', sha: 's2' },
          { path: 'source/_posts/c.md', type: 'blob', sha: 's3' },
        ],
      });
    }
    if (u.includes('/contents/')) return json({ message: 'Not Found' }, 404);
    return json({});
  };
  try {
    await b.loadPosts();
  } finally {
    window.fetch = orig;
  }
  await new Promise((r) => setTimeout(r, 400));
  return {
    count: document.querySelectorAll('#postList .tree-file').length,
    folders: [...document.querySelectorAll('#postList .tree-dir > .tree-row .dir-name')].map((e) => e.textContent),
    open: document.querySelectorAll('#postList .post-open').length,
  };
});
check('递归列出子目录文章', listInfo.count === 3, String(listInfo.count));
check('树形目录显示分类', listInfo.folders.includes('技术') && listInfo.folders.includes('临时'), JSON.stringify(listInfo.folders));
check('能推断 URL 的文章有跳转按钮', listInfo.open === 2, String(listInfo.open));

// 17. 发布时按分类建目录
const pub = await page.evaluate(async () => {
  const b = window.__blog;
  b.state.current = { path: null, sha: null, permalink: null };
  document.querySelector('#fTitle').value = '分类测试';
  document.querySelector('#fCategories').value = '技术';
  document.querySelector('#fTags').value = '';
  document.querySelector('#fSlug').value = '';
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  document.querySelector('#fDate').value =
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}`;
  b.editor.value('正文内容');

  const calls = [];
  const orig = window.fetch;
  window.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    calls.push({ method, u, body: opts.body ? JSON.parse(opts.body) : null });
    const json = (o, code = 200) => new Response(JSON.stringify(o), {
      status: code, headers: { 'Content-Type': 'application/json' },
    });
    if (method === 'PUT') return json({ content: { sha: 'newsha' } });
    if (u.endsWith('/repos/FAKUMARER/blog')) {
      return json({ full_name: 'FAKUMARER/blog', default_branch: 'main', private: false, size: 0 });
    }
    if (u.includes('/git/trees/')) return json({ tree: [] });
    return json({ message: 'Not Found' }, 404);
  };
  try {
    await b.publish();
  } finally {
    window.fetch = orig;
  }
  const put = calls.find((c) => c.method === 'PUT');
  return { putUrl: put?.u || '', body: put?.body || null };
});
check('发布到分类子目录', /\/contents\/source\/_posts\/%E6%8A%80%E6%9C%AF\//.test(pub.putUrl), pub.putUrl);
check('front-matter 写入 permalink（带分类）', (() => {
  try {
    const content = new TextDecoder().decode(Uint8Array.from(atob(pub.body?.content || ''), (ch) => ch.charCodeAt(0)));
    return /permalink: "\d{4}\/\d{2}\/\d{2}\/技术\/分类测试\/"/.test(content);
  } catch { return false; }
})(), '');
check('front-matter 带 categories', (() => {
  try {
    const content = new TextDecoder().decode(Uint8Array.from(atob(pub.body?.content || ''), (ch) => ch.charCodeAt(0)));
    return content.includes('categories:') && content.includes('技术');
  } catch { return false; }
})(), '');

// 18. 按标签 / 分类搜索
const search = await page.evaluate(() => {
  const b = window.__blog;
  b.state.posts = [
    { name: '2026-10-27-hexo.md', path: 'source/_posts/技术/2026-10-27-hexo.md', sha: 's1', folder: '技术' },
    { name: '2026-10-28-life.md', path: 'source/_posts/随笔/2026-10-28-life.md', sha: 's2', folder: '随笔' },
  ];
  b.state.titleCache = {
    'source/_posts/技术/2026-10-27-hexo.md': { title: '部署 Hexo', tags: ['GitHub', 'Pages'], categories: ['技术'] },
    'source/_posts/随笔/2026-10-28-life.md': { title: '周末杂记', tags: ['生活'], categories: ['随笔'] },
  };
  const run = (q) => {
    document.querySelector('#search').value = q;
    b.renderList();
    return [...document.querySelectorAll('#postList .tree-file .file-title')].map((e) => e.textContent);
  };
  const out = {
    byTag: run('github'),
    byCategory: run('随笔'),
    byTitle: run('部署'),
    byFolder: run('技'),
    none: run('zzz'),
  };
  document.querySelector('#search').value = '';
  b.renderList();
  return out;
});
check('按标签搜索', search.byTag.length === 1 && search.byTag[0] === '部署 Hexo', JSON.stringify(search.byTag));
check('按分类搜索', search.byCategory.length === 1 && search.byCategory[0] === '周末杂记', JSON.stringify(search.byCategory));
check('按标题搜索', search.byTitle.length === 1 && search.byTitle[0] === '部署 Hexo', JSON.stringify(search.byTitle));
check('按目录名搜索', search.byFolder.length === 1, JSON.stringify(search.byFolder));
check('无匹配时为空', search.none.length === 0, JSON.stringify(search.none));

// 19. 旧缓存（无 permalink）应被自动刷新
const cacheFix = await page.evaluate(async () => {
  const b = window.__blog;
  const p = 'source/_posts/hello-world.md';
  b.state.posts = [{ name: 'hello-world.md', path: p, sha: 'sha-old', folder: '' }];
  // 模拟上一版本留下的缓存：有 title，没有 permalink
  b.state.titleCache = { [p]: { sha: 'sha-old', title: '你好，世界' } };

  const orig = window.fetch;
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/contents/')) {
      const text = '---\ntitle: 你好，世界\ndate: 2026-10-27 10:00:00\ntags:\n  - 开始\n---\n\n正文';
      const bytes = new TextEncoder().encode(text);
      let bin = '';
      bytes.forEach((c) => { bin += String.fromCharCode(c); });
      return new Response(JSON.stringify({ sha: 'sha-old', content: btoa(bin), encoding: 'base64' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await b.enrichTitles();
  } finally {
    window.fetch = orig;
  }
  b.renderList();
  return {
    permalink: b.state.titleCache[p]?.permalink || '',
    url: b.postUrl({ name: 'hello-world.md', path: p }),
    buttons: document.querySelectorAll('#postList .post-open').length,
    tags: b.state.titleCache[p]?.tags || [],
  };
});
check('旧缓存被重新读取', !!cacheFix.permalink, cacheFix.permalink);
check('补算出文章 URL', /\/2026\/10\/27\/hello-world\/$/.test(cacheFix.url || ''), cacheFix.url);
check('补算后出现跳转按钮', cacheFix.buttons === 1, String(cacheFix.buttons));
check('顺带缓存了标签', cacheFix.tags.includes('开始'), JSON.stringify(cacheFix.tags));

// 20. LaTeX 颜色写法触发 Nunjucks 冲突时自动加 disableNunjucks
const swig = await page.evaluate(() => {
  const b = window.__blog;
  const mk = (body) => b.buildFrontMatter({
    title: 't',
    date: new Date('2026-10-27T10:00:00'),
    categories: [],
    tags: [],
    draft: false,
    excerpt: '',
    permalink: '2026/10/27/t/',
    disableNunjucks: /\{#/.test(body),
  });
  return {
    withColor: mk('$\\color {#C0C0C0} \\text{rk}$'),
    plain: mk('普通正文，没有颜色'),
  };
});
check('含 {# 时写入 disableNunjucks', swig.withColor.includes('disableNunjucks: true'), '');
check('普通文章不写该字段', !swig.plain.includes('disableNunjucks'), '');

// 21. 一键安装博客园风格主题
page.on('dialog', async (d) => { try { await d.accept(); } catch { /* ignore */ } });
const theme = await page.evaluate(async () => {
  const b = window.__blog;
  Object.assign(b.state.settings, {
    owner: 'FAKUMARER', repo: 'blog', branch: 'main', token: 't',
    siteUrl: 'https://fakumarer.github.io/blog',
  });
  const calls = [];
  const orig = window.fetch;
  const cfgText = 'title: blog\ntheme: landscape\n';
  window.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    calls.push({ method, u, body: opts.body ? JSON.parse(opts.body) : null });
    const json = (o, c = 200) => new Response(JSON.stringify(o), { status: c, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/contents/_config.yml')) {
      let bin = '';
      new TextEncoder().encode(cfgText).forEach((ch) => { bin += String.fromCharCode(ch); });
      return json({ sha: 'cfgsha', content: btoa(bin), encoding: 'base64' });
    }
    // 分类/标签页当作不存在，验证会自动创建
    if (u.includes('/contents/source/categories/') || u.includes('/contents/source/tags/')) {
      return json({ message: 'Not Found' }, 404);
    }
    if (u.endsWith('/git/blobs')) return json({ sha: 'blobsha' });
    if (u.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'head1' } });
    if (u.includes('/git/commits/head1')) return json({ tree: { sha: 'tree1' } });
    if (u.endsWith('/git/trees')) return json({ sha: 'tree2' });
    if (u.endsWith('/git/commits')) return json({ sha: 'commit2' });
    if (u.includes('/git/refs/heads/')) return json({});
    return json({});
  };
  try {
    await b.installCnblogTheme();
  } finally {
    window.fetch = orig;
  }
  const treeCall = calls.find((c) => c.u.endsWith('/git/trees'));
  const tree = treeCall ? treeCall.body.tree : [];
  return {
    count: tree.length,
    paths: tree.map((t) => t.path),
    cfg: tree.find((t) => t.path === '_config.yml')?.content || '',
  };
});
check('提交主题文件与页面', theme.count === 20, String(theme.count));
check('包含主题模板', theme.paths.includes('themes/cnblog/layout/layout.ejs'), '');
check('包含主题样式', theme.paths.includes('themes/cnblog/source/css/style.css'), '');
check('站点主题切换为 cnblog', /^theme: cnblog$/m.test(theme.cfg), (theme.cfg || '').split('\n').find((l) => l.startsWith('theme')));

// 22. 外链资源迁移（图片 + 文件 + 失败报告）
const mig = await page.evaluate(async () => {
  const b = window.__blog;
  Object.assign(b.state.settings, {
    owner: 'o', repo: 'r', branch: 'main', token: 't',
    imagesPath: 'source/images', imagePrefix: '/images',
    siteUrl: 'https://x.github.io/blog',
  });
  const body = [
    '![](https://example.com/a.png)',
    '<img src="https://example.com/html.png" width="30">',
    '[论文](https://files.example.com/paper.pdf)',
    '[压缩包](https://files.example.com/data.zip)',
    '[源码](https://files.example.com/main.cpp)',
    '[演示](https://files.example.com/slides.pptx)',
    '![](https://example.com/bad.png)',
  ].join('\n\n');
  const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  const orig = window.fetch;
  window.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    // GitHub API 优先：上传走 PUT，查重名走 GET（这里模拟「文件还不存在」）
    if (u.includes('/contents/')) {
      if (method !== 'GET') {
        return new Response(JSON.stringify({ content: { sha: 'newsha' } }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (u.includes('example.com/a.png') || u.includes('example.com/html.png')) {
      const bin = atob(pngB64);
      return new Response(Uint8Array.from(bin, (c) => c.charCodeAt(0)), {
        status: 200, headers: { 'Content-Type': 'image/png' },
      });
    }
    if (u.includes('paper.pdf')) {
      return new Response('%PDF-1.4 test', { status: 200, headers: { 'Content-Type': 'application/pdf' } });
    }
    if (u.includes('data.zip') || u.includes('main.cpp') || u.includes('slides.pptx')) {
      return new Response('binary', { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
    }
    if (u.includes('example.com/bad.png')) return new Response('nope', { status: 404 });
    return new Response(JSON.stringify({ content: { sha: 'newsha' } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };

  let result;
  try {
    result = await b.migrateExternalImages(body);
  } finally {
    window.fetch = orig;
  }
  return { total: result.total, ok: result.ok, failed: result.failed, body: result.body };
});
check('识别图片 + 文件共 7 个外链', mig.total === 7, String(mig.total));
check('成功迁移 6 个', mig.ok === 6, String(mig.ok));
check('HTML <img> 也被识别', !mig.body.includes('example.com/html.png'), '');
check('文件进 /files 目录', mig.body.includes('/files/') && !mig.body.includes('files.example.com'), '');
check('失败项带类型和原因', mig.failed.length === 1 && mig.failed[0].kind === 'image' && /404/.test(mig.failed[0].reason), JSON.stringify(mig.failed));
check('失败图片保留原地址', mig.body.includes('example.com/bad.png'), '');

const realErrors = errors.filter((e) => !/404|Failed to load resource/.test(e));
if (errors.length) {
  console.log('\n[页面错误/资源]');
  errors.forEach((e) => console.log('  -', e));
}
check('无页面 JS 异常', realErrors.length === 0, realErrors.join(' | '));

const failed = results.filter((r) => !r.pass);
console.log(`\n结果: ${results.length - failed.length}/${results.length} 通过`);
await browser.close();
process.exit(failed.length ? 1 : 0);
