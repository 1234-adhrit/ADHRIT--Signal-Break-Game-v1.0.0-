const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const rooms = new Map();
const COLORS = ['CYAN', 'CORAL', 'LIME', 'VIOLET'];
const COLOR_HEX = { CYAN: '#63e8dc', CORAL: '#ff7d77', LIME: '#cbf26a', VIOLET: '#b995ff' };
const rounds = [
  { title: 'The entry code', name: 'KEYPAD', desc: 'Piece together the four-digit access code. Each agent has different intel.', type: 'digits' },
  { title: 'Tune the signal', name: 'FREQUENCY', desc: 'Repeat the color sequence in the exact order. Share your private readings.', type: 'colors' },
  { title: 'Cut the right wires', name: 'WIRE ROOM', desc: 'Compare the wire readings. Select exactly two safe wires to disarm the panel.', type: 'wires' },
  { title: 'Trace the escape route', name: 'ROUTE FINDER', desc: 'Share your direction readings, then enter the four moves to the exit.', type: 'route' },
  { title: 'Spot the decoy', name: 'BADGE ANALYSIS', desc: 'Each agent has shape readings for different badges. Find the one with the odd frame.', type: 'odd' },
  { title: 'Trace the echo', name: 'ECHO TRACE', desc: 'A new color signal is hiding in your crew’s separate readings. Replay it in order.', type: 'colors' },
  { title: 'Auxiliary breaker', name: 'AUXILIARY WIRES', desc: 'The backup breaker has two safe wires. Identify them from the crew’s status reports.', type: 'wires' },
  { title: 'Vault override', name: 'VAULT OVERRIDE', desc: 'The inner vault needs another access code. Compare every position.', type: 'digits' },
  { title: 'Maze junction', name: 'MAZE JUNCTION', desc: 'Combine the crew’s compass readings to plot a route through the junction.', type: 'route' },
  { title: 'Find the forged badge', name: 'FORGERY CHECK', desc: 'Use each agent’s badge-shape report to identify the single forged pass.', type: 'odd' },
  { title: 'Extraction signal', name: 'EXTRACTION SIGNAL', desc: 'Align the final signal sequence and make your escape together.', type: 'colors' }
];
const challengeCount = playerCount => Math.max(3, Math.min(11, playerCount + 1));

app.use(express.static(path.join(__dirname, 'public')));

