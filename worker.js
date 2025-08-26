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
async function delAllActivities() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('activities', 'readwrite');
    tx.objectStore('activities').clear();
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
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
async function setRunning(r) {
  await chrome.storage.local.set({ running: r });
}
async function getDraftId() {
  const v = await chrome.storage.local.get(['draftId']);
  return v.draftId || null;
}
async function setDraftId(id) {
  await chrome.storage.local.set({ draftId: id || null });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'START') {
      const running = await getRunning();
      if (running) return sendResponse({ error: 'A timer is already running.' });

      // If a draft exists, convert it to running; else create new activity
      const draftId = await getDraftId();
      if (draftId) {
        const a = await getActivity(draftId);
        if (a) {
          a.title = msg.title ?? a.title ?? '';
          a.description = msg.description ?? a.description ?? '';
          a.startTs = Date.now();
          a.endTs = null;
          a.durationMs = null;
          await putActivity(a);
          await setRunning({ id: a.id, startTs: a.startTs });
          await setDraftId(null);
          return sendResponse({ ok: true, id: a.id });
        }
        await setDraftId(null);
      }

      const id = crypto.randomUUID();
      const activity = {
        id,
        title: (msg.title || ''),
        description: (msg.description || ''),
        startTs: Date.now(), endTs: null, durationMs: null,
        attachments: []
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
      // Update either running or draft
      const running = await getRunning();
      let a = null;
      if (running) a = await getActivity(running.id);
      else {
        let draftId = await getDraftId();
        if (!draftId) {
          draftId = crypto.randomUUID();
          await setDraftId(draftId);
          a = { id: draftId, title: '', description: '', startTs: null, endTs: null, durationMs: null, attachments: [] };
        } else {
          a = await getActivity(draftId);
          if (!a) a = { id: draftId, title: '', description: '', startTs: null, endTs: null, durationMs: null, attachments: [] };
        }
      }
      a.title = (msg.title ?? a.title ?? '');
      a.description = (msg.description ?? a.description ?? '');
      await putActivity(a);
      sendResponse({ ok: true, id: a.id });
    }

    else if (msg.type === 'ADD_ATTACHMENTS') {
      // Support adding even if not running: store to draft
      const running = await getRunning();
      let a = null;
      if (running) {
        a = await getActivity(running.id);
      } else {
        let draftId = await getDraftId();
        if (!draftId) {
          draftId = crypto.randomUUID();
          await setDraftId(draftId);
          a = { id: draftId, title: msg.title || '', description: msg.description || '', startTs: null, endTs: null, durationMs: null, attachments: [] };
        } else {
          a = await getActivity(draftId);
          if (!a) a = { id: draftId, title: msg.title || '', description: msg.description || '', startTs: null, endTs: null, durationMs: null, attachments: [] };
        }
      }
      for (const f of msg.files) {
        // Prefer ArrayBuffer payloads from popup
        if (f.buffer) {
          const blob = new Blob([new Uint8Array(f.buffer)], { type: f.type || 'application/octet-stream' });
          a.attachments.push({ id: crypto.randomUUID(), name: f.name, type: f.type, data: blob });
        } else if (f.dataUrl) {
          const blob = await (await fetch(f.dataUrl)).blob();
          a.attachments.push({ id: crypto.randomUUID(), name: f.name, type: f.type, data: blob });
        }
      }
      await putActivity(a);
      sendResponse({ ok: true, id: a.id, count: a.attachments.length });
    }

    else if (msg.type === 'LIST_ACTIVITIES') {
      const all = await listActivities();
      sendResponse({ ok: true, activities: all });
    }

    else if (msg.type === 'EXPORT_DATA') {
      const all = await listActivities();
      sendResponse({ ok: true, activities: all });
    }

    else if (msg.type === 'READ_ATTACHMENT') {
      try {
        const a = await getActivity(msg.activityId);
        const att = a?.attachments?.find(x => x.id === msg.attachmentId);
        if (!att) return sendResponse({ ok: false, error: 'Attachment not found' });
        const buf = await att.data.arrayBuffer();
        sendResponse({ ok: true, name: att.name, type: att.type, buffer: buf });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    }

    else if (msg.type === 'CLEAR_ALL') {
      await delAllActivities();
      await setRunning(null);
      await setDraftId(null);
      sendResponse({ ok: true });
    }

    else if (msg.type === 'GET_RUNNING') {
      const running = await getRunning();
      if (!running) {
        // Return draft as well so popup can reflect it
        const draftId = await getDraftId();
        const draft = draftId ? await getActivity(draftId) : null;
        return sendResponse({ ok: true, running: null, draft });
      }
      const a = await getActivity(running.id);
      sendResponse({ ok: true, running, activity: a || null });
    }

    else if (msg.type === 'GET_ACTIVITY') {
      const a = await getActivity(msg.id);
      sendResponse({ ok: !!a, activity: a || null });
    }

  })();
  return true;
});