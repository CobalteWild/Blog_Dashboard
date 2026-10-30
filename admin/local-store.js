/**
 * 本地文件存储（IndexedDB）
 *
 * 设计要点：
 * - 存的是「相对仓库根的文件路径 → 内容」，只覆盖 source/ 下的内容
 * - 每个文件记住上次同步时的 sha 和内容 hash（baseSha / baseHash）
 *   判断「本地是否有实质修改」靠 hash 对比，不看时间戳——顺手点保存不会被标成差异
 * - 删除用 tombstone（deleted: true）保留记录，避免下次拉取又冒出来
 */

const DB_NAME = 'blog-admin-local';
const DB_VERSION = 1;
const STORE = 'files';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'path' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const store = db.transaction(STORE, mode).objectStore(STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

/** 内容 hash：用于判断是否真的改了（djb2 + 长度，够用且快） */
export function hashContent(text) {
  const s = String(text || '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}-${s.length}`;
}

export async function listLocal() {
  const all = await run('readonly', (s) => s.getAll());
  return all || [];
}

export async function getLocal(path) {
  const rec = await run('readonly', (s) => s.get(path));
  return rec || null;
}

/**
 * 写本地文件。
 * opts.markSynced = true 时把当前内容的 hash 记为 baseHash（表示已和仓库一致）
 */
export async function putLocal(path, content, opts = {}) {
  const now = Date.now();
  const existing = await getLocal(path);
  const rec = {
    path,
    content,
    deleted: false,
    ctime: existing?.ctime || opts.ctime || now,
    mtime: now,
    // 标记同步时，即使调用方没给新 sha，也要保留一个「曾同步过」的痕迹，
    // 供 computeStatus 在 trees 延迟期间判定为 same
    baseSha: opts.markSynced
      ? (opts.baseSha !== undefined ? opts.baseSha : (existing?.baseSha ?? 'synced'))
      : (opts.baseSha !== undefined ? opts.baseSha : (existing?.baseSha ?? null)),
    baseHash: opts.baseHash !== undefined
      ? opts.baseHash
      : (opts.markSynced ? hashContent(content) : (existing?.baseHash ?? null)),
  };
  await run('readwrite', (s) => s.put(rec));
  return rec;
}

/** 标记删除（tombstone），只有原本存在于仓库的文件才需要 */
export async function markDeleted(path) {
  const existing = await getLocal(path);
  // 不留 tombstone 的话，`点开恢复` 就找不到记录了；内容为空时调用方会先补齐
  const rec = existing
    ? { ...existing, deleted: true, mtime: Date.now() }
    : { path, content: "", deleted: true, ctime: Date.now(), mtime: Date.now(), baseSha: null, baseHash: null };
  await run('readwrite', (s) => s.put(rec));
  return rec;
}

export async function removeLocal(path) {
  await run('readwrite', (s) => s.delete(path));
}

export async function clearLocal() {
  await run('readwrite', (s) => s.clear());
}

/** 批量写入（导入存档用） */
export async function bulkPutLocal(records) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    records.forEach((r) => store.put(r));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 计算本地文件相对仓库的状态。
 * remote: Map<path, sha>
 * 返回 Map<path, { status, ctime, content }>
 *   status: 'same' | 'modified' | 'added' | 'deleted'
 */
export function computeStatus(localFiles, remoteShaMap) {
  const out = new Map();

  for (const rec of localFiles) {
    const remoteSha = remoteShaMap.get(rec.path);

    if (rec.deleted) {
      if (remoteSha) out.set(rec.path, { status: 'deleted', rec });
      continue;
    }

    if (!remoteSha) {
      // 本地曾经同步过（有 baseSha，或内容仍等于 baseHash），只是仓库 trees 还没反映出来，
      // 不算「新增」——否则刚上传完刷新一下又冒出绿点。
      const wasSynced = !!rec.baseSha || (!!rec.baseHash && hashContent(rec.content) === rec.baseHash);
      out.set(rec.path, { status: wasSynced ? 'same' : 'added', rec });
      continue;
    }

    // 有 baseHash 就比内容；没有（旧数据）就比 sha
    const sameContent = rec.baseHash
      ? hashContent(rec.content) === rec.baseHash
      : rec.baseSha === remoteSha;

    out.set(rec.path, { status: sameContent ? 'same' : 'modified', rec });
  }

  return out;
}

/** 把状态汇总成「每个目录下有多少差异」，用于文件树角标 */
export function summarizeByFolder(statusMap) {
  const byPath = new Map();
  for (const [path, info] of statusMap) {
    if (info.status === 'same') continue;
    byPath.set(path, info.status);
  }
  return byPath;
}
