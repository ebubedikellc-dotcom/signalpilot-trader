const $ = id => document.getElementById(id);
let selected = null, messages = [], polling = false, requestId = null;
let uncertain = false, sending = false, connected = false, epoch = 0;
const visibleOwner = () => !$('ws-owner').hidden;
const say = (id, text) => { $(id).textContent = text; };
async function api(action, body) {
  const r = await fetch('/api/workspace/whatsapp/' + action, {
    method: body ? 'POST' : 'GET', headers: body ? {'Content-Type': 'application/json'} : {},
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store'
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Connection failed.');
  return data;
}
function clearPrivateView() {
  epoch++; selected = null; messages = []; requestId = null; connected = false;
  $('wa-qr').removeAttribute('src'); $('wa-qr').hidden = true;
  $('wa-qr-placeholder').hidden = false;
  for (const id of ['wa-recipient', 'wa-incoming', 'wa-reply']) $(id).value = '';
  $('wa-draft').disabled = true; $('wa-send').disabled = true;
  renderMessages();
}
function choose(message) {
  if (sending) return;
  selected = message; requestId = null; uncertain = false;
  $('wa-recipient').value = message.name || message.sender;
  $('wa-incoming').value = message.text; $('wa-reply').value = '';
  $('wa-draft').disabled = false; $('wa-send').disabled = !connected;
  say('wa-reply-status', 'Review your reply before sending.'); renderMessages();
}
function renderMessages() {
  const list = $('wa-inbox'); list.replaceChildren();
  if (!messages.length) { say('wa-inbox', 'No new messages received in this session.'); return; }
  for (const m of messages) {
    const b = document.createElement('button'); b.type = 'button'; b.disabled = sending;
    b.setAttribute('aria-pressed', String(selected?.id === m.id));
    const name = document.createElement('strong'); name.textContent = m.name || m.sender;
    const text = document.createElement('span'); text.textContent = m.text;
    const when = document.createElement('small'); when.textContent = new Date(m.receivedAt).toLocaleString();
    b.append(name, text, when); b.addEventListener('click', () => choose(m)); list.append(b);
  }
}
async function refresh() {
  if (polling || document.hidden || location.pathname.replace(/\/$/, '') !== '/whatsapp' || !visibleOwner()) return;
  polling = true; const own = epoch;
  try {
    const s = await api('status'); if (own !== epoch || !visibleOwner()) return;
    connected = s.state === 'connected';
    say('wa-state', s.state.replaceAll('_', ' ')); say('wa-status', s.message);
    $('wa-stop').disabled = ['idle', 'disconnected', 'disabled'].includes(s.state);
    const valid = typeof s.qrDataUrl === 'string' && s.qrDataUrl.startsWith('data:image/png;base64,') && s.qrExpiresAt > Date.now();
    $('wa-qr').hidden = !valid; $('wa-qr-placeholder').hidden = valid;
    if (valid) $('wa-qr').src = s.qrDataUrl; else $('wa-qr').removeAttribute('src');
    if (connected) {
      const r = await api('messages'); if (own !== epoch || !visibleOwner()) return;
      messages = r.messages;
      if (selected && !messages.some(m => m.id === selected.id)) { selected = null; $('wa-draft').disabled = true; }
      renderMessages();
    }
    $('wa-send').disabled = !connected || !selected || uncertain || sending;
  } catch (e) {
    if (own !== epoch || !visibleOwner()) return;
    connected = false; $('wa-send').disabled = true;
    say('wa-state', 'Connection needed'); say('wa-status', e.message);
    $('wa-qr').hidden = true; $('wa-qr').removeAttribute('src'); $('wa-qr-placeholder').hidden = false;
  } finally { polling = false; }
}
$('wa-connect').addEventListener('click', async () => {
  const own = epoch; $('wa-connect').disabled = true; say('wa-status', 'Preparing your device connection…');
  try { await api('connect', {}); if (own === epoch) await refresh(); }
  catch (e) { if (own === epoch && visibleOwner()) say('wa-status', e.message); }
  finally { $('wa-connect').disabled = false; }
});
$('wa-stop').addEventListener('click', async () => {
  $('wa-stop').disabled = true;
  try { await api('disconnect', {}); clearPrivateView(); await refresh(); }
  catch (e) { if (visibleOwner()) say('wa-status', e.message); }
});
$('wa-draft').addEventListener('click', async () => {
  if (!selected) return;
  const id = selected.id, own = epoch, before = $('wa-reply').value;
  $('wa-draft').disabled = true; say('wa-reply-status', 'Preparing a draft…');
  try {
    const r = await api('draft', {message: selected.text, tone: $('wa-tone').value});
    if (own === epoch && visibleOwner() && selected?.id === id && $('wa-reply').value === before) {
      $('wa-reply').value = r.message; say('wa-reply-status', 'Draft ready. Edit it and press Send when you are happy with it.');
    }
  } catch (e) { if (own === epoch && visibleOwner()) say('wa-reply-status', e.message); }
  finally { $('wa-draft').disabled = !selected; }
});
$('wa-reply-form').addEventListener('submit', async e => {
  e.preventDefault(); if (!selected || uncertain || sending || !connected) return;
  const text = $('wa-reply').value.trim(); if (!text) return;
  const own = epoch; requestId ??= crypto.randomUUID(); sending = true;
  $('wa-send').disabled = true; $('wa-reply').readOnly = true; renderMessages();
  try {
    await api('send', {messageId: selected.id, text, requestId});
    if (own === epoch && visibleOwner()) {
      say('wa-reply-status', 'Reply submitted to WhatsApp. Delivery is shown in WhatsApp.');
      $('wa-reply').value = ''; requestId = null;
    }
  } catch (err) {
    if (own === epoch && visibleOwner()) { uncertain = true; say('wa-reply-status', err.message + ' Check WhatsApp before sending again.'); }
  } finally { sending = false; $('wa-reply').readOnly = false; $('wa-send').disabled = uncertain || !selected || !connected; renderMessages(); }
});
$('ws-logout').addEventListener('click', clearPrivateView);
window.addEventListener('workspace-owner-change', e => { if(e.detail.owner) refresh(); else clearPrivateView(); });
if (location.pathname.replace(/\/$/, '') === '/whatsapp') { refresh(); setInterval(refresh, 5000); document.addEventListener('visibilitychange', refresh); }