function code() {
  let result;
  do { result = crypto.randomBytes(3).toString('hex').slice(0, 5).toUpperCase(); } while (rooms.has(result));
  return result;
}
function playerName(name) {
  const clean = String(name || '').trim().replace(/[<>]/g, '').slice(0, 18);
  return clean || 'Agent';
}
function makeRound(index, players) {
  const config = rounds[index];
  let answer;
  let options;
  let clueValues;
  if (config.type === 'digits') {
    answer = Array.from({ length: 4 }, () => String(1 + Math.floor(Math.random() * 8)));
    clueValues = answer;
  } else if (config.type === 'colors') {
    answer = Array.from({ length: 4 }, () => COLORS[Math.floor(Math.random() * COLORS.length)]);
    clueValues = answer;
  } else if (config.type === 'route') {
    const directions = ['NORTH', 'EAST', 'SOUTH', 'WEST'];
    answer = Array.from({ length: 4 }, () => directions[Math.floor(Math.random() * directions.length)]);
    clueValues = answer;
  } else if (config.type === 'wires') {
    const shuffled = [...COLORS].sort(() => Math.random() - 0.5);
    answer = shuffled.slice(0, 2);
    options = COLORS;
    clueValues = COLORS.map(color => `${color}: ${answer.includes(color) ? 'SAFE' : 'LIVE'}`);
  } else {
    const matchingShape = ['CIRCLE', 'SQUARE', 'TRIANGLE', 'DIAMOND'][Math.floor(Math.random() * 4)];
    const otherShapes = ['CIRCLE', 'SQUARE', 'TRIANGLE', 'DIAMOND'].filter(shape => shape !== matchingShape);
    const oddShape = otherShapes[Math.floor(Math.random() * otherShapes.length)];
    const oddIndex = Math.floor(Math.random() * 4);
    options = ['A', 'B', 'C', 'D'];
    clueValues = options.map((_, index) => index === oddIndex ? oddShape : matchingShape);
    answer = [options[oddIndex]];
  }
  const clues = Object.fromEntries(players.map(player => [player.id, []]));
  clueValues.forEach((value, position) => {
    const holder = players[(position + index * 4) % players.length];
    clues[holder.id].push({ position: position + 1, value });
  });
  return { ...config, answer, options, clues };
}
function cleanRoom(room, socketId) {
  const player = room.players.get(socketId);
  const spectator = room.spectators.get(socketId);
  const current = room.rounds[room.roundIndex];
  const count = room.phase === 'playing' ? room.rounds.length : challengeCount(room.players.size);
  return {
    code: room.code,
    name: room.name,
    visibility: room.visibility,
    maxPlayers: room.maxPlayers,
    players: [...room.players.values()].map(({ id, name, color, ready }) => ({ id, name, color, ready: Boolean(ready), host: id === room.hostId })),
    spectatorCount: room.spectators.size,
    isSpectator: Boolean(spectator),
    hostId: room.hostId,
    selfId: socketId,
    phase: room.phase,
    roundIndex: room.roundIndex,
    rounds: (room.phase === 'playing' ? room.rounds : rounds.slice(0, count)).map(({ title, name, desc, type, options }) => ({ title, name, desc, type, options })),
    clues: player && current ? (current.clues[socketId] || []) : [],
    startedAt: room.startedAt,
    deadline: room.deadline,
    strikes: room.strikes,
    activity: room.activity.slice(-16),
    lastResult: room.lastResult,
    remaining: room.phase === 'playing' ? Math.max(0, room.deadline - Date.now()) : null
  };
}
function broadcast(room) {
  for (const id of room.players.keys()) io.to(id).emit('room:update', cleanRoom(room, id));
  for (const id of room.spectators.keys()) io.to(id).emit('room:update', cleanRoom(room, id));
  io.emit('servers:update', publicServers());
}
function publicServers() {
  return [...rooms.values()]
    .filter(room => room.visibility === 'public' && ['lobby', 'playing'].includes(room.phase))
    .map(room => ({ code: room.code, name: room.name, host: room.players.get(room.hostId)?.name || 'Host', players: room.players.size, maxPlayers: room.maxPlayers, spectators: room.spectators.size, challenges: room.phase === 'playing' ? room.rounds.length : challengeCount(room.players.size), phase: room.phase }))
    .sort((a, b) => a.players - b.players);
}
function activity(room, text, playerId = null) {
  room.activity.push({ text, playerId, at: Date.now() });
  room.activity = room.activity.slice(-24);
}
function endGame(room, won) {
  room.phase = won ? 'won' : 'lost';
  room.lastResult = won ? 'You made it out. The signal is clear.' : 'The extraction window closed. Run it back?';
  activity(room, won ? 'Extraction complete — all agents escaped.' : 'The failsafe closed the room.');
}

