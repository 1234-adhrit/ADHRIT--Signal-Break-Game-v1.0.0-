const socket = io();
const $ = id => document.getElementById(id);
const landing = $('landing');
const roomView = $('room-view');
const modalBackdrop = $('modal-backdrop');
let mode = 'create';
let room = null;
let answer = ['', '', '', ''];
let selectedSlot = 0;
let chatLines = [];
let toastTimer;

for (let count = 2; count <= 10; count += 1) {
  const option = document.createElement('option');
  option.value = String(count);
  option.textContent = `${count} players`;
  if (count === 4) option.selected = true;
  $('max-players').append(option);
}

socket.on('connect', () => { $('connection-label').textContent = 'CONNECTED'; $('connection-label').style.color = '#71e3d7'; socket.emit('servers:list', renderServers); });
socket.on('disconnect', () => { $('connection-label').textContent = 'RECONNECTING'; $('connection-label').style.color = '#ffad81'; });
socket.on('room:update', data => { room = data; render(); });
socket.on('servers:update', renderServers);
socket.on('room:closed', data => {
  room = null; roomView.classList.add('hidden'); landing.classList.remove('hidden');
  showToast(data?.message || 'This server has closed.');
});

function openModal(nextMode) {
  mode = nextMode;
  $('modal-error').textContent = '';
  $('agent-name').value = sessionStorage.getItem('signalBreakName') || '';
  const joining = mode === 'private';
  const browsing = mode === 'browse';
  document.querySelector('.modal').classList.toggle('wide', browsing);
  $('modal-kicker').textContent = browsing ? 'SERVER BROWSER' : joining ? 'PRIVATE SERVER' : 'NEW SERVER';
  $('modal-title').innerHTML = browsing ? 'Find your<br>crew.' : joining ? 'Join privately<br>by code.' : 'Get on the<br>inside.';
  $('modal-copy').textContent = browsing ? 'Pick an open public lobby. No room code needed.' : joining ? 'Enter your callsign and the private room code your friend shared.' : 'Choose who can join and set the player limit for your server.';
  $('private-options').classList.toggle('hidden', !joining);
  $('create-options').classList.toggle('hidden', mode !== 'create');
  $('server-browser').classList.toggle('hidden', !browsing);
  document.querySelector('.modal-submit').classList.toggle('hidden', browsing);
  $('modal-submit-label').textContent = joining ? 'Join privately' : 'Create server';
  $('private-access-mode').value = 'player';
  if (browsing) socket.emit('servers:list', renderServers);
  modalBackdrop.classList.remove('hidden'); $('agent-name').focus();
}
function closeModal() { modalBackdrop.classList.add('hidden'); }
$('open-create').addEventListener('click', () => openModal('create'));
$('open-join').addEventListener('click', () => openModal('browse'));
$('open-private').addEventListener('click', () => openModal('private'));
$('private-access-mode').addEventListener('change', () => {
  const watching = $('private-access-mode').value === 'spectator';
  $('modal-copy').textContent = watching ? 'Enter the private server code to watch without taking a player slot.' : 'Enter your callsign and the private server code your friend shared.';
  $('modal-submit-label').textContent = watching ? 'Spectate server' : 'Join privately';
});
$('close-modal').addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', event => { if (event.target === modalBackdrop) closeModal(); });
$('room-code-input').addEventListener('input', event => event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5));

$('room-form').addEventListener('submit', event => {
  event.preventDefault();
  if (mode === 'browse') return;
  const name = $('agent-name').value.trim();
  if (!name) return;
  sessionStorage.setItem('signalBreakName', name);
  const callback = result => {
    if (!result?.ok) { $('modal-error').textContent = result?.error || 'Could not connect to that room.'; return; }
    enterRoom();
    if (mode === 'create') showToast($('server-visibility').value === 'public' ? 'Public server created. Players can find it in the browser.' : 'Private server created. Share the room code with your crew.');
  };
  if (mode === 'create') socket.emit('room:create', { name, visibility: $('server-visibility').value, maxPlayers: $('max-players').value }, result => { if (result.ok) { $('copy-code').dataset.code = result.code; } callback(result); });
  else if (mode === 'private' && $('private-access-mode').value === 'spectator') socket.emit('room:spectate', { name, code: $('room-code-input').value }, callback);
  else socket.emit('room:join', { name, code: $('room-code-input').value }, callback);
});

function enterRoom() {
  closeModal(); landing.classList.add('hidden'); roomView.classList.remove('hidden');
}

