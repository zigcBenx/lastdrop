import { GameState, PlayerState } from '../shared/types';
import { TICK_MS } from '../shared/constants';

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

interface TimestampedState {
  state: GameState;
  timestamp: number;
}

export class Interpolator {
  private prevState: GameState | null = null;
  private currState: GameState | null = null;
  private lastUpdateTime: number = 0;

  pushState(state: GameState): void {
    this.prevState = this.currState;
    this.currState = state;
    this.lastUpdateTime = performance.now();
  }

  getInterpolatedState(): GameState | null {
    if (!this.currState) return null;
    if (!this.prevState) return this.currState;

    const elapsed = performance.now() - this.lastUpdateTime;
    const t = elapsed / TICK_MS;

    // When t <= 1: interpolate between prev and curr (normal)
    // When t > 1: extrapolate beyond curr using velocity (covers network gaps)
    const players: PlayerState[] = this.currState.players.map((curr) => {
      const prev = this.prevState!.players.find((p) => p.id === curr.id);
      if (!prev) return curr;

      if (t <= 1) {
        // Standard interpolation
        return {
          ...curr,
          x: prev.x + (curr.x - prev.x) * t,
          y: prev.y + (curr.y - prev.y) * t,
          angle: lerpAngle(prev.angle, curr.angle, t),
        };
      } else {
        // Extrapolate using velocity (capped at 2 ticks ahead to prevent overshoot)
        const extraT = Math.min(t - 1, 2);
        const dtSeconds = (TICK_MS / 1000) * extraT;
        return {
          ...curr,
          x: curr.x + curr.vx * dtSeconds * 60,
          y: curr.y + curr.vy * dtSeconds * 60,
          angle: curr.angle + (curr.angle - prev.angle) * extraT * 0.5,
        };
      }
    });

    return {
      ...this.currState,
      players,
    };
  }
}
