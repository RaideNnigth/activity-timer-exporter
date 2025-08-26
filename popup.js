const $ = sel => document.querySelector(sel);

$('#start').onclick = async () => {
  const title = $('#title').value.trim();
  const description = $('#desc').value.trim();
  const res = await chrome.runtime.sendMessage({ type: 'START', title, description });
  $('#status').textContent = res?.error || 'Timer started.';
};

$('#stop').onclick = async () => {
  const res = await chrome.runtime.sendMessage({ type: 'STOP' });
  $('#status').textContent = res?.error || `Stopped. Duration: ${res.durationMs ? Math.round(res.durationMs/1000)+'s' : ''}`;
};

async function saveMeta(){
  const title = $('#title').value.trim();
  const description = $('#desc').value.trim();
  await chrome.runtime.sendMessage({ type: 'SAVE_META', title, description });
}
$('#title').addEventListener('change', saveMeta);
$('#desc').addEventListener('change', saveMeta);

$('#files').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  const payload = await Promise.all(files.map(f => new Promise(res => {
    const reader = new FileReader();
    reader.onload = () => res({ name: f.name, type: f.type, dataUrl: reader.result });
    reader.readAsDataURL(f);
  })));
  const res = await chrome.runtime.sendMessage({ type: 'ADD_ATTACHMENTS', files: payload });
  $('#status').textContent = res?.error || `Attachments added: ${res.count}`;
});