$('refresh-servers').addEventListener('click', () => socket.emit('servers:list', renderServers));
$('server-list').addEventListener('click', event => {
  const button = event.target.closest('[data-server-code]');
  if (!button) return;
  const name = $('agent-name').value.trim();
  if (!name) { $('modal-error').textContent = 'Enter a callsign before joining a server.'; $('agent-name').focus(); return; }
  sessionStorage.setItem('signalBreakName', name);
  button.disabled = true;
  const eventName = button.dataset.serverRole === 'spectator' ? 'room:spectate' : 'room:join';
  socket.emit(eventName, { name, code: button.dataset.serverCode }, result => {
    if (!result?.ok) { $('modal-error').textContent = result?.error || 'Could not join that server.'; button.disabled = false; return; }
    enterRoom();
  });
});

function renderServers(servers = []) {
  if (!$('server-list')) return;
  $('server-list').innerHTML = servers.length ? servers.map(server => {
    const state = server.phase === 'playing' ? 'IN PROGRESS' : 'LOBBY';
    const joinButton = server.phase === 'lobby' && server.players < server.maxPlayers ? `<button type="button" data-server-role="player" data-server-code="${escapeHTML(server.code)}">JOIN <span>↗</span></button>` : '';
    const watchLabel = server.phase === 'playing' ? 'WATCH LIVE' : 'SPECTATE';
    return `<article class="server-entry"><div class="server-entry-info"><strong>${escapeHTML(server.name)}</strong><span>HOSTED BY ${escapeHTML(server.host)} · ${state}</span><small>${server.players}/${server.maxPlayers} PLAYERS · ${server.challenges} CHALLENGES · ${server.spectators} WATCHING</small></div><div class="server-entry-actions">${joinButton}<button type="button" class="watch-button" data-server-role="spectator" data-server-code="${escapeHTML(server.code)}">${watchLabel} <span>↗</span></button></div></article>`;
  }).join('') : '<div class="server-empty"><span class="live-dot"></span><strong>No public servers right now.</strong><span>Create a public server and your friends can find it here.</span></div>';
}

$('copy-code').addEventListener('click', async () => {
  const text = $('copy-code').dataset.code || room?.code;
  if (!text) return;
  try { await navigator.clipboard.writeText(text); showToast('Room code copied.'); }
  catch { showToast(`Room code: ${text}`); }
});
$('leave-room').addEventListener('click', () => {
  socket.emit('room:leave'); room = null; chatLines = []; answer = ['', '', '', ''];
  roomView.classList.add('hidden'); landing.classList.remove('hidden');
});
$('start-game').addEventListener('click', () => socket.emit('game:start', result => { if (!result?.ok) showToast(result?.error || 'Could not start the run.'); }));
$('rematch-start').addEventListener('click', () => socket.emit('game:start', result => { if (!result?.ok) showToast(result?.error || 'Could not start the rematch.'); }));
$('ready-toggle').addEventListener('click', () => socket.emit('room:ready', result => { if (!result?.ok) showToast(result?.error || 'Could not update readiness.'); }));
$('rematch-toggle').addEventListener('click', () => socket.emit('room:ready', result => { if (!result?.ok) showToast(result?.error || 'Could not update readiness.'); }));
$('play-again').addEventListener('click', () => { $('leave-room').click(); openModal('create'); });

