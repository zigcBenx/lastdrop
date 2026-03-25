import { Server, Socket } from 'socket.io';
import { PhysicsEngine } from './PhysicsEngine';
import { InputState, GameState, GamePhase, JoinPayload } from '../shared/types';
import { TICK_MS, TICK_RATE, GAME_DURATION, FUEL_PER_TICK, RESTART_DELAY, COUNTDOWN_SECONDS, COMBO_TIERS, GAS_STATIONS, STATION_FAILURE_MIN_DURATION, STATION_FAILURE_MAX_DURATION, STATION_OPEN_MIN_DURATION, STATION_OPEN_MAX_DURATION, MIN_STATIONS_ACTIVE } from '../shared/constants';

interface PlayerInfo {
  socket: Socket;
  payload: JoinPayload;
}

interface StationTimer {
  nextChangeTime: number; // time remaining when this station will change state
  willBeActive: boolean; // will it be active or inactive after the change
}

export class GameRoom {
  private physics: PhysicsEngine;
  private playerInputs: Map<string, InputState> = new Map();
  private players: Map<string, PlayerInfo> = new Map();
  private phase: GamePhase = 'waiting';
  private timeRemaining: number = GAME_DURATION;
  private restartTimer: number = 0;
  private countdownTimer: number = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private io: Server;
  private roomId: string;
  private activeZones: number[] = [];
  private stationTimers: StationTimer[] = [];

  constructor(io: Server, roomId: string) {
    this.io = io;
    this.roomId = roomId;
    this.physics = new PhysicsEngine();
    this.activeZones = GAS_STATIONS.map((_, i) => i);
    this.initializeStationTimers();
  }

  private initializeStationTimers(): void {
    // Initialize all stations with random timers
    this.stationTimers = GAS_STATIONS.map((_, i) => {
      // Start with all stations active, but schedule their first closure
      const nextChangeTime = GAME_DURATION - this.randomBetween(STATION_OPEN_MIN_DURATION, STATION_OPEN_MAX_DURATION);
      return {
        nextChangeTime,
        willBeActive: false, // will close
      };
    });

    // Ensure at least one station is scheduled to close soon (within first 10 seconds)
    const earlyCloseIndex = Math.floor(Math.random() * GAS_STATIONS.length);
    this.stationTimers[earlyCloseIndex].nextChangeTime = GAME_DURATION - this.randomBetween(3, 8);
  }

  private randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  private updateStationFailures(): void {
    // Check each station's timer
    for (let i = 0; i < GAS_STATIONS.length; i++) {
      const timer = this.stationTimers[i];

      // Check if it's time to change this station's state
      if (this.timeRemaining <= timer.nextChangeTime) {
        const isCurrentlyActive = this.activeZones.includes(i);

        if (timer.willBeActive && !isCurrentlyActive) {
          // Reopen station
          this.activeZones.push(i);
          // Schedule next closure
          timer.nextChangeTime = this.timeRemaining - this.randomBetween(STATION_OPEN_MIN_DURATION, STATION_OPEN_MAX_DURATION);
          timer.willBeActive = false;
        } else if (!timer.willBeActive && isCurrentlyActive) {
          // Close station only if we maintain minimum active stations
          if (this.activeZones.length > MIN_STATIONS_ACTIVE) {
            this.activeZones = this.activeZones.filter(zi => zi !== i);
            // Schedule reopening
            timer.nextChangeTime = this.timeRemaining - this.randomBetween(STATION_FAILURE_MIN_DURATION, STATION_FAILURE_MAX_DURATION);
            timer.willBeActive = true;
          } else {
            // Can't close - would violate minimum active stations rule
            // Reschedule this station's closure attempt
            timer.nextChangeTime = this.timeRemaining - this.randomBetween(2, 5);
          }
        }
      }
    }
  }

  addPlayer(socket: Socket, payload: JoinPayload): void {
    const id = socket.id;
    this.players.set(id, { socket, payload });
    this.playerInputs.set(id, { forward: false, backward: false, left: false, right: false });
    this.physics.addCar(id, payload.carType, payload.nickname, payload.emoji, payload.color);

    socket.join(this.roomId);

    if (this.phase === 'waiting') {
      this.startCountdown();
    }

    socket.emit('state', this.buildGameState());
  }

