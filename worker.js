// Minimal IndexedDB helpers
let dbPromise;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('activity-db', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('activities')) {
        const store = db.createObjectStore('activities', { keyPath: 'id' });
        store.createIndex('byStart', 'startTs');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function putActivity(a) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('activities', 'readwrite');
    tx.objectStore('activities').put(a);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function getActivity(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('activities', 'readonly');
    const req = tx.objectStore('activities').get(id);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function listActivities() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('activities', 'readonly');
    const os = tx.objectStore('activities');
    const arr = [];
    os.openCursor().onsuccess = e => {
      const cur = e.target.result;
      if (cur) { arr.push(cur.value); cur.continue(); } else { res(arr); }
    };
    tx.onerror = () => rej(tx.error);
  });
}

async function getRunning() {
  const v = await chrome.storage.local.get(['running']);
  return v.running || null;
}
async function setRunning(r) { await chrome.storage.local.set({ running: r }); }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'START') {
      const running = await getRunning();
      if (running) return sendResponse({ error: 'A timer is already running.' });
      const id = crypto.randomUUID();
      const activity = {
        id,
        title: (msg.title || ''),
        description: (msg.description || ''),
        startTs: Date.now(), endTs: null, durationMs: null,
        attachments: [] // {id, name, type, data: Blob}
      };
      await putActivity(activity);
      await setRunning({ id: activity.id, startTs: activity.startTs });
      sendResponse({ ok: true, id });
    }

    else if (msg.type === 'STOP') {
      const running = await getRunning();
      if (!running) return sendResponse({ error: 'No timer running.' });
      const a = await getActivity(running.id);
      if (!a) return sendResponse({ error: 'Activity not found.' });
      a.endTs = Date.now();
      a.durationMs = a.endTs - a.startTs;
      await putActivity(a);
      await setRunning(null);
      sendResponse({ ok: true, id: a.id, durationMs: a.durationMs });
    }

    else if (msg.type === 'SAVE_META') {
      const running = await getRunning();
      if (!running) return sendResponse({ error: 'No timer running.' });
      const a = await getActivity(running.id);
      if (!a) return sendResponse({ error: 'Activity not found.' });
      a.title = (msg.title ?? a.title);
      a.description = (msg.description ?? a.description);
      await putActivity(a);
      sendResponse({ ok: true });
    }

    else if (msg.type === 'ADD_ATTACHMENTS') {
      const running = await getRunning();
      if (!running) return sendResponse({ error: 'No timer running.' });
      const a = await getActivity(running.id);
      if (!a) return sendResponse({ error: 'Activity not found.' });
      for (const f of msg.files) {
        // f: { name, type, dataUrl }
        const blob = await (await fetch(f.dataUrl)).blob();
        a.attachments.push({ id: crypto.randomUUID(), name: f.name, type: f.type, data: blob });
      }
      await putActivity(a);
      sendResponse({ ok: true, count: a.attachments.length });
    }

    else if (msg.type === 'LIST_ACTIVITIES') {
      const all = await listActivities();
      sendResponse({ ok: true, activities: all });
    }

    else if (msg.type === 'EXPORT_DATA') {
      const all = await listActivities();
      sendResponse({ ok: true, activities: all });
    }
  })();
  return true; // keep port open for async
});