function render() {
  if (!room) return;
  $('copy-code').innerHTML = `${room.code} <b>▢</b>`;
  $('copy-code').dataset.code = room.code;
  const readyCount = room.players.filter(player => player.ready).length;
  const allReady = room.players.length >= 2 && readyCount === room.players.length;
  const self = room.players.find(player => player.id === room.selfId);
  $('crew-count').textContent = `${String(room.players.length).padStart(2, '0')} / ${String(room.maxPlayers).padStart(2, '0')} AGENTS`;
  $('side-count').textContent = `${String(room.players.length).padStart(2, '0')} / ${String(room.maxPlayers).padStart(2, '0')}`;
  $('spectator-count').textContent = `${room.spectatorCount} WATCHING`;
  $('challenge-preview').textContent = `${String(room.rounds.length).padStart(2, '0')} CHALLENGES`;
  $('crew-status').textContent = room.players.length < 2 ? 'Waiting for your crew…' : allReady ? 'Everyone is ready. The host can start.' : `${readyCount} of ${room.players.length} agents ready.`;
  $('ready-toggle').disabled = room.players.length < 2;
  $('ready-toggle').textContent = self?.ready ? '✓  You’re ready' : 'Ready up';
  $('ready-toggle').classList.toggle('is-ready', Boolean(self?.ready));
  $('start-game').disabled = !allReady || room.selfId !== room.hostId;
  $('start-game').querySelector('span:first-child').textContent = room.selfId !== room.hostId ? 'Waiting for host' : 'Start the run';
  $('lobby-panel').classList.toggle('hidden', room.isSpectator || room.phase !== 'lobby');
  $('game-panel').classList.toggle('hidden', room.isSpectator || room.phase !== 'playing');
  $('end-panel').classList.toggle('hidden', room.isSpectator || !['won', 'lost'].includes(room.phase));
  $('spectator-panel').classList.toggle('hidden', !room.isSpectator);
  $('chat-input').disabled = room.isSpectator;
  $('chat-input').placeholder = room.isSpectator ? 'Spectator chat is read-only' : 'Send a message…';
  $('chat-form').querySelector('button').disabled = room.isSpectator;
  if (room.isSpectator) renderSpectatorView();
  if (['won', 'lost'].includes(room.phase)) {
    $('rematch-toggle').textContent = self?.ready ? '✓  You’re in' : 'Ready for rematch';
    $('rematch-toggle').classList.toggle('is-ready', Boolean(self?.ready));
    $('rematch-toggle').disabled = room.players.length < 2;
    $('rematch-start').disabled = !allReady || room.selfId !== room.hostId;
    $('rematch-start').querySelector('span:first-child').textContent = room.selfId !== room.hostId ? 'Waiting for host' : 'Start rematch';
    $('rematch-status').textContent = room.players.length < 2 ? 'Waiting for another agent to rejoin.' : allReady ? 'Everyone is ready. The host can launch the rematch.' : `${readyCount} of ${room.players.length} agents ready for another run.`;
  }
  renderCrew(); renderModules(); renderActivity();
  if (room.phase === 'playing') renderPuzzle();
  if (room.phase === 'won' || room.phase === 'lost') {
    const won = room.phase === 'won';
    $('end-title').textContent = won ? 'Signal clear.' : 'Run compromised.';
    $('end-copy').textContent = room.lastResult || '';
    $('end-icon').textContent = won ? '↗' : '×';
    $('end-icon').style.color = won ? 'var(--teal)' : '#ff9389';
  }
}

