import { GameState, PlayerState, FuelPickup, CollisionEvent, SpillEvent } from '../shared/types';
import {
  MAP_WIDTH,
  MAP_HEIGHT,
  VIEWPORT_WIDTH,
  VIEWPORT_HEIGHT,
  SLOVENIA_POLYGON,
  GAS_STATIONS,
  CAR_ARCHETYPES,
  PICKUP_RADIUS,
} from '../shared/constants';

interface FlashEffect {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
}

interface SkidMark {
  x: number;
  y: number;
  alpha: number;
  angle: number;
  width: number;
}

interface KillFeedEntry {
  text: string;
  color: string;
  ttl: number; // frames remaining
}

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private shakeOffset = { x: 0, y: 0 };
  private shakeDecay = 0;
  private zonePulse = 0;
  private flashes: FlashEffect[] = [];
  private skidMarks: SkidMark[] = [];
  private killFeed: KillFeedEntry[] = [];
  // Camera position (top-left corner of viewport in world space)
  private camX = 0;
  private camY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvas.width = VIEWPORT_WIDTH;
    this.canvas.height = VIEWPORT_HEIGHT;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Cannot get 2d context');
    this.ctx = ctx;
  }

  triggerShake(intensity: number = 6): void {
    this.shakeDecay = Math.max(this.shakeDecay, intensity);
  }

  addKillFeedEntries(spills: SpillEvent[]): void {
    for (const spill of spills) {
      this.killFeed.push({
        text: `${spill.attackerName} knocked ${spill.amount.toFixed(1)}L from ${spill.victimName}!`,
        color: '#f39c12',
        ttl: 180, // ~3 seconds at 60fps
      });
    }
    // Keep max 5 entries
    if (this.killFeed.length > 5) {
      this.killFeed = this.killFeed.slice(-5);
    }
  }

  private processCollisions(collisions: CollisionEvent[]): void {
    for (const col of collisions) {
      this.triggerShake(col.intensity * 12);
      this.flashes.push({
        x: col.x,
        y: col.y,
        radius: 5,
        maxRadius: 30 + col.intensity * 40,
        alpha: 0.8,
      });
    }
  }

  private addSkidMarks(players: PlayerState[]): void {
    for (const player of players) {
      const absDrift = Math.abs(player.driftAngle);
      // Only add skid marks when drifting noticeably and moving
      if (absDrift > 0.3 && player.speed > 2) {
        const stats = CAR_ARCHETYPES[player.carType];
        // Rear left and right tire positions
        const rearX = player.x - Math.cos(player.angle) * stats.length * 0.35;
        const rearY = player.y - Math.sin(player.angle) * stats.length * 0.35;

        const perpX = -Math.sin(player.angle);
        const perpY = Math.cos(player.angle);

        const halfW = stats.width * 0.4;

        this.skidMarks.push({
          x: rearX + perpX * halfW,
          y: rearY + perpY * halfW,
          alpha: Math.min(0.5, absDrift * 0.4),
          angle: player.angle,
          width: 3,
        });
        this.skidMarks.push({
          x: rearX - perpX * halfW,
          y: rearY - perpY * halfW,
          alpha: Math.min(0.5, absDrift * 0.4),
          angle: player.angle,
          width: 3,
        });
      }
    }

    // Fade and cull old marks
    this.skidMarks = this.skidMarks.filter((mark) => {
      mark.alpha -= 0.003;
      return mark.alpha > 0.01;
    });

    // Limit total marks for performance
    if (this.skidMarks.length > 500) {
      this.skidMarks = this.skidMarks.slice(-500);
    }
  }

  private updateCamera(state: GameState, myId: string): void {
    const me = state.players.find((p) => p.id === myId);
    if (me) {
      // Center camera on local player
      const targetX = me.x - VIEWPORT_WIDTH / 2;
      const targetY = me.y - VIEWPORT_HEIGHT / 2;
      // Smooth camera follow
      this.camX += (targetX - this.camX) * 0.15;
      this.camY += (targetY - this.camY) * 0.15;
    }
    // Clamp camera to map bounds
    this.camX = Math.max(0, Math.min(MAP_WIDTH - VIEWPORT_WIDTH, this.camX));
    this.camY = Math.max(0, Math.min(MAP_HEIGHT - VIEWPORT_HEIGHT, this.camY));
  }

  render(state: GameState, myId: string): void {
    const ctx = this.ctx;

    this.processCollisions(state.collisions);
    this.addSkidMarks(state.players);
    this.updateCamera(state, myId);

    // Update shake
    if (this.shakeDecay > 0.5) {
      this.shakeOffset.x = (Math.random() - 0.5) * this.shakeDecay * 2;
      this.shakeOffset.y = (Math.random() - 0.5) * this.shakeDecay * 2;
      this.shakeDecay *= 0.85;
    } else {
      this.shakeOffset.x = 0;
      this.shakeOffset.y = 0;
      this.shakeDecay = 0;
    }

    // Clear viewport
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

    // --- World-space drawing (affected by camera + shake) ---
    ctx.save();
    ctx.translate(
      -this.camX + this.shakeOffset.x,
      -this.camY + this.shakeOffset.y
    );

    this.drawBackground(ctx);
    this.drawSkidMarks(ctx);
    this.drawPumpZones(ctx, state);

    for (const pickup of state.pickups) {
      this.drawPickup(ctx, pickup);
    }

    this.updateAndDrawFlashes(ctx);

    // Determine leader for crown
    const sorted = [...state.players].sort((a, b) => b.fuel - a.fuel);
    const leaderId = sorted.length > 0 && sorted[0].fuel > 0 ? sorted[0].id : null;

    for (const player of state.players) {
      this.drawSpeedLines(ctx, player);
      this.drawCar(ctx, player, player.id === leaderId);
    }

    ctx.restore();

    // --- Screen-space drawing (HUD, not affected by camera) ---
    this.drawOffscreenArrows(ctx, state, myId);
    this.drawHUD(ctx, state, sorted);
    this.drawKillFeed(ctx);

    // Countdown overlay
    if (state.phase === 'countdown' && state.countdownValue !== undefined) {
      this.drawCountdown(ctx, state.countdownValue);
    }

    // Kill feed decay
    this.killFeed = this.killFeed.filter((entry) => {
      entry.ttl--;
      return entry.ttl > 0;
    });
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    // Slovenia shape as playable area
    ctx.beginPath();
    ctx.moveTo(SLOVENIA_POLYGON[0].x, SLOVENIA_POLYGON[0].y);
    for (let i = 1; i < SLOVENIA_POLYGON.length; i++) {
      ctx.lineTo(SLOVENIA_POLYGON[i].x, SLOVENIA_POLYGON[i].y);
    }
    ctx.closePath();

    // Asphalt fill
    ctx.fillStyle = '#2c2c2c';
    ctx.fill();

    // Road markings clipped to Slovenia shape
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(SLOVENIA_POLYGON[0].x, SLOVENIA_POLYGON[0].y);
    for (let i = 1; i < SLOVENIA_POLYGON.length; i++) {
      ctx.lineTo(SLOVENIA_POLYGON[i].x, SLOVENIA_POLYGON[i].y);
    }
    ctx.closePath();
    ctx.clip();

    ctx.strokeStyle = '#383838';
    ctx.lineWidth = 1;
    ctx.setLineDash([30, 40]);
    for (let y = 200; y < MAP_HEIGHT; y += 200) {
      ctx.beginPath();
      ctx.moveTo(100, y);
      ctx.lineTo(MAP_WIDTH - 100, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // Slovenia border outline
    ctx.beginPath();
    ctx.moveTo(SLOVENIA_POLYGON[0].x, SLOVENIA_POLYGON[0].y);
    for (let i = 1; i < SLOVENIA_POLYGON.length; i++) {
      ctx.lineTo(SLOVENIA_POLYGON[i].x, SLOVENIA_POLYGON[i].y);
    }
    ctx.closePath();
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  private drawSkidMarks(ctx: CanvasRenderingContext2D): void {
    for (const mark of this.skidMarks) {
      ctx.globalAlpha = mark.alpha;
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(mark.x, mark.y, mark.width, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawPumpZones(ctx: CanvasRenderingContext2D, state: GameState): void {
    this.zonePulse += 0.03;
    const pulse = Math.sin(this.zonePulse) * 0.15 + 0.85;
    const activeZones = state.activeZones ?? GAS_STATIONS.map((_, i) => i);

    for (let zi = 0; zi < GAS_STATIONS.length; zi++) {
      const zone = GAS_STATIONS[zi];
      const isActive = activeZones.includes(zi);

      if (!isActive) {
        // Deactivated zone: dim and grey
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Dimmed city name with "CLOSED" label
        ctx.fillStyle = '#555';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(zone.name, zone.x, zone.y + zone.radius + 18);
        ctx.font = 'bold 11px monospace';
        ctx.fillText('CLOSED', zone.x, zone.y);
        ctx.textBaseline = 'alphabetic';
        ctx.globalAlpha = 1;
        continue;
      }

      // Check if any player is inside this specific zone
      const hasOccupant = state.players.some((p) => {
        const dx = p.x - zone.x;
        const dy = p.y - zone.y;
        return Math.sqrt(dx * dx + dy * dy) < zone.radius;
      });

      // Radial gradient glow
      const gradient = ctx.createRadialGradient(
        zone.x, zone.y, zone.radius * 0.3,
        zone.x, zone.y, zone.radius * 1.2
      );

      if (hasOccupant) {
        gradient.addColorStop(0, `rgba(46, 204, 113, ${0.4 * pulse})`);
        gradient.addColorStop(1, 'rgba(46, 204, 113, 0)');
      } else {
        gradient.addColorStop(0, `rgba(241, 196, 15, ${0.3 * pulse})`);
        gradient.addColorStop(1, 'rgba(241, 196, 15, 0)');
      }

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(zone.x, zone.y, zone.radius * 1.2, 0, Math.PI * 2);
      ctx.fill();

      // Zone circle border
      ctx.strokeStyle = hasOccupant ? '#2ecc71' : '#f1c40f';
      ctx.lineWidth = 2;
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Pump icon (larger)
      ctx.fillStyle = '#888';
      ctx.fillRect(zone.x - 18, zone.y - 45, 36, 65);
      ctx.fillStyle = hasOccupant ? '#2ecc71' : '#f1c40f';
      ctx.beginPath();
      ctx.arc(zone.x, zone.y - 52, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 32px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('\u26FD', zone.x, zone.y - 52);

      // City name label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(zone.name, zone.x, zone.y + zone.radius + 18);
      ctx.textBaseline = 'alphabetic';
    }
  }

  private drawPickup(ctx: CanvasRenderingContext2D, pickup: FuelPickup): void {
    const fadeAlpha = Math.min(1, pickup.ttl / 2);
    const t = performance.now() / 300;
    const glow = Math.sin(t + pickup.x) * 0.2 + 0.8;

    ctx.globalAlpha = fadeAlpha * glow;

    const grad = ctx.createRadialGradient(pickup.x, pickup.y, 2, pickup.x, pickup.y, PICKUP_RADIUS * 2);
    grad.addColorStop(0, 'rgba(241, 196, 15, 0.6)');
    grad.addColorStop(1, 'rgba(241, 196, 15, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pickup.x, pickup.y, PICKUP_RADIUS * 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f1c40f';
    ctx.beginPath();
    ctx.arc(pickup.x, pickup.y, PICKUP_RADIUS * 0.7, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
  }

  private updateAndDrawFlashes(ctx: CanvasRenderingContext2D): void {
    this.flashes = this.flashes.filter((flash) => {
      flash.radius += (flash.maxRadius - flash.radius) * 0.3;
      flash.alpha *= 0.85;

      if (flash.alpha < 0.05) return false;

      ctx.globalAlpha = flash.alpha;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(flash.x, flash.y, flash.radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = `rgba(255, 200, 50, ${flash.alpha * 0.5})`;
      ctx.beginPath();
      ctx.arc(flash.x, flash.y, flash.radius * 0.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      return true;
    });
  }

  private drawSpeedLines(ctx: CanvasRenderingContext2D, player: PlayerState): void {
    if (player.speed < 4) return;

    const intensity = Math.min(1, (player.speed - 4) / 4);
    const numLines = Math.floor(3 + intensity * 5);

    ctx.globalAlpha = intensity * 0.4;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;

    const stats = CAR_ARCHETYPES[player.carType];
    const backX = player.x - Math.cos(player.angle) * stats.length * 0.5;
    const backY = player.y - Math.sin(player.angle) * stats.length * 0.5;

    for (let i = 0; i < numLines; i++) {
      const offset = (Math.random() - 0.5) * stats.width * 1.5;
      const perpX = -Math.sin(player.angle);
      const perpY = Math.cos(player.angle);

      const sx = backX + perpX * offset;
      const sy = backY + perpY * offset;
      const lineLen = 10 + intensity * 20 + Math.random() * 10;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(
        sx - Math.cos(player.angle) * lineLen,
        sy - Math.sin(player.angle) * lineLen
      );
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  private drawCar(ctx: CanvasRenderingContext2D, player: PlayerState, isLeader: boolean): void {
    const stats = CAR_ARCHETYPES[player.carType];
    const w = stats.width;
    const l = stats.length;

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);

    // Hit flash: white overlay
    if (player.hitFlash > 0) {
      const flashAlpha = player.hitFlash / 8;
      ctx.fillStyle = `rgba(255, 80, 80, ${flashAlpha * 0.6})`;
      ctx.fillRect(-l / 2 - 4, -w / 2 - 4, l + 8, w + 8);
    }

    if (player.carType === 'suv') {
      // SUV: beefy truck shape
      ctx.fillStyle = player.color;
      ctx.fillRect(-l / 2, -w / 2, l, w);

      ctx.fillStyle = this.darken(player.color, 0.3);
      ctx.fillRect(-l / 2 + 6, -w / 2 + 3, l - 20, w - 6);

      ctx.fillStyle = '#888';
      ctx.fillRect(l / 2 - 4, -w / 2 - 2, 6, w + 4);

      ctx.fillStyle = '#666';
      ctx.fillRect(-l / 2 - 2, -w / 2 + 2, 5, w - 4);

      ctx.fillStyle = '#ffffaa';
      ctx.fillRect(l / 2 - 6, -w / 2 + 2, 4, 5);
      ctx.fillRect(l / 2 - 6, w / 2 - 7, 4, 5);
    } else if (player.carType === 'fico') {
      // Fičo: tiny bubble car with very rounded shape
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, l / 2, w / 2, 0, 0, Math.PI * 2);
      ctx.fill();

      // Roof (darker ellipse)
      ctx.fillStyle = this.darken(player.color, 0.3);
      ctx.beginPath();
      ctx.ellipse(-2, 0, l * 0.25, w * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();

      // Round headlights
      ctx.fillStyle = '#ffffaa';
      ctx.beginPath();
      ctx.arc(l / 2 - 3, -w / 2 + 4, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(l / 2 - 3, w / 2 - 4, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Tiny tail lights
      ctx.fillStyle = '#ff3333';
      ctx.beginPath();
      ctx.arc(-l / 2 + 3, -w / 2 + 3, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-l / 2 + 3, w / 2 - 3, 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (player.carType === 'bulli') {
      // Bulli T1: boxy VW van with split windshield
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.moveTo(-l / 2 + 3, -w / 2);
      ctx.lineTo(l / 2 - 3, -w / 2);
      ctx.quadraticCurveTo(l / 2, -w / 2, l / 2, -w / 2 + 3);
      ctx.lineTo(l / 2, w / 2 - 3);
      ctx.quadraticCurveTo(l / 2, w / 2, l / 2 - 3, w / 2);
      ctx.lineTo(-l / 2 + 3, w / 2);
      ctx.quadraticCurveTo(-l / 2, w / 2, -l / 2, w / 2 - 3);
      ctx.lineTo(-l / 2, -w / 2 + 3);
      ctx.quadraticCurveTo(-l / 2, -w / 2, -l / 2 + 3, -w / 2);
      ctx.closePath();
      ctx.fill();

      // Two-tone: lower half darker
      ctx.fillStyle = this.darken(player.color, 0.25);
      ctx.fillRect(-l / 2 + 3, 0, l - 6, w / 2 - 1);
      ctx.fillRect(-l / 2 + 3, -w / 2 + 1, l - 6, -(-w / 2 + 1));

      // Split windshield
      ctx.fillStyle = 'rgba(150, 200, 255, 0.5)';
      ctx.fillRect(l / 2 - 10, -w / 2 + 3, 7, w / 2 - 4);
      ctx.fillRect(l / 2 - 10, 1, 7, w / 2 - 4);

      // Center divider
      ctx.fillStyle = player.color;
      ctx.fillRect(l / 2 - 10, -1, 7, 2);

      // VW logo circle on front
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(l / 2 - 2, 0, 4, 0, Math.PI * 2);
      ctx.stroke();

      // Big round headlights
      ctx.fillStyle = '#ffffaa';
      ctx.beginPath();
      ctx.arc(l / 2 - 1, -w / 2 + 5, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(l / 2 - 1, w / 2 - 5, 3, 0, Math.PI * 2);
      ctx.fill();

      // Tail lights
      ctx.fillStyle = '#ff3333';
      ctx.fillRect(-l / 2 + 1, -w / 2 + 2, 3, 5);
      ctx.fillRect(-l / 2 + 1, w / 2 - 7, 3, 5);
    } else {
      // Zastava: sleek small car
      ctx.fillStyle = player.color;

      ctx.beginPath();
      ctx.moveTo(-l / 2 + 4, -w / 2);
      ctx.lineTo(l / 2 - 6, -w / 2);
      ctx.quadraticCurveTo(l / 2, -w / 2, l / 2, -w / 2 + 4);
      ctx.lineTo(l / 2, w / 2 - 4);
      ctx.quadraticCurveTo(l / 2, w / 2, l / 2 - 6, w / 2);
      ctx.lineTo(-l / 2 + 4, w / 2);
      ctx.quadraticCurveTo(-l / 2, w / 2, -l / 2, w / 2 - 4);
      ctx.lineTo(-l / 2, -w / 2 + 4);
      ctx.quadraticCurveTo(-l / 2, -w / 2, -l / 2 + 4, -w / 2);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = this.darken(player.color, 0.4);
      ctx.fillRect(l / 2 - 14, -w / 2 + 3, 8, w - 6);

      ctx.fillStyle = '#ffffaa';
      ctx.beginPath();
      ctx.arc(l / 2 - 2, -w / 2 + 4, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(l / 2 - 2, w / 2 - 4, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ff3333';
      ctx.fillRect(-l / 2 + 1, -w / 2 + 1, 3, 4);
      ctx.fillRect(-l / 2 + 1, w / 2 - 5, 3, 4);
    }

    // Car outline
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-l / 2, -w / 2, l, w);

    // Emoji on the car (centered)
    ctx.font = `${Math.min(w - 4, 20)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(player.emoji, 0, 1);

    ctx.restore();

    // --- Stuff drawn in world space (not rotated) ---

    // Crown on leader
    if (isLeader) {
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('\u{1F451}', player.x, player.y - w / 2 - 18);
    }

    // Nickname above car
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(player.nickname, player.x, player.y - w / 2 - (isLeader ? 32 : 10));
    ctx.textBaseline = 'alphabetic';

    // Fuel bar under car
    this.drawFuelBar(ctx, player);

    // Combo indicator
    if (player.combo > 1) {
      ctx.fillStyle = '#f1c40f';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`x${player.combo}`, player.x, player.y + w / 2 + 22);
    }
  }

  private drawFuelBar(ctx: CanvasRenderingContext2D, player: PlayerState): void {
    const barWidth = 36;
    const barHeight = 4;
    const barX = player.x - barWidth / 2;
    const stats = CAR_ARCHETYPES[player.carType];
    const barY = player.y + stats.width / 2 + 6;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    const fillRatio = Math.min(1, player.fuel / 60);
    if (fillRatio > 0) {
      const green = fillRatio < 0.5 ? 255 : Math.floor(255 * (1 - fillRatio) * 2);
      const red = fillRatio > 0.5 ? 255 : Math.floor(255 * fillRatio * 2);
      ctx.fillStyle = `rgb(${red}, ${green}, 80)`;
      ctx.fillRect(barX, barY, barWidth * fillRatio, barHeight);
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(barX, barY, barWidth, barHeight);
  }

  private drawOffscreenArrows(ctx: CanvasRenderingContext2D, state: GameState, myId: string): void {
    const margin = 40;
    const arrowSize = 12;

    for (const player of state.players) {
      if (player.id === myId) continue;

      // Player position in screen space
      const sx = player.x - this.camX;
      const sy = player.y - this.camY;

      // Check if off-screen
      if (sx >= -20 && sx <= VIEWPORT_WIDTH + 20 && sy >= -20 && sy <= VIEWPORT_HEIGHT + 20) continue;

      // Clamp to viewport edge with margin
      const cx = VIEWPORT_WIDTH / 2;
      const cy = VIEWPORT_HEIGHT / 2;
      const dx = sx - cx;
      const dy = sy - cy;
      const angle = Math.atan2(dy, dx);

      // Find intersection with viewport edge
      let ax: number, ay: number;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      const halfW = VIEWPORT_WIDTH / 2 - margin;
      const halfH = VIEWPORT_HEIGHT / 2 - margin;

      if (absDx / halfW > absDy / halfH) {
        // Hits left or right edge
        ax = cx + Math.sign(dx) * halfW;
        ay = cy + dy * (halfW / absDx);
      } else {
        // Hits top or bottom edge
        ax = cx + dx * (halfH / absDy);
        ay = cy + Math.sign(dy) * halfH;
      }

      // Clamp ay/ax within viewport
      ax = Math.max(margin, Math.min(VIEWPORT_WIDTH - margin, ax));
      ay = Math.max(margin, Math.min(VIEWPORT_HEIGHT - margin, ay));

      // Draw arrow triangle pointing toward the player
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(angle);

      ctx.fillStyle = player.color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(arrowSize, 0);
      ctx.lineTo(-arrowSize * 0.6, -arrowSize * 0.7);
      ctx.lineTo(-arrowSize * 0.6, arrowSize * 0.7);
      ctx.closePath();
      ctx.fill();

      // Outline
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Emoji next to arrow
      ctx.rotate(-angle); // un-rotate for upright text
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(player.emoji, 0, -arrowSize - 6);

      ctx.restore();
    }
  }

  private drawHUD(ctx: CanvasRenderingContext2D, state: GameState, sorted: PlayerState[]): void {
    // Timer
    const timeStr = Math.ceil(state.timeRemaining).toString();
    const isUrgent = state.timeRemaining <= 10 && state.phase === 'playing';

    ctx.font = isUrgent ? 'bold 36px monospace' : 'bold 28px monospace';
    ctx.fillStyle = isUrgent ? '#e74c3c' : '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(timeStr, VIEWPORT_WIDTH / 2, 40);

    // Player scores (top-left)
    ctx.font = '14px monospace';
    ctx.textAlign = 'left';

    sorted.forEach((player, i) => {
      const y = 30 + i * 24;

      ctx.fillStyle = player.color;
      ctx.fillRect(10, y - 10, 14, 14);

      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(player.emoji, 17, y + 1);

      ctx.font = '14px monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      const text = `${player.nickname}: ${player.fuel.toFixed(1)}L`;
      ctx.fillText(text, 30, y);

      if (player.combo > 1) {
        const textW = ctx.measureText(text).width;
        ctx.fillStyle = '#f1c40f';
        ctx.fillText(` x${player.combo}`, 30 + textW, y);
      }

      if (player.inZone) {
        ctx.fillStyle = '#2ecc71';
        const fullW = ctx.measureText(text + (player.combo > 1 ? ` x${player.combo}` : '')).width;
        ctx.font = '12px sans-serif';
        ctx.fillText(' \u26FD', 30 + fullW, y);
      }
    });

    // Game over overlay
    if (state.phase === 'finished') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

      ctx.fillStyle = '#f1c40f';
      ctx.font = 'bold 48px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('GAME OVER', VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2 - 100);

      if (sorted.length > 0) {
        ctx.font = '24px sans-serif';
        ctx.fillText('\u{1F451}', VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2 - 60);

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 24px monospace';
        ctx.fillText(
          `${sorted[0].nickname} wins with ${sorted[0].fuel.toFixed(1)}L!`,
          VIEWPORT_WIDTH / 2,
          VIEWPORT_HEIGHT / 2 - 30
        );
      }

      // Awards
      if (state.awards && state.awards.length > 0) {
        const awardY = VIEWPORT_HEIGHT / 2 + 10;
        const awardIcons = ['\u{1F4A5}', '\u{1F3CE}\u{FE0F}', '\u26FA']; // explosion, race car, tent

        state.awards.forEach((award, i) => {
          const y = awardY + i * 28;
          const icon = awardIcons[i] || '\u{2B50}';

          ctx.fillStyle = '#f1c40f';
          ctx.font = 'bold 14px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(
            `${icon} ${award.title}: ${award.emoji} ${award.playerName} (${award.value})`,
            VIEWPORT_WIDTH / 2,
            y
          );
        });
      }

      if (state.restartIn !== undefined) {
        ctx.fillStyle = '#aaa';
        ctx.font = '18px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(
          `Next round in ${Math.ceil(state.restartIn)}...`,
          VIEWPORT_WIDTH / 2,
          VIEWPORT_HEIGHT / 2 + 110
        );
      }
    }

    if (state.phase === 'waiting') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

      ctx.fillStyle = '#f1c40f';
      ctx.font = 'bold 32px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for players...', VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2);
    }
  }

  private drawCountdown(ctx: CanvasRenderingContext2D, value: number): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

    const text = value > 0 ? value.toString() : 'GO!';
    const color = value > 0 ? '#fff' : '#2ecc71';
    const size = value > 0 ? 120 : 100;

    ctx.fillStyle = color;
    ctx.font = `bold ${size}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2);

    // Glow effect
    ctx.shadowColor = color;
    ctx.shadowBlur = 30;
    ctx.fillText(text, VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2);
    ctx.shadowBlur = 0;
    ctx.textBaseline = 'alphabetic';
  }

  private drawKillFeed(ctx: CanvasRenderingContext2D): void {
    ctx.textAlign = 'right';
    ctx.font = '12px monospace';

    this.killFeed.forEach((entry, i) => {
      const y = VIEWPORT_HEIGHT - 20 - i * 18;
      const alpha = Math.min(1, entry.ttl / 30);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = entry.color;
      ctx.fillText(entry.text, VIEWPORT_WIDTH - 10, y);
    });

    ctx.globalAlpha = 1;
  }

  private darken(hex: string, amount: number): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, ((num >> 16) & 0xff) * (1 - amount));
    const g = Math.max(0, ((num >> 8) & 0xff) * (1 - amount));
    const b = Math.max(0, (num & 0xff) * (1 - amount));
    return `rgb(${Math.floor(r)}, ${Math.floor(g)}, ${Math.floor(b)})`;
  }
}