io.on('connection', socket => {
  socket.on('room:create', ({ name, visibility, maxPlayers }, reply = () => {}) => {
    const id = code();
    const hostName = playerName(name);
    const cap = Math.min(10, Math.max(2, Math.floor(Number(maxPlayers) || 4)));
    const isPublic = visibility === 'public';
    const player = { id: socket.id, name: hostName, color: '#70e6dc', ready: false };
    const room = { code: id, name: `${hostName}'s crew`, visibility: isPublic ? 'public' : 'private', maxPlayers: cap, players: new Map([[socket.id, player]]), spectators: new Map(), hostId: socket.id, phase: 'lobby', roundIndex: 0, rounds: [], startedAt: null, deadline: null, strikes: 0, activity: [], lastResult: null };
    rooms.set(id, room); socket.join(id); socket.data.roomCode = id; socket.data.role = 'player';
    activity(room, `${player.name} opened a secure channel.`);
    reply({ ok: true, code: id }); broadcast(room);
  });

  socket.on('room:join', ({ name, code: roomCode }, reply = () => {}) => {
    const room = rooms.get(String(roomCode || '').toUpperCase().trim());
    if (!room) return reply({ ok: false, error: 'Room not found. Check the code and try again.' });
    if (room.phase !== 'lobby') return reply({ ok: false, error: 'That run has already started. Join a room that is still in its lobby.' });
    if (room.players.size >= room.maxPlayers) return reply({ ok: false, error: `This room is full (${room.maxPlayers} agents max).` });
    if ([...room.players.values(), ...room.spectators.values()].some(p => p.name.toLowerCase() === playerName(name).toLowerCase())) return reply({ ok: false, error: 'Someone in this room already has that callsign.' });
    const palette = ['#ff9b75', '#c19aff', '#bce87b'];
    const player = { id: socket.id, name: playerName(name), color: palette[(room.players.size - 1) % palette.length], ready: false };
    room.players.set(socket.id, player); socket.join(room.code); socket.data.roomCode = room.code; socket.data.role = 'player';
    activity(room, `${player.name} joined the crew.`);
    reply({ ok: true }); broadcast(room);
  });

  socket.on('room:spectate', ({ name, code: roomCode }, reply = () => {}) => {
    const room = rooms.get(String(roomCode || '').toUpperCase().trim());
    if (!room) return reply({ ok: false, error: 'Server not found. Check the code and try again.' });
    if (room.spectators.size >= 20) return reply({ ok: false, error: 'This server has reached its spectator limit.' });
    const observerName = playerName(name);
    if ([...room.players.values(), ...room.spectators.values()].some(person => person.name.toLowerCase() === observerName.toLowerCase())) return reply({ ok: false, error: 'Someone in this server already has that callsign.' });
    const palette = ['#b9a4ff', '#81bfff', '#ffcf78', '#efa0cf'];
    room.spectators.set(socket.id, { id: socket.id, name: observerName, color: palette[room.spectators.size % palette.length] });
    socket.join(room.code); socket.data.roomCode = room.code; socket.data.role = 'spectator';
    activity(room, `${observerName} started spectating.`);
    reply({ ok: true }); broadcast(room);
  });

  socket.on('servers:list', (reply = () => {}) => reply(publicServers()));

  socket.on('room:ready', (reply = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !['lobby', 'won', 'lost'].includes(room.phase)) return reply({ ok: false, error: 'Readiness can only change between runs.' });
    if (!room.players.has(socket.id)) return reply({ ok: false, error: 'Spectators cannot ready up.' });
    const player = room.players.get(socket.id);
    if (!player) return reply({ ok: false, error: 'You are no longer in this room.' });
    player.ready = !player.ready;
    activity(room, `${player.name} ${player.ready ? 'is ready' : 'is not ready'}.`);
    broadcast(room); reply({ ok: true, ready: player.ready });
  });

  socket.on('game:start', reply => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return (reply || (() => {}))({ ok: false, error: 'Room closed.' });
    if (!room.players.has(socket.id)) return (reply || (() => {}))({ ok: false, error: 'Spectators cannot start a run.' });
    if (socket.id !== room.hostId) return (reply || (() => {}))({ ok: false, error: 'Only the host can start the run.' });
    if (room.players.size < 2) return (reply || (() => {}))({ ok: false, error: 'Invite at least one other agent first.' });
    if (!['lobby', 'won', 'lost'].includes(room.phase)) return (reply || (() => {}))({ ok: false, error: 'A run is already in progress.' });
    if ([...room.players.values()].some(player => !player.ready)) return (reply || (() => {}))({ ok: false, error: 'Everyone needs to be ready first.' });
    room.phase = 'playing'; room.roundIndex = 0; room.strikes = 0; room.startedAt = Date.now(); room.deadline = room.startedAt + 8 * 60 * 1000;
    for (const player of room.players.values()) player.ready = false;
    room.rounds = rounds.slice(0, challengeCount(room.players.size)).map((_, index) => makeRound(index, [...room.players.values()]));
    room.lastResult = null;
    activity(room, 'Run started. Eight minutes on the clock.');
    broadcast(room); if (reply) reply({ ok: true });
  });

  socket.on('puzzle:submit', ({ answer }, reply = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'playing') return reply({ ok: false, error: 'There is no active run.' });
    if (!room.players.has(socket.id)) return reply({ ok: false, error: 'Spectators cannot submit puzzle answers.' });
    if (Date.now() >= room.deadline) { endGame(room, false); broadcast(room); return reply({ ok: false, error: 'Time is up.' }); }
    const round = room.rounds[room.roundIndex];
    const guess = Array.isArray(answer) ? answer.map(v => String(v).toUpperCase()) : [];
    const validAnswer = round.type === 'wires'
      ? guess.length === 2 && new Set(guess).size === 2
      : round.type === 'odd' ? guess.length === 1 : guess.length === 4;
    if (!validAnswer || guess.some(value => !value)) return reply({ ok: false, error: 'Complete the challenge first.' });
    const correct = round.type === 'wires'
      ? guess.length === round.answer.length && guess.every(value => round.answer.includes(value))
      : guess.every((value, index) => value === round.answer[index]);
    if (correct) {
      activity(room, `${room.players.get(socket.id).name} solved ${round.name}.`);
      room.lastResult = 'Correct! Module unlocked.';
      room.roundIndex += 1;
      if (room.roundIndex >= room.rounds.length) endGame(room, true);
      else { room.lastResult = 'Correct! Next module is live.'; }
      broadcast(room); reply({ ok: true, correct: true });
    } else {
      room.strikes += 1;
      room.lastResult = 'Not quite. Check everyone’s intel and try again.';
      activity(room, `${room.players.get(socket.id).name} submitted an answer. The panel rejected it.`);
      if (room.strikes >= 3) endGame(room, false);
      broadcast(room); reply({ ok: true, correct: false });
    }
  });

  socket.on('chat:send', ({ message }, reply = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.players.has(socket.id)) return reply({ ok: false, error: 'Spectator chat is read-only.' });
    const text = String(message || '').trim().replace(/[<>]/g, '').slice(0, 180);
    if (!text) return reply({ ok: false });
    const player = room.players.get(socket.id);
    activity(room, `${player.name}: ${text}`, socket.id); broadcast(room); reply({ ok: true });
  });

  socket.on('room:leave', () => leaveRoom(socket));
  socket.on('disconnect', () => leaveRoom(socket));
});

