const $ = sel => document.querySelector(sel);

function fmt(ts){ if(!ts) return ''; const d=new Date(ts); return d.toISOString(); }

async function load() {
  const res = await chrome.runtime.sendMessage({ type: 'LIST_ACTIVITIES' });
  const list = $('#list'); list.innerHTML = '';
  const items = (res.activities||[]).sort((a,b)=> (b.startTs||0)-(a.startTs||0));
  if (!items.length) { list.textContent = 'No activities yet.'; return; }
  for (const a of items) {
    const div = document.createElement('div');
    const durH = a.durationMs ? Math.round((a.durationMs/3600000)*100)/100 : (a.startTs ? '(running)' : '(draft)');
    div.innerHTML = `
      <b>${escapeHTML(a.title || '(no title)')}</b><br>
      <small>${fmt(a.startTs)} → ${fmt(a.endTs)} ${durH!==''?`(${durH} h)`:''}</small>
      <div>${escapeHTML(a.description || '')}</div>
      <div><i>${(a.attachments?.length||0)} attachment(s)</i></div>
    `;
    list.appendChild(div);
  }
}

function escapeHTML(s){return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');}

$('#exportZip').onclick = async () => {
  const res = await chrome.runtime.sendMessage({ type: 'EXPORT_DATA' });
  const activities = res.activities || [];

  // Build CSV with duration in hours
  const rows = [['id','title','description','start','end','duration_hours','attachments']];
  for (const a of activities) {
    rows.push([
      a.id,
      a.title || '',
      (a.description||'').replace(/\r?\n/g,' '),
      a.startTs ? new Date(a.startTs).toISOString() : '',
      a.endTs ? new Date(a.endTs).toISOString() : '',
      a.durationMs ? (Math.round((a.durationMs/3600000) * 100) / 100) : '',
      (a.attachments||[]).map(x=>x.name).join('|')
    ]);
  }
  const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',')).join('\n');
  const csvBlob = new Blob([csv], { type: 'text/csv' });

  // Prepare files for ZIP: activities.csv + each attachment fetched from BG
  const files = [{
    path: 'activities.csv',
    data: new Uint8Array(await csvBlob.arrayBuffer())
  }];
  for (const a of activities) {
    const safeTitle = (a.title||'').slice(0,30).replace(/[^\w\- ]/g,'_');
    const base = `attachments/${a.id}_${safeTitle}`;
    for (const att of (a.attachments||[])) {
      const r = await chrome.runtime.sendMessage({
        type: 'READ_ATTACHMENT',
        activityId: a.id,
        attachmentId: att.id
      });
      if (!r || !r.ok) {
        console.warn('Could not read attachment', att?.name, r?.error);
        continue;
      }
      const arr = new Uint8Array(r.buffer);
      files.push({ path: `${base}/${att.name}`, data: arr });
    }
  }

  // Build ZIP (store-only)
  const zipBlob = await createZipBlob(files);
  const url = URL.createObjectURL(zipBlob);

  // Download and then CLEAR ALL after the download completes
  const downloadId = await chrome.downloads.download({ url, filename: 'activity_export.zip', saveAs: true });

  const onChanged = async delta => {
    if (delta.id !== downloadId) return;
    if (delta.state && delta.state.current === 'complete') {
      chrome.downloads.onChanged.removeListener(onChanged);
      URL.revokeObjectURL(url);
      await chrome.runtime.sendMessage({ type: 'CLEAR_ALL' });
      await load(); // refresh UI list (now empty)
    }
    if (delta.state && delta.state.current === 'interrupted') {
      chrome.downloads.onChanged.removeListener(onChanged);
      URL.revokeObjectURL(url);
      // do not clear if download failed
    }
  };
  chrome.downloads.onChanged.addListener(onChanged);
};

