import { moveInto, renameFile, renameDirInPath, isValidName } from './tree-ops.js';
import * as localStore from './local-store.js';

const LS_LOCAL_DIRS = 'blog-admin:localDirs:v1';

export function loadLocalDirs() {
  try {
    const raw = localStorage.getItem(LS_LOCAL_DIRS);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

export function saveLocalDirs(set) {
  try {
    localStorage.setItem(LS_LOCAL_DIRS, JSON.stringify([...set]));
  } catch { /* 忽略 */ }
}

/* ------------------------------------------------------------
 *  右键菜单
 * ------------------------------------------------------------ */

let menuEl = null;
let menuOpen = false;

function ensureMenu() {
  if (!menuEl) menuEl = document.getElementById('ctxMenu');
  return menuEl;
}

export function hideCtxMenu() {
  const el = ensureMenu();
  if (el) el.hidden = true;
  menuOpen = false;
}

/**
 * items: [{ label, run, danger } | { sep: true } | { title }]
 */
export function showCtxMenu(x, y, items) {
  const el = ensureMenu();
  if (!el) return;
  el.innerHTML = '';

  for (const it of items) {
    if (!it) continue;
    if (it.sep) {
      const d = document.createElement('div');
      d.className = 'ctx-sep';
      el.appendChild(d);
      continue;
    }
    if (it.title) {
      const t = document.createElement('div');
      t.className = 'ctx-title';
      t.textContent = it.title;
      el.appendChild(t);
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = it.label;
    if (it.danger) b.classList.add('danger');
    b.addEventListener('click', () => {
      hideCtxMenu();
      try { it.run(); } catch (e) { console.error(e); }
    });
    el.appendChild(b);
  }

  el.hidden = false;
  el.style.left = '0px';
  el.style.top = '0px';
  const r = el.getBoundingClientRect();
  const left = Math.max(6, Math.min(x, window.innerWidth - r.width - 8));
  const top = Math.max(6, Math.min(y, window.innerHeight - r.height - 8));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  menuOpen = true;
}

export function isMenuOpen() {
  return menuOpen;
}

/* ------------------------------------------------------------
 *  文件操作（全部只动本地 IndexedDB，上传由「↑ 仓库」统一做）
 * ------------------------------------------------------------ */

/** 读一个路径的当前内容：本地优先，没有就让调用方给 */
async function readContent(path, fallback) {
  const rec = await localStore.getLocal(path);
  if (rec && !rec.deleted) return rec.content;
  return fallback;
}

/**
 * 移动/重命名单个文件。
 * 返回值：新路径；失败抛错。
 */
export async function relocateFile(oldPath, newPath, newContent, opts = {}) {
  if (oldPath === newPath) return newPath;

  let content = newContent;
  if (content == null) {
    const rec = await localStore.getLocal(oldPath);
    content = rec && !rec.deleted ? rec.content : null;
  }
  if (content == null) throw new Error('读不到文件内容');

  const existing = await localStore.getLocal(oldPath);

  // 目标已被另一篇占用时换个名字，别互相覆盖
  let finalPath = newPath;
  const occupied = await localStore.getLocal(finalPath);
  if (occupied && !occupied.deleted) {
    finalPath = await uniquePath(finalPath);
  }

  // 目标路径原本是一条删除占位（拖回去了）：把它的同步基准带回来，
  // 这样内容没变时状态就是「无修改」，而不是被当成新文件。
  const targetRec = await localStore.getLocal(finalPath);
  const putOpts = { ctime: (existing && existing.ctime) || (targetRec && targetRec.ctime) };
  if (targetRec && targetRec.baseHash) {
    putOpts.baseHash = targetRec.baseHash;
    putOpts.baseSha = targetRec.baseSha;
  }
  await localStore.putLocal(finalPath, content, putOpts);

  // 语义：源路径在仓库里 → 留 tombstone（列表显示已删除 / 红点 / 删除线）
  //       源路径只在本地 → 直接移除，不留痕迹
  const sourceInRepo = opts.sourceInRepo != null
    ? opts.sourceInRepo
    : !!(existing && existing.baseSha);
  if (sourceInRepo) {
    await localStore.markDeleted(oldPath);
  } else {
    await localStore.removeLocal(oldPath);
  }
  return finalPath;
}

async function uniquePath(path) {
  const m = /^(.*?)(\.[^.\/]+)$/.exec(path);
  const base = m ? m[1] : path;
  const ext = m ? m[2] : '';
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}${ext}`;
    const rec = await localStore.getLocal(candidate);
    if (!rec || rec.deleted) return candidate;
  }
  return `${base}-${Date.now()}${ext}`;
}

/** 重命名整个目录：content 由调用方按路径提供 */
export async function relocateDir(oldDir, newDir, pathList, contentOf) {
  const moved = [];
  for (const oldPath of pathList) {
    const newPath = renameDirInPath(oldPath, oldDir, newDir);
    if (!newPath || newPath === oldPath) continue;
    await relocateFile(oldPath, newPath, contentOf(oldPath));
    moved.push({ from: oldPath, to: newPath });
  }
  return moved;
}

/* ------------------------------------------------------------
 *  校验 + 提示
 * ------------------------------------------------------------ */

export function askName(label, initial = '', hint = '') {
  const input = window.prompt(`${label}${hint ? `\n${hint}` : ''}`, initial);
  if (input == null) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!isValidName(trimmed)) {
    window.alert('名字里不能包含 \\ / : * ? " < > | 这些字符');
    return null;
  }
  return trimmed;
}

export { moveInto, renameFile, renameDirInPath, isValidName };