function leaveRoom(socket) {
  const room = rooms.get(socket.data.roomCode);
  if (!room) return;
  const player = room.players.get(socket.id);
  const spectator = room.spectators.get(socket.id);
  if (!player && !spectator) return;
  if (player) room.players.delete(socket.id);
  if (spectator) room.spectators.delete(socket.id);
  socket.leave(room.code); socket.data.roomCode = null; socket.data.role = null;
  activity(room, player ? `${player.name} left the crew.` : `${spectator.name} stopped spectating.`);
  if (room.players.size === 0) {
    for (const id of room.spectators.keys()) {
      const observer = io.sockets.sockets.get(id);
      observer?.emit('room:closed', { message: 'The host crew has left this server.' });
      observer?.leave(room.code);
      if (observer) { observer.data.roomCode = null; observer.data.role = null; }
    }
    rooms.delete(room.code); io.emit('servers:update', publicServers()); return;
  }
  if (room.hostId === socket.id) { room.hostId = room.players.keys().next().value; activity(room, `${room.players.get(room.hostId).name} is now host.`); }
  if (room.phase === 'lobby' && room.players.size === 1) activity(room, 'Waiting for one more agent to start.');
  broadcast(room);
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.phase === 'playing' && now >= room.deadline) { endGame(room, false); broadcast(room); }
  }
}, 1000).unref();

server.listen(PORT, () => console.log(`Signal Break is live at http://localhost:${PORT}`));