// ---------------------------
// Minimal ZIP (store-only) writer
// ---------------------------
async function createZipBlob(files){
  const fileEntries = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = utf8Encode(f.path);
    const data = f.data; // Uint8Array
    const crc = crc32(data);
    const entry = { nameBytes, data, crc, size: data.length, offset };
    const localHeader = 30 + nameBytes.length; // fixed header size + name len (no extra)
    offset += localHeader + data.length;
    fileEntries.push(entry);
  }
  let centralSize = 0;
  for (const e of fileEntries) centralSize += 46 + e.nameBytes.length;

  const endSize = 22;
  const totalSize = offset + centralSize + endSize;
  const out = new Uint8Array(totalSize);
  let p = 0;

  for (const e of fileEntries) {
    writeUint32(out, p, 0x04034b50); p += 4;
    writeUint16(out, p, 20); p += 2;
    writeUint16(out, p, 0x0800); p += 2;
    writeUint16(out, p, 0); p += 2;
    writeUint16(out, p, 0); p += 2;
    writeUint16(out, p, 0); p += 2;
    writeUint32(out, p, e.crc >>> 0); p += 4;
    writeUint32(out, p, e.size); p += 4;
    writeUint32(out, p, e.size); p += 4;
    writeUint16(out, p, e.nameBytes.length); p += 2;
    writeUint16(out, p, 0); p += 2;
    out.set(e.nameBytes, p); p += e.nameBytes.length;
    out.set(e.data, p); p += e.data.length;
  }

  const centralDirOffset = p;

  for (const e of fileEntries) {
    writeUint32(out, p, 0x02014b50); p += 4;
    writeUint16(out, p, 20); p += 2;
    writeUint16(out, p, 20); p += 2;
    writeUint16(out, p, 0x0800); p += 2;
    writeUint16(out, p, 0); p += 2;
    writeUint16(out, p, 0); p += 2;
    writeUint16(out, p, 0); p += 2;
    writeUint32(out, p, e.crc >>> 0); p += 4;
    writeUint32(out, p, e.size); p += 4;
    writeUint32(out, p, e.size); p += 4;
    writeUint16(out, p, e.nameBytes.length); p += 2;
    writeUint16(out, p, 0); p += 2;
    writeUint16(out, p, 0); p += 2;
    writeUint16(out, p, 0); p += 2;
    writeUint16(out, p, 0); p += 2;
    writeUint32(out, p, 0); p += 4;
    writeUint32(out, p, e.offset); p += 4;
    out.set(e.nameBytes, p); p += e.nameBytes.length;
  }

  const centralDirSize = p - centralDirOffset;

  writeUint32(out, p, 0x06054b50); p += 4;
  writeUint16(out, p, 0); p += 2;
  writeUint16(out, p, 0); p += 2;
  writeUint16(out, p, fileEntries.length); p += 2;
  writeUint16(out, p, fileEntries.length); p += 2;
  writeUint32(out, p, centralDirSize); p += 4;
  writeUint32(out, p, centralDirOffset); p += 4;
  writeUint16(out, p, 0); p += 2;

  return new Blob([out], { type: 'application/zip' });
}

function writeUint16(buf, pos, val){ buf[pos] = val & 0xff; buf[pos+1] = (val>>>8)&0xff; }
function writeUint32(buf, pos, val){ buf[pos] = val & 0xff; buf[pos+1] = (val>>>8)&0xff; buf[pos+2] = (val>>>16)&0xff; buf[pos+3] = (val>>>24)&0xff; }
function utf8Encode(str){ return new TextEncoder().encode(str); }

// CRC32
const CRC_TABLE = (()=>{ let c, t = new Uint32Array(256);
  for (let n=0;n<256;n++){ c=n; for (let k=0;k<8;k++) c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1); t[n]=c>>>0; }
  return t; })();
function crc32(u8){ let c=0^(-1); for (let i=0;i<u8.length;i++) c=(c>>>8)^CRC_TABLE[(c^u8[i])&0xFF]; return (c^(-1))>>>0; }

// Load on open
load();