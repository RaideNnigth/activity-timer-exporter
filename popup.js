const $ = sel => document.querySelector(sel);
let tickTimer = null;
let runningState = null; // {id, startTs}
let draftActivity = null; // when no timer

function setButtons(running){
  $('#start').disabled = !!running;
  $('#stop').disabled = !running;
  $('#runningBox').style.display = running ? 'block' : 'none';
}

function fmt(ts){ if(!ts) return ''; const d=new Date(ts); return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'}); }

function startElapsedTicker(startTs){
  clearInterval(tickTimer);
  const el = $('#rElapsed');
  const update = () => {
    const secs = Math.max(0, Math.floor((Date.now() - startTs)/1000));
    const h = Math.floor(secs/3600);
    const m = Math.floor((secs%3600)/60);
    const s = secs%60;
    el.textContent = `${h}h ${m}m ${s}s`;
  };
  update();
  tickTimer = setInterval(update, 1000);
}

async function hydrateRunningUI(){
  const res = await chrome.runtime.sendMessage({ type: 'GET_RUNNING' });
  runningState = res.running || null;
  draftActivity = res.draft || null;
  setButtons(!!runningState);
  if (runningState && res.activity) {
    const a = res.activity;
    $('#rTitle').textContent = a.title || '(no title)';
    $('#rTimes').textContent = `Started: ${fmt(a.startTs)}`;
    $('#title').value = a.title || '';
    $('#desc').value = a.description || '';
    startElapsedTicker(a.startTs);
  } else {
    clearInterval(tickTimer);
    $('#rElapsed').textContent = '0s';
    // Pre-fill fields from draft if any
    if (draftActivity) {
      $('#title').value = draftActivity.title || '';
      $('#desc').value = draftActivity.description || '';
    }
  }
}

$('#start').onclick = async () => {
  const title = $('#title').value.trim();
  const description = $('#desc').value.trim();
  const res = await chrome.runtime.sendMessage({ type: 'START', title, description });
  if (res?.error) { $('#status').textContent = res.error; return; }
  $('#status').textContent = 'Timer started.';
  await hydrateRunningUI();
};

$('#stop').onclick = async () => {
  const res = await chrome.runtime.sendMessage({ type: 'STOP' });
  if (res?.error) { $('#status').textContent = res.error; return; }
  clearInterval(tickTimer);
  const hrs = res.durationMs ? Math.round((res.durationMs/3600000)*100)/100 : '';
  $('#status').textContent = `Stopped. Duration: ${hrs} h`;
  await hydrateRunningUI();
};

async function saveMeta(){
  const title = $('#title').value.trim();
  const description = $('#desc').value.trim();
  await chrome.runtime.sendMessage({ type: 'SAVE_META', title, description });
  if (runningState) $('#rTitle').textContent = title || '(no title)';
}
$('#title').addEventListener('input', saveMeta);
$('#desc').addEventListener('input', saveMeta);

// Allow attachments even if not running: send ArrayBuffers + current meta
$('#files').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  const payload = await Promise.all(files.map(async f => ({
    name: f.name,
    type: f.type,
    buffer: await f.arrayBuffer()
  })));
  const title = $('#title').value.trim();
  const description = $('#desc').value.trim();
  const res = await chrome.runtime.sendMessage({ type: 'ADD_ATTACHMENTS', title, description, files: payload });
  $('#status').textContent = res?.error || `Attachments added: ${res.count}`;
  e.target.value = '';
});

// Initialize UI
document.addEventListener('DOMContentLoaded', hydrateRunningUI);