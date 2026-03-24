import { io } from 'socket.io-client';
import { Renderer } from './Renderer';
import { InputHandler } from './InputHandler';
import { Interpolator } from './Interpolator';
import { SoundManager } from './SoundManager';
import { GameState, CarType } from '../shared/types';
import { CAR_EMOJIS, CAR_COLORS } from '../shared/constants';

// --- Lobby UI ---
const lobbyDiv = document.getElementById('lobby') as HTMLDivElement;
const gameDiv = document.getElementById('game-container') as HTMLDivElement;
const nicknameInput = document.getElementById('nickname') as HTMLInputElement;
const carTypeSelect = document.getElementById('car-type') as HTMLSelectElement;
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
const emojiPicker = document.getElementById('emoji-picker') as HTMLDivElement;
const colorPicker = document.getElementById('color-picker') as HTMLDivElement;

let selectedEmoji = CAR_EMOJIS[Math.floor(Math.random() * CAR_EMOJIS.length)];
let selectedColor = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];

// Build emoji picker
CAR_EMOJIS.forEach((emoji) => {
  const btn = document.createElement('button');
  btn.className = 'emoji-btn' + (emoji === selectedEmoji ? ' selected' : '');
  btn.textContent = emoji;
  btn.type = 'button';
  btn.addEventListener('click', () => {
    selectedEmoji = emoji;
    emojiPicker.querySelectorAll('.emoji-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
  emojiPicker.appendChild(btn);
});

// Build color picker
CAR_COLORS.forEach((color) => {
  const btn = document.createElement('button');
  btn.className = 'color-btn' + (color === selectedColor ? ' selected' : '');
  btn.style.background = color;
  btn.type = 'button';
  btn.addEventListener('click', () => {
    selectedColor = color;
    colorPicker.querySelectorAll('.color-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
  colorPicker.appendChild(btn);
});

const socket = io();
const sound = new SoundManager();

let renderer: Renderer | null = null;
let inputHandler: InputHandler | null = null;
const interpolator = new Interpolator();
let running = false;
let myId: string = '';

// Sound state tracking
let prevPhase: string = '';
let sirenStarted = false;
let lastFuelTickTime = 0;
let prevPickupCount = 0;

joinBtn.addEventListener('click', () => {
  const nickname = nicknameInput.value.trim() || 'Player';
  const carType = carTypeSelect.value as CarType;

  lobbyDiv.style.display = 'none';
  gameDiv.style.display = 'block';

  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  renderer = new Renderer(canvas);
  inputHandler = new InputHandler(socket);

  socket.emit('join', {
    nickname,
    carType,
    emoji: selectedEmoji,
    color: selectedColor,
  });

  running = true;
  requestAnimationFrame(gameLoop);
});

nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});

socket.on('connect', () => {
  myId = socket.id || '';
});

socket.on('state', (state: GameState) => {
  interpolator.pushState(state);

  // Feed spill events to kill feed
  if (renderer && state.spills.length > 0) {
    renderer.addKillFeedEntries(state.spills);
  }

  // Collision sounds
  for (const col of state.collisions) {
    sound.playCollision(col.intensity);
  }

  // Fuel tick sound
  const me = state.players.find((p) => p.id === myId);
  if (me && me.inZone) {
    const now = performance.now();
    if (now - lastFuelTickTime > 500) {
      sound.playFuelTick();
      lastFuelTickTime = now;
    }
  }

  // Pickup collect sound
  if (state.pickups.length < prevPickupCount && prevPickupCount > 0) {
    sound.playPickupCollect();
  }
  prevPickupCount = state.pickups.length;

  // Siren for final 10 seconds
  if (state.phase === 'playing' && state.timeRemaining <= 10 && !sirenStarted) {
    sound.startSiren();
    sirenStarted = true;
  }
  if (state.phase !== 'playing' && sirenStarted) {
    sound.stopSiren();
    sirenStarted = false;
  }

  // Game over sound
  if (state.phase === 'finished' && prevPhase === 'playing') {
    sound.playGameOver();
  }

  // Reset siren flag on new round
  if (state.phase === 'playing' && prevPhase !== 'playing') {
    sirenStarted = false;
  }

  prevPhase = state.phase;
});

function gameLoop(): void {
  if (!running || !renderer) return;

  const state = interpolator.getInterpolatedState();
  if (state) {
    renderer.render(state, myId);
  }

  requestAnimationFrame(gameLoop);
}
