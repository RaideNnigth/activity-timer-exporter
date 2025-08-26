const $ = sel => document.querySelector(sel);

function fmt(ts){ if(!ts) return ''; const d=new Date(ts); return d.toISOString(); }

async function load() {
  const res = await chrome.runtime.sendMessage({ type: 'LIST_ACTIVITIES' });
  const list = $('#list'); list.innerHTML = '';
  const items = (res.activities||[]).sort((a,b)=>b.startTs-a.startTs);
  if (!items.length) list.textContent = 'No activities yet.';
  for (const a of items) {
    const div = document.createElement('div');
    div.innerHTML = `
      <b>${escapeHTML(a.title || '(no title)')}</b><br>
      <small>${fmt(a.startTs)} → ${fmt(a.endTs)} ${a.durationMs?`(${Math.round(a.durationMs/1000)}s)`:''}</small>
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

  // Build CSV content
  const rows = [['id','title','description','start','end','duration_seconds','attachments']];
  for (const a of activities) {
    rows.push([
      a.id,
      a.title || '',
      (a.description||'').replace(/\r?\n/g,' '),
      a.startTs ? new Date(a.startTs).toISOString() : '',
      a.endTs ? new Date(a.endTs).toISOString() : '',
      a.durationMs ? Math.round(a.durationMs/1000) : '',
      (a.attachments||[]).map(x=>x.name).join('|')
    ]);
  }
  const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',')).join('\n');
  const csvBlob = new Blob([csv], { type: 'text/csv' });

  // Prepare files for ZIP: activities.csv + each attachment in folders
  const files = [{
    path: 'activities.csv',
    data: new Uint8Array(await csvBlob.arrayBuffer())
  }];
  for (const a of activities) {
    const base = `attachments/${a.id}_${(a.title||'').slice(0,30).replace(/[^\w\- ]/g,'_')}`;
    for (const att of (a.attachments||[])) {
      const arr = new Uint8Array(await att.data.arrayBuffer());
      files.push({ path: `${base}/${att.name}`, data: arr });
    }
  }

  const zipBlob = await createZipBlob(files);
  const url = URL.createObjectURL(zipBlob);
  await chrome.downloads.download({ url, filename: 'activity_export.zip', saveAs: true });
  setTimeout(()=>URL.revokeObjectURL(url), 60000);
};

// ---------------------------
// Minimal ZIP (store-only) writer
// Writes local file headers + central dir; UTF-8 filenames; no compression
// ---------------------------
async function createZipBlob(files){
  // Precompute CRC32 and sizes
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

  // Central directory
  let centralSize = 0;
  for (const e of fileEntries) {
    centralSize += 46 + e.nameBytes.length; // fixed size + name len (no extra/comment)
  }

  const endSize = 22; // EOCD fixed size, no comment
  const totalSize = offset + centralSize + endSize;
  const out = new Uint8Array(totalSize);
  let p = 0;

  // Write local file headers + data
  for (const e of fileEntries) {
    // Local header signature
    writeUint32(out, p, 0x04034b50); p += 4;
    writeUint16(out, p, 20); p += 2;              // version needed to extract
    writeUint16(out, p, 0x0800); p += 2;          // general purpose (UTF-8)
    writeUint16(out, p, 0); p += 2;               // method: 0 (store)
    writeUint16(out, p, 0); p += 2;               // file mod time (0)
    writeUint16(out, p, 0); p += 2;               // file mod date (0)
    writeUint32(out, p, e.crc >>> 0); p += 4;     // CRC32
    writeUint32(out, p, e.size); p += 4;          // compressed size
    writeUint32(out, p, e.size); p += 4;          // uncompressed size
    writeUint16(out, p, e.nameBytes.length); p += 2; // file name length
    writeUint16(out, p, 0); p += 2;               // extra length
    out.set(e.nameBytes, p); p += e.nameBytes.length;
    out.set(e.data, p); p += e.data.length;       // file data
  }

  const centralDirOffset = p;

  // Write central directory entries
  for (const e of fileEntries) {
    writeUint32(out, p, 0x02014b50); p += 4; // central header signature
    writeUint16(out, p, 20); p += 2;         // version made by
    writeUint16(out, p, 20); p += 2;         // version needed to extract
    writeUint16(out, p, 0x0800); p += 2;     // general purpose (UTF-8)
    writeUint16(out, p, 0); p += 2;          // method: 0
    writeUint16(out, p, 0); p += 2;          // time
    writeUint16(out, p, 0); p += 2;          // date
    writeUint32(out, p, e.crc >>> 0); p += 4;
    writeUint32(out, p, e.size); p += 4;     // comp size
    writeUint32(out, p, e.size); p += 4;     // uncomp size
    writeUint16(out, p, e.nameBytes.length); p += 2; // name len
    writeUint16(out, p, 0); p += 2;          // extra len
    writeUint16(out, p, 0); p += 2;          // comment len
    writeUint16(out, p, 0); p += 2;          // disk number start
    writeUint16(out, p, 0); p += 2;          // internal attrs
    writeUint32(out, p, 0); p += 4;          // external attrs
    writeUint32(out, p, e.offset); p += 4;   // local header offset
    out.set(e.nameBytes, p); p += e.nameBytes.length;
  }

  const centralDirSize = p - centralDirOffset;

  // EOCD
  writeUint32(out, p, 0x06054b50); p += 4;
  writeUint16(out, p, 0); p += 2;            // disk number
  writeUint16(out, p, 0); p += 2;            // start disk
  writeUint16(out, p, fileEntries.length); p += 2; // # entries on this disk
  writeUint16(out, p, fileEntries.length); p += 2; // total # entries
  writeUint32(out, p, centralDirSize); p += 4;     // central dir size
  writeUint32(out, p, centralDirOffset); p += 4;   // central dir offset
  writeUint16(out, p, 0); p += 2;            // comment length

  return new Blob([out], { type: 'application/zip' });
}

function writeUint16(buf, pos, val){ buf[pos] = val & 0xff; buf[pos+1] = (val>>>8)&0xff; }
function writeUint32(buf, pos, val){ buf[pos] = val & 0xff; buf[pos+1] = (val>>>8)&0xff; buf[pos+2] = (val>>>16)&0xff; buf[pos+3] = (val>>>24)&0xff; }

function utf8Encode(str){ return new TextEncoder().encode(str); }

// CRC32 (IEEE 802.3) for Uint8Array
const CRC_TABLE = (()=>{
  let c, table = new Uint32Array(256);
  for (let n=0; n<256; n++) {
    c = n;
    for (let k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(u8){
  let c = 0 ^ (-1);
  for (let i=0;i<u8.length;i++) c = (c>>>8) ^ CRC_TABLE[(c ^ u8[i]) & 0xFF];
  return (c ^ (-1)) >>> 0;
}

// Load the list on open
load();