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
  private stateBuffer: TimestampedState[] = [];
  private renderDelay = TICK_MS * 2; // Render 2 ticks behind to allow for interpolation

  pushState(state: GameState): void {
    this.stateBuffer.push({
      state,
      timestamp: performance.now(),
    });

    // Keep buffer size reasonable (max 10 states)
    if (this.stateBuffer.length > 10) {
      this.stateBuffer.shift();
    }
  }

  getInterpolatedState(): GameState | null {
    if (this.stateBuffer.length === 0) return null;

    // At startup, just use the latest state until we have enough buffer
    if (this.stateBuffer.length < 3) {
      return this.stateBuffer[this.stateBuffer.length - 1].state;
    }

    const now = performance.now();
    const renderTime = now - this.renderDelay;

    // If render time is behind the first state, use the first state
    if (renderTime < this.stateBuffer[0].timestamp) {
      return this.stateBuffer[0].state;
    }

    // If render time is ahead of all states, use the latest
    if (renderTime >= this.stateBuffer[this.stateBuffer.length - 1].timestamp) {
      return this.stateBuffer[this.stateBuffer.length - 1].state;
    }

    // Find the two states to interpolate between
    let prevIndex = 0;
    let nextIndex = 1;

    for (let i = 0; i < this.stateBuffer.length - 1; i++) {
      if (this.stateBuffer[i].timestamp <= renderTime && this.stateBuffer[i + 1].timestamp >= renderTime) {
        prevIndex = i;
        nextIndex = i + 1;
        break;
      }
    }

    const prevState = this.stateBuffer[prevIndex].state;
    const nextState = this.stateBuffer[nextIndex].state;
    const prevTime = this.stateBuffer[prevIndex].timestamp;
    const nextTime = this.stateBuffer[nextIndex].timestamp;

    const t = Math.max(0, Math.min(1, (renderTime - prevTime) / (nextTime - prevTime)));

    const players: PlayerState[] = nextState.players.map((next) => {
      const prev = prevState.players.find((p) => p.id === next.id);
      if (!prev) return next;

      return {
        ...next,
        x: prev.x + (next.x - prev.x) * t,
        y: prev.y + (next.y - prev.y) * t,
        angle: lerpAngle(prev.angle, next.angle, t),
        vx: prev.vx + (next.vx - prev.vx) * t,
        vy: prev.vy + (next.vy - prev.vy) * t,
      };
    });

    return {
      ...nextState,
      players,
    };
  }
}