function renderSpectatorView() {
  const phase = room.phase;
  const current = room.rounds[room.roundIndex];
  const playing = phase === 'playing';
  const finished = phase === 'won' || phase === 'lost';
  $('spectator-title').textContent = playing ? 'Watching the crew.' : finished ? (phase === 'won' ? 'Signal clear.' : 'Run compromised.') : 'Watching the lobby.';
  $('spectator-copy').textContent = 'You are in read-only observer mode. Your view does not use a player slot.';
  $('spectator-phase').textContent = phase === 'playing' ? 'LIVE' : phase === 'lobby' ? 'LOBBY' : phase.toUpperCase();
  $('spectator-stage').textContent = playing && current ? `${String(room.roundIndex + 1).padStart(2, '0')} / ${String(room.rounds.length).padStart(2, '0')} · ${current.title}` : finished ? 'Run finished' : 'Waiting for the crew';
  $('spectator-detail').textContent = playing && current ? current.desc : finished ? room.lastResult : 'The host is gathering the team. Watch here as the run begins.';
  $('spectator-progress').style.width = `${playing ? room.roundIndex / room.rounds.length * 100 : finished && phase === 'won' ? 100 : 0}%`;
  $('spectator-player-count').textContent = `${room.players.length} / ${room.maxPlayers}`;
  $('spectator-watcher-count').textContent = String(room.spectatorCount);
  $('spectator-timer-wrap').classList.toggle('hidden', !playing);
  if (playing) {
    const seconds = Math.max(0, Math.ceil((room.deadline - Date.now()) / 1000));
    $('spectator-timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
}

function avatar(player) { return `<span class="avatar" style="background:${player.color}">${escapeHTML(player.name.slice(0, 1).toUpperCase())}</span>`; }
function renderCrew() {
  $('crew-list').innerHTML = room.players.map(player => `<div class="crew-member">${avatar(player)}<span>${escapeHTML(player.name)}</span><span class="ready-pill ${player.ready ? 'ready' : ''}">${player.ready ? 'READY' : 'NOT READY'}</span>${player.host ? '<span class="host-pill">HOST</span>' : ''}</div>`).join('');
  $('side-players').innerHTML = room.players.map(player => `<div class="side-player">${avatar(player)}<span>${escapeHTML(player.name)}</span>${player.host ? '<span class="host-pill">HOST</span>' : ''}<i class="online-indicator"></i></div>`).join('');
}
function renderModules() {
  $('module-list-count').textContent = String(room.rounds.length).padStart(2, '0');
  $('module-list').innerHTML = room.rounds.map((item, index) => {
    const done = index < room.roundIndex || room.phase === 'won';
    const active = room.phase === 'playing' && index === room.roundIndex;
    return `<div class="module-item ${done ? 'done' : ''} ${active ? 'active' : ''}"><span class="module-index">${done ? '✓' : String(index + 1).padStart(2, '0')}</span><span>${escapeHTML(item.name)}</span></div>`;
  }).join('');
}
function renderActivity() {
  const last = room.activity.slice(-16);
  $('chat-log').innerHTML = '<div class="chat-system">This channel is encrypted. Share intel here.</div>' + last.map(item => {
    const separator = item.text.indexOf(': ');
    if (separator > -1) {
      const sender = escapeHTML(item.text.slice(0, separator));
      const you = item.playerId === room.selfId ? ' <span class="you-label">(you)</span>' : '';
      return `<div class="chat-message"><strong>${sender}${you}</strong> ${escapeHTML(item.text.slice(separator + 2))}</div>`;
    }
    return `<div class="chat-system">${escapeHTML(item.text)}</div>`;
  }).join('');
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
}
function renderPuzzle() {
  const index = room.roundIndex;
  const config = room.rounds[index];
  if (!config) return;
  $('module-number').textContent = `MODULE ${String(index + 1).padStart(2, '0')}`;
  $('module-total').textContent = String(room.rounds.length).padStart(2, '0');
  $('module-stamp').textContent = String(index + 1).padStart(2, '0');
  $('module-title').textContent = config.title;
  $('module-name').textContent = config.name;
  $('module-desc').textContent = config.desc;
  $('progress-fill').style.width = `${index / room.rounds.length * 100}%`;
  const roundKey = `${room.startedAt}:${index}`;
  if (renderPuzzle.lastRoundKey !== roundKey) {
    answer = config.type === 'wires' ? [] : config.type === 'odd' ? [''] : ['', '', '', ''];
    selectedSlot = 0; $('result-message').textContent = ''; $('result-message').classList.remove('error');
  }
  renderPuzzle.lastRoundKey = roundKey;
  const isChoice = config.type === 'wires' || config.type === 'odd';
  const clueNames = config.type === 'wires' ? ['CYAN', 'CORAL', 'LIME', 'VIOLET'] : ['A', 'B', 'C', 'D'];
  $('answer-hint').textContent = config.type === 'digits' ? '4 DIGITS · 1–8' : config.type === 'colors' ? '4 COLORS · ORDER MATTERS' : config.type === 'route' ? '4 MOVES · ORDER MATTERS' : config.type === 'wires' ? 'SELECT 2 SAFE WIRES' : 'SELECT THE ODD BADGE';
  $('answer-label').querySelector('span:first-child').textContent = config.type === 'wires' ? 'WIRE SELECTION' : config.type === 'odd' ? 'ODD BADGE' : config.type === 'route' ? 'TEAM ROUTE' : config.type === 'colors' ? 'SIGNAL REPLAY' : 'TEAM ANSWER';
  $('clue-list').innerHTML = room.clues.length ? room.clues.map(clue => {
    const label = config.type === 'wires' ? `WIRE ${clueNames[clue.position - 1]}` : config.type === 'odd' ? `BADGE ${clueNames[clue.position - 1]}` : config.type === 'route' ? `MOVE ${clue.position}` : `POSITION ${clue.position}`;
    return `<div class="clue-chip">${label}<strong>${escapeHTML(clue.value)}</strong></div>`;
  }).join('') : '<div class="clue-empty">You have no direct readings this round. Ask your crew what they found and help piece it together.</div>';
  $('strikes').querySelectorAll('span').forEach((item, i) => item.classList.toggle('hit', i < room.strikes));
  $('answer-slots').classList.toggle('hidden', isChoice);
  if (!isChoice) {
    $('answer-slots').innerHTML = answer.map((value, i) => `<button class="answer-slot ${config.type === 'colors' ? 'color-slot' : ''} ${value ? 'filled' : ''} ${selectedSlot === i ? 'selected' : ''}" data-slot="${i}" aria-label="Position ${i + 1}">${config.type === 'route' ? ({ NORTH: '↑', EAST: '→', SOUTH: '↓', WEST: '←' }[value] || '—') : value || '—'}</button>`).join('');
    $('answer-slots').querySelectorAll('[data-slot]').forEach(button => button.addEventListener('click', () => { selectedSlot = Number(button.dataset.slot); renderPuzzle(); }));
  }
  if (config.type === 'wires') {
    const wireColors = { CYAN: '#63e8dc', CORAL: '#ff7d77', LIME: '#cbf26a', VIOLET: '#b995ff' };
    $('input-pad').innerHTML = config.options.map(value => `<button class="wire-choice ${answer.includes(value) ? 'chosen' : ''}" data-value="${value}" aria-pressed="${answer.includes(value)}"><i class="wire-line" style="--wire-color:${wireColors[value]}"></i><span>${value}</span><small>${answer.includes(value) ? 'SELECTED' : 'TAP TO SELECT'}</small></button>`).join('');
    $('input-pad').querySelectorAll('.wire-choice').forEach(button => button.addEventListener('click', () => {
      const value = button.dataset.value;
      answer = answer.includes(value) ? answer.filter(item => item !== value) : answer.length < 2 ? [...answer, value] : answer;
      $('result-message').textContent = ''; $('result-message').classList.remove('error'); renderPuzzle();
    }));
  } else if (config.type === 'odd') {
    $('input-pad').innerHTML = config.options.map(value => `<button class="badge-choice ${answer[0] === value ? 'chosen' : ''}" data-value="${value}" aria-pressed="${answer[0] === value}"><span class="badge-mark">${value}</span><small>BADGE ${value}</small></button>`).join('');
    $('input-pad').querySelectorAll('.badge-choice').forEach(button => button.addEventListener('click', () => { answer = [button.dataset.value]; $('result-message').textContent = ''; $('result-message').classList.remove('error'); renderPuzzle(); }));
  } else {
    let choices;
    if (config.type === 'colors') choices = ['CYAN', 'CORAL', 'LIME', 'VIOLET'];
    else if (config.type === 'route') choices = ['NORTH', 'EAST', 'SOUTH', 'WEST'];
    else choices = ['1', '2', '3', '4', '5', '6', '7', '8', '⌫'];
    const colorRound = config.type === 'colors';
    const glyph = { NORTH: '↑', EAST: '→', SOUTH: '↓', WEST: '←' };
    $('input-pad').innerHTML = choices.map(value => `<button class="pad-key ${colorRound ? 'color-key' : config.type === 'route' ? 'route-key' : ''}" data-value="${value}" aria-label="${value === '⌫' ? 'Delete' : value}" title="${value}">${colorRound ? '' : glyph[value] || value}</button>`).join('');
    $('input-pad').querySelectorAll('.pad-key').forEach(button => {
      const value = button.dataset.value;
      button.classList.toggle('chosen', value !== '⌫' && answer.includes(value));
      button.addEventListener('click', () => {
        if (value === '⌫') answer[selectedSlot] = '';
        else answer[selectedSlot] = value;
        selectedSlot = (selectedSlot + 1) % 4;
        $('result-message').textContent = ''; $('result-message').classList.remove('error'); renderPuzzle();
      });
    });
  }
  $('submit-answer').disabled = room.phase !== 'playing';
}

$('submit-answer').addEventListener('click', () => {
  const type = room?.rounds[room.roundIndex]?.type;
  const complete = type === 'wires' ? answer.length === 2 : type === 'odd' ? answer.length === 1 && Boolean(answer[0]) : answer.length === 4 && answer.every(Boolean);
  if (!complete) {
    $('result-message').textContent = type === 'wires' ? 'Select exactly two wires.' : type === 'odd' ? 'Select the badge your crew identified.' : 'Fill in all four positions.'; $('result-message').classList.add('error'); return;
  }
  socket.emit('puzzle:submit', { answer }, result => {
    if (result?.error) { $('result-message').textContent = result.error; $('result-message').classList.add('error'); }
    else if (!result?.correct) { $('result-message').textContent = 'Incorrect. Check the clues and try again.'; $('result-message').classList.add('error'); }
  });
});

$('chat-form').addEventListener('submit', event => {
  event.preventDefault(); const input = $('chat-input'); const message = input.value.trim();
  if (!message) return;
  socket.emit('chat:send', { message }); input.value = '';
});

let timerInterval;
function tickTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!room || room.phase !== 'playing') return;
    const ms = Math.max(0, room.deadline - Date.now());
    const seconds = Math.ceil(ms / 1000);
    $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    if (room.isSpectator) $('spectator-timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    $('timer-card')?.classList.toggle('urgent', seconds <= 60);
    document.querySelector('.timer-card').classList.toggle('urgent', seconds <= 60);
  }, 250);
}
setInterval(() => { if (room?.phase === 'playing') tickTimer(); }, 1000);
function showToast(message) { const toast = $('toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2400); }
function escapeHTML(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
