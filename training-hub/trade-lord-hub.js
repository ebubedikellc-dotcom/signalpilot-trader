// Original Trade Lord conversation design, connected to the standalone video hub.
const $ = id => document.getElementById(id);
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let busy = false, recognition = null;

function notify(message, error = false) {
  $('notice').hidden = !message;
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
}

function face(mode) {
  const descriptions = {idle: 'ready', thinking: 'thinking', listening: 'listening', speaking: 'speaking'};
  $('lord-face').dataset.state = mode;
  $('lord-face').setAttribute('aria-label', 'Trade Lord is ' + descriptions[mode]);
  $('presence-status').textContent = {
    idle: 'Ask me about the lessons in your videos.',
    thinking: 'I’m reading the saved lessons for your question…',
    listening: 'I’m listening. Speak naturally.',
    speaking: 'Reading my answer aloud.'
  }[mode];
}

function addMessage(role, text) {
  const row = document.createElement('article');
  row.className = 'message ' + role;
  if (role === 'assistant') {
    const label = document.createElement('small');
    label.textContent = 'TRADE LORD';
    row.append(label);
  }
  const words = document.createElement('div');
  words.textContent = text;
  row.append(words);
  const box = $('chat-messages');
  box.append(row);
  box.scrollTop = box.scrollHeight;
  $('suggestions').hidden = true;
}

function stopVoice() {
  const current = recognition;
  recognition = null;
  current?.abort();
  window.speechSynthesis?.cancel();
  $('talk').querySelector('span').textContent = 'Talk to me';
  if (!busy) face('idle');
}

function speak(text) {
  if (!$('speak').checked || !window.speechSynthesis) return;
  const voice = new SpeechSynthesisUtterance(text);
  voice.lang = 'en-GB';
  voice.rate = 0.95;
  voice.onstart = () => { if (!busy) face('speaking'); };
  voice.onend = voice.onerror = () => { if (!busy) face('idle'); };
  window.speechSynthesis.speak(voice);
}

async function send(raw) {
  const question = raw.trim().slice(0, 2000);
  if (busy || !question) return;
  stopVoice();
  busy = true;
  face('thinking');
  notify('');
  $('talk').disabled = true;
  $('chat-form').querySelector('button').disabled = true;
  $('chat-input').disabled = true;
  $('clear-chat').disabled = true;
  document.querySelectorAll('[data-ask]').forEach(b => b.disabled = true);
  addMessage('user', question);
  let answer = '';
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Trade-Lord': '1'},
      body: JSON.stringify({question})
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'The lesson service is unavailable. Please retry.');
    answer = result.answer;
    addMessage('assistant', answer);
    $('chat-input').value = '';
  } catch (error) {
    notify(error.message || 'Could not connect. Please retry.', true);
  } finally {
    busy = false;
    face('idle');
    $('talk').disabled = !Recognition;
    $('chat-form').querySelector('button').disabled = false;
    $('chat-input').disabled = false;
    $('clear-chat').disabled = false;
    document.querySelectorAll('[data-ask]').forEach(b => b.disabled = false);
  }
  if (answer) speak(answer);
}

$('chat-form').onsubmit = event => { event.preventDefault(); send($('chat-input').value); };
document.querySelectorAll('[data-ask]').forEach(button => button.onclick = () => send(button.dataset.ask));
$('clear-chat').onclick = () => {
  if (busy) return;
  stopVoice();
  $('chat-messages').replaceChildren();
  $('suggestions').hidden = false;
  notify('Conversation cleared from this tab. Your saved video lessons remain.');
};
$('stop-voice').onclick = stopVoice;
$('speak').onchange = () => { if (!$('speak').checked) stopVoice(); };
if (!window.speechSynthesis) {
  $('speak').disabled = true;
  $('speak').parentElement.title = 'Spoken replies are unavailable in this browser.';
}
if (!Recognition) {
  $('talk').disabled = true;
  $('voice-hint').textContent = 'Voice input is unavailable in this browser. Type your message below.';
} else {
  $('voice-hint').textContent = 'Your browser provides voice input. Tap to speak, or type below.';
  $('talk').onclick = () => {
    if (busy) return;
    if (recognition) { recognition.stop(); return; }
    stopVoice();
    const current = new Recognition();
    recognition = current;
    let finalWords = '';
    current.lang = 'en-NG';
    current.interimResults = true;
    current.continuous = false;
    current.onstart = () => { face('listening'); $('talk').querySelector('span').textContent = 'Finish speaking'; };
    current.onresult = event => {
      let words = '';
      finalWords = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        words += result[0].transcript + ' ';
        if (result.isFinal) finalWords += result[0].transcript + ' ';
      }
      $('chat-input').value = words.trim().slice(0, 2000);
    };
    current.onerror = event => {
      finalWords = '';
      if (event.error !== 'aborted') notify(event.error === 'not-allowed'
        ? 'Allow microphone access in your browser, or type below.'
        : 'I could not hear that clearly. Please try again or type below.', true);
    };
    current.onend = () => {
      if (recognition !== current) return;
      recognition = null;
      $('talk').querySelector('span').textContent = 'Talk to me';
      if (!busy) face('idle');
      if (!busy && !document.hidden && finalWords.trim()) send(finalWords);
    };
    try { current.start(); }
    catch { recognition = null; face('idle'); notify('Microphone could not start. You can type below.', true); }
  };
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopVoice(); });
face('idle');
