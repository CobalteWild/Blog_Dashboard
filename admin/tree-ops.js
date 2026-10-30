/**
 * 文件树里的纯路径运算：移动、重命名、层级计算。
 * 不碰 DOM 也不碰存储，方便单独测试。
 */

export function basename(p = '') {
  const s = String(p).replace(/\/+$/, '');
  return s.split('/').pop() || '';
}

export function dirname(p = '') {
  const s = String(p).replace(/\/+$/, '');
  const parts = s.split('/');
  parts.pop();
  return parts.join('/');
}

export function joinPath(dir, name) {
  const d = String(dir || '').replace(/\/+$/, '');
  return d ? `${d}/${name}` : name;
}

/** 当前路径相对 postsPath 的分段（用于显示） */
export function relParts(path, postsPath) {
  const prefix = `${String(postsPath || '').replace(/\/+$/, '')}/`;
  const rel = String(path).startsWith(prefix) ? String(path).slice(prefix.length) : String(path);
  return rel.split('/');
}

/** 把文件移到另一个目录，文件名不变 */
export function moveInto(path, targetDir) {
  return joinPath(targetDir, basename(path));
}

/** 重命名文件（保持所在目录） */
export function renameFile(path, newName) {
  return joinPath(dirname(path), newName);
}

/** 重命名目录：把该目录下所有文件路径的前缀换掉 */
export function renameDirInPath(path, oldDir, newDir) {
  if (path === oldDir) return newDir;
  if (!path.startsWith(`${oldDir}/`)) return null;
  return newDir + path.slice(oldDir.length);
}

/**
 * 从一组文件路径里算出「目录集合」，含所有层级。
 * 用于给空目录（没有文件但有子目录，或者完全是新建的空分类）占位。
 */
export function collectDirs(paths, postsPath) {
  const prefix = `${String(postsPath || '').replace(/\/+$/, '')}/`;
  const dirs = new Set();
  for (const p of paths) {
    if (!String(p).startsWith(prefix)) continue;
    const parts = String(p).slice(prefix.length).split('/');
    parts.pop();                       // 去掉文件名
    for (let i = 1; i <= parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
  }
  return dirs;
}

/** 目录的父级（顶层返回空串） */
export function parentDir(dir) {
  const parts = String(dir || '').split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

/** 目录层级深度，顶层为 0 */
export function depthOf(dir) {
  return String(dir || '').split('/').filter(Boolean).length - 1;
}

/** 校验目录名：不许带路径分隔符和非法字符 */
export function isValidName(name) {
  const s = String(name || '').trim();
  if (!s || s === '.' || s === '..') return false;
  return !/[\\/:*?"<>|]/.test(s);
}