  removePlayer(id: string): void {
    this.physics.removeCar(id);
    this.playerInputs.delete(id);
    this.players.delete(id);

    if (this.players.size === 0) {
      this.stopGame();
      this.phase = 'waiting';
    }
  }

  handleInput(id: string, input: InputState): void {
    this.playerInputs.set(id, input);
  }

  private startCountdown(): void {
    this.phase = 'countdown';
    this.countdownTimer = COUNTDOWN_SECONDS;

    if (!this.tickTimer) {
      this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    }
  }

  private startGame(): void {
    this.phase = 'playing';
    this.timeRemaining = GAME_DURATION;
    this.restartTimer = 0;
    this.activeZones = GAS_STATIONS.map((_, i) => i);
    this.initializeStationTimers();
  }

  private stopGame(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private restartGame(): void {
    this.physics.reset();

    for (const [id, info] of this.players) {
      this.physics.addCar(id, info.payload.carType, info.payload.nickname, info.payload.emoji, info.payload.color);
      this.playerInputs.set(id, { forward: false, backward: false, left: false, right: false });
    }

    // Go to countdown
    this.phase = 'countdown';
    this.countdownTimer = COUNTDOWN_SECONDS;
  }

  private tick(): void {
    // Handle countdown
    if (this.phase === 'countdown') {
      this.countdownTimer -= 1 / TICK_RATE;
      if (this.countdownTimer <= 0) {
        this.startGame();
      }
      this.io.to(this.roomId).emit('state', this.buildGameState());
      return;
    }

    // Handle restart countdown
    if (this.phase === 'finished') {
      this.restartTimer -= 1 / TICK_RATE;
      if (this.restartTimer <= 0) {
        this.restartGame();
      }
      this.io.to(this.roomId).emit('state', this.buildGameState());
      return;
    }

    if (this.phase !== 'playing') return;

    // 1. Apply inputs
    for (const [id, input] of this.playerInputs) {
      this.physics.applyInput(id, input);
    }

    // 2. Step physics
    this.physics.step();

    // 3. Handle random station failures
    this.updateStationFailures();

    // 4. Update combos
    this.physics.updateCombos(this.activeZones);

    // 5. Score: players in zone gain fuel (with combo multiplier)
    const occupants = this.physics.getZoneOccupants(this.activeZones);
    for (const id of occupants) {
      const currentFuel = this.physics.getFuel(id);
      const comboSeconds = this.physics.getComboSeconds(id);

      // Get combo multiplier
      let multiplier = 1;
      for (const tier of COMBO_TIERS) {
        if (comboSeconds >= tier.seconds) multiplier = tier.multiplier;
      }

      this.physics.setFuel(id, currentFuel + FUEL_PER_TICK * multiplier);
    }

    // 6. Drain fuel from cars driving outside zone
    this.physics.drainFuelOutsideZone(this.activeZones);

    // 7. Decrement timer
    this.timeRemaining -= 1 / TICK_RATE;
    if (this.timeRemaining <= 0) {
      this.timeRemaining = 0;
      this.phase = 'finished';
      this.restartTimer = RESTART_DELAY;
    }

    // 8. Broadcast state
    this.io.to(this.roomId).emit('state', this.buildGameState());
  }

  private buildGameState(): GameState {
    const state: GameState = {
      players: this.physics.getPlayerStates(this.activeZones),
      pickups: this.physics.getPickups(),
      collisions: this.physics.getCollisions(),
      spills: this.physics.getSpills(),
      timeRemaining: Math.max(0, this.timeRemaining),
      phase: this.phase,
      activeZones: [...this.activeZones],
    };

    if (this.phase === 'countdown') {
      state.countdownValue = Math.ceil(this.countdownTimer);
    }

    if (this.phase === 'finished') {
      state.restartIn = Math.max(0, this.restartTimer);
      state.awards = this.physics.computeAwards();
    }

    return state;
  }

  hasPlayer(id: string): boolean {
    return this.players.has(id);
  }

  getPlayerCount(): number {
    return this.players.size;
  }
}
