import { GameState, PlayerState } from '../shared/types';
import { TICK_MS } from '../shared/constants';

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
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
    const t = Math.min(1, elapsed / TICK_MS);

    const players: PlayerState[] = this.currState.players.map((curr) => {
      const prev = this.prevState!.players.find((p) => p.id === curr.id);
      if (!prev) return curr;

      return {
        ...curr,
        x: prev.x + (curr.x - prev.x) * t,
        y: prev.y + (curr.y - prev.y) * t,
        angle: lerpAngle(prev.angle, curr.angle, t),
      };
    });

    return {
      ...this.currState,
      players,
      // Pickups and collisions use latest state (no interpolation needed)
    };
  }
}
