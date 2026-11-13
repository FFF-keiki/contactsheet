/**
 * Local-only draft storage. IndexedDB stores original File/Blob bytes unchanged.
 * Site deployments do not replace these records while origin/browser profile are unchanged.
 */
(() => {
  'use strict';
  const DB_NAME = 'frame-maker-local-draft';
  const VERSION = 1;
  let dbPromise;
  const fromRequest = req => new Promise((resolve,reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('ローカル保存に失敗しました。'));
  });
  const finished = tx => new Promise((resolve,reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('保存処理が中断されました。'));
    tx.onerror = () => reject(tx.error || new Error('保存処理に失敗しました。'));
  });
  async function open() {
    if (!('indexedDB' in window)) throw new Error('このブラウザは自動保存に対応していません。');
    if (!dbPromise) {
      dbPromise = new Promise((resolve,reject) => {
        const req = indexedDB.open(DB_NAME, VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', {keyPath:'key'});
          if(!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', {keyPath:'key'});
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDBを開けませんでした。'));
        req.onblocked = () => reject(new Error('別タブがデータベースを使用中です。閉じて再試行してください。'));
      }).catch(err => { dbPromise = null; throw err; });
    }
    return dbPromise;
  }
  async function load() {
    const db = await open();
    const tx = db.transaction(['meta','photos'],'readonly');
    const done = finished(tx);
    const meta = fromRequest(tx.objectStore('meta').get('current'));
    const photos = fromRequest(tx.objectStore('photos').getAll());
    const [savedMeta,savedPhotos] = await Promise.all([meta,photos,done]).then(([m,p])=>[m,p]);
    return {meta:savedMeta||null,photos:savedPhotos||[]};
  }
  async function saveMeta(record) {
    const db = await open();
    const tx = db.transaction('meta','readwrite');
    const done = finished(tx);
    tx.objectStore('meta').put({key:'current',...record,updatedAt:Date.now()});
    await done;
  }
  async function savePhoto(boxId, kind, img) {
    const db = await open();
    const tx = db.transaction('photos','readwrite');
    const done = finished(tx);
    tx.objectStore('photos').put({key:`${boxId}:${kind}`,boxId,kind,blob:img.blob,name:img.name,width:img.width,height:img.height,bytes:img.bytes});
    await done;
  }
  async function deletePhoto(boxId, kind) {
    const db = await open();
    const tx = db.transaction('photos','readwrite');
    const done = finished(tx);
    tx.objectStore('photos').delete(`${boxId}:${kind}`);
    await done;
  }
  async function deleteBoxPhotos(boxId) {
    const db = await open();
    const tx = db.transaction('photos','readwrite');
    const done = finished(tx);
    for (const kind of ['ideal','reference','result']) tx.objectStore('photos').delete(`${boxId}:${kind}`);
    await done;
  }
  async function clear() {
    const db = await open();
    const tx = db.transaction(['meta','photos'],'readwrite');
    const done = finished(tx);
    tx.objectStore('meta').clear();
    tx.objectStore('photos').clear();
    await done;
  }
  async function requestPersistence() {
    if (!navigator.storage?.persist) throw new Error('このブラウザは保存領域の保護申請に対応していません。');
    const already = await navigator.storage.persisted();
    return already || await navigator.storage.persist();
  }
  window.ContactSheetDraftStore={load,saveMeta,savePhoto,deletePhoto,deleteBoxPhotos,clear,requestPersistence};
})();
