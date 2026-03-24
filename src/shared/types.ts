export type CarType = 'zastava' | 'suv' | 'fico' | 'bulli';

export type GamePhase = 'waiting' | 'countdown' | 'playing' | 'finished';

export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
}

export interface PlayerState {
  id: string;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  fuel: number;
  carType: CarType;
  nickname: string;
  emoji: string;
  color: string;
  inZone: boolean;
  combo: number; // current zone streak multiplier (1, 1.5, 2, etc)
  hitFlash: number; // ticks remaining of hit flash (0 = no flash)
  speed: number; // current speed magnitude (for client effects)
  driftAngle: number; // angle between facing direction and velocity (for skid marks)
}

export interface FuelPickup {
  id: string;
  x: number;
  y: number;
  amount: number;
  ttl: number;
}

export interface CollisionEvent {
  x: number;
  y: number;
  intensity: number;
}

export interface SpillEvent {
  attackerName: string;
  victimName: string;
  amount: number;
}

export interface RoundAward {
  title: string;
  playerName: string;
  emoji: string;
  value: string;
}

export interface GameState {
  players: PlayerState[];
  pickups: FuelPickup[];
  collisions: CollisionEvent[];
  spills: SpillEvent[];
  timeRemaining: number;
  phase: GamePhase;
  activeZones: number[]; // indices into GAS_STATIONS that are still active
  awards?: RoundAward[]; // end-of-round awards
  countdownValue?: number; // 3, 2, 1 during countdown phase
  restartIn?: number;
}

export interface JoinPayload {
  nickname: string;
  carType: CarType;
  emoji: string;
  color: string;
}
