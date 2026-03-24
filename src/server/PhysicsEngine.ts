import Matter from 'matter-js';
import { InputState, CarType, PlayerState, FuelPickup, CollisionEvent, SpillEvent } from '../shared/types';
import {
  MAP_WIDTH,
  MAP_HEIGHT,
  WALL_THICKNESS,
  CAR_ARCHETYPES,
  SLOVENIA_POLYGON,
  GAS_STATIONS,
  FUEL_MASS_FACTOR,
  TICK_MS,
  MAX_SPEED,
  SPILL_SPEED_THRESHOLD,
  SPILL_FUEL_BASE_PERCENT,
  SPILL_FUEL_MAX_PERCENT,
  SPILL_MIN_FUEL,
  PICKUP_LIFETIME,
  PICKUP_COLLECT_RADIUS,
  TICK_RATE,
  FUEL_DRAIN_PER_TICK,
  FUEL_DRAIN_MIN_SPEED,
  HIT_FLASH_TICKS,
  COMBO_TIERS,
} from '../shared/constants';

const { Engine, World, Bodies, Body, Vector, Events } = Matter;

interface CarEntry {
  body: Matter.Body;
  carType: CarType;
  fuel: number;
  nickname: string;
  emoji: string;
  color: string;
  hitFlash: number;
  comboSeconds: number; // seconds continuously in zone
}

let pickupIdCounter = 0;

export class PhysicsEngine {
  engine: Matter.Engine;
  private cars: Map<string, CarEntry> = new Map();
  private pickups: FuelPickup[] = [];
  private frameCollisions: CollisionEvent[] = [];
  private frameSpills: SpillEvent[] = [];

  constructor() {
    this.engine = Engine.create({
      gravity: { x: 0, y: 0 },
    });

    // Build Slovenia border walls from polygon edge segments
    // Each wall is offset outward so the inner face sits exactly on the polygon edge
    const wallOptions = { isStatic: true, restitution: 0.5, friction: 0.3, label: 'wall' };
    const walls: Matter.Body[] = [];

    for (let i = 0; i < SLOVENIA_POLYGON.length; i++) {
      const a = SLOVENIA_POLYGON[i];
      const b = SLOVENIA_POLYGON[(i + 1) % SLOVENIA_POLYGON.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);

      // Outward normal (pointing away from polygon interior)
      // For a clockwise polygon, the outward normal is (dy, -dx) normalized
      const nx = dy / length;
      const ny = -dx / length;

      // Offset wall center outward by half the thickness
      const mx = (a.x + b.x) / 2 + nx * (WALL_THICKNESS / 2);
      const my = (a.y + b.y) / 2 + ny * (WALL_THICKNESS / 2);

      walls.push(
        Bodies.rectangle(mx, my, length + WALL_THICKNESS, WALL_THICKNESS, {
          ...wallOptions,
          angle,
        })
      );
    }

    World.add(this.engine.world, walls);

    Events.on(this.engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        const labelA = pair.bodyA.label;
        const labelB = pair.bodyB.label;

        if (!labelA.startsWith('car_') || !labelB.startsWith('car_')) continue;

        const idA = labelA.replace('car_', '');
        const idB = labelB.replace('car_', '');
        const entryA = this.cars.get(idA);
        const entryB = this.cars.get(idB);
        if (!entryA || !entryB) continue;

        const relVx = entryA.body.velocity.x - entryB.body.velocity.x;
        const relVy = entryA.body.velocity.y - entryB.body.velocity.y;
        const relSpeed = Math.sqrt(relVx * relVx + relVy * relVy);

        const cx = (entryA.body.position.x + entryB.body.position.x) / 2;
        const cy = (entryA.body.position.y + entryB.body.position.y) / 2;
        const intensity = Math.min(1, relSpeed / (MAX_SPEED * 2));

        this.frameCollisions.push({ x: cx, y: cy, intensity });

        // Speed-based damage scaling
        if (relSpeed >= SPILL_SPEED_THRESHOLD) {
          const speedFraction = Math.min(1, (relSpeed - SPILL_SPEED_THRESHOLD) / (MAX_SPEED * 2 - SPILL_SPEED_THRESHOLD));
          const spillPercent = SPILL_FUEL_BASE_PERCENT + speedFraction * (SPILL_FUEL_MAX_PERCENT - SPILL_FUEL_BASE_PERCENT);

          const momA = Math.sqrt(entryA.body.velocity.x ** 2 + entryA.body.velocity.y ** 2) * entryA.body.mass;
          const momB = Math.sqrt(entryB.body.velocity.x ** 2 + entryB.body.velocity.y ** 2) * entryB.body.mass;

          const victimId = momA < momB ? idA : idB;
          const attackerId = momA < momB ? idB : idA;
          const victim = momA < momB ? entryA : entryB;
          const attacker = momA < momB ? entryB : entryA;

          if (victim.fuel >= SPILL_MIN_FUEL) {
            const spillAmount = victim.fuel * spillPercent;
            this.spillFuel(victimId, spillAmount, victim.body.position.x, victim.body.position.y);
            victim.hitFlash = HIT_FLASH_TICKS;

            // Reset victim's combo
            victim.comboSeconds = 0;

            this.frameSpills.push({
              attackerName: attacker.nickname,
              victimName: victim.nickname,
              amount: spillAmount,
            });
          }
        }
      }
    });
  }

  private spillFuel(id: string, amount: number, x: number, y: number): void {
    const entry = this.cars.get(id);
    if (!entry) return;

    entry.fuel -= amount;
    if (entry.fuel < 0) entry.fuel = 0;

    const stats = CAR_ARCHETYPES[entry.carType];
    Body.setMass(entry.body, stats.baseMass + entry.fuel * FUEL_MASS_FACTOR);

    const numPickups = 3 + Math.floor(Math.random() * 3);
    const perPickup = amount / numPickups;

    for (let i = 0; i < numPickups; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 30 + Math.random() * 50;
      let px = x + Math.cos(angle) * dist;
      let py = y + Math.sin(angle) * dist;

      // Clamp pickup inside the Slovenia polygon
      const clamped = this.clampToPolygon(px, py);
      px = clamped.x;
      py = clamped.y;

      this.pickups.push({
        id: `pickup_${++pickupIdCounter}`,
        x: px,
        y: py,
        amount: perPickup,
        ttl: PICKUP_LIFETIME,
      });
    }
  }

  addCar(id: string, carType: CarType, nickname: string, emoji: string, color: string): void {
    const stats = CAR_ARCHETYPES[carType];

    const spawn = this.getRandomSpawnPoint();

    const body = Bodies.rectangle(spawn.x, spawn.y, stats.length, stats.width, {
      mass: stats.baseMass,
      friction: stats.friction,
      frictionAir: stats.frictionAir,
      restitution: 0.6,
      angle: spawn.angle,
      label: `car_${id}`,
    });

    World.add(this.engine.world, body);

    this.cars.set(id, {
      body,
      carType,
      fuel: 0,
      nickname,
      emoji,
      color,
      hitFlash: 0,
      comboSeconds: 0,
    });
  }

  removeCar(id: string): void {
    const entry = this.cars.get(id);
    if (entry) {
      World.remove(this.engine.world, entry.body);
      this.cars.delete(id);
    }
  }

  applyInput(id: string, input: InputState): void {
    const entry = this.cars.get(id);
    if (!entry) return;

    const { body, carType } = entry;
    const stats = CAR_ARCHETYPES[carType];

    // Tank controls: rotation
    if (input.left) {
      Body.setAngularVelocity(body, -stats.maxTorque);
    } else if (input.right) {
      Body.setAngularVelocity(body, stats.maxTorque);
    } else {
      Body.setAngularVelocity(body, body.angularVelocity * 0.8);
    }

    if (input.forward) {
      const force = Vector.create(
        Math.cos(body.angle) * stats.maxForce,
        Math.sin(body.angle) * stats.maxForce
      );
      Body.applyForce(body, body.position, force);
    }
    if (input.backward) {
      const force = Vector.create(
        Math.cos(body.angle) * -stats.maxForce * 0.5,
        Math.sin(body.angle) * -stats.maxForce * 0.5
      );
      Body.applyForce(body, body.position, force);
    }
  }

  /** Apply drift physics — partially preserve lateral velocity for sliding feel */
  private applyDrift(): void {
    for (const [, entry] of this.cars) {
      const { body, carType } = entry;
      const stats = CAR_ARCHETYPES[carType];
      const speed = Math.sqrt(body.velocity.x ** 2 + body.velocity.y ** 2);
      if (speed < 0.5) continue;

      // Car's forward direction
      const forwardX = Math.cos(body.angle);
      const forwardY = Math.sin(body.angle);

      // Decompose velocity into forward and lateral components
      const forwardDot = body.velocity.x * forwardX + body.velocity.y * forwardY;
      const forwardVx = forwardX * forwardDot;
      const forwardVy = forwardY * forwardDot;
      const lateralVx = body.velocity.x - forwardVx;
      const lateralVy = body.velocity.y - forwardVy;

      // Keep forward velocity, dampen lateral velocity (drift factor controls how much lateral slides)
      Body.setVelocity(body, {
        x: forwardVx + lateralVx * stats.driftFactor,
        y: forwardVy + lateralVy * stats.driftFactor,
      });
    }
  }

  private enforceSpeedCap(): void {
    for (const [, entry] of this.cars) {
      const { body } = entry;
      const speed = Math.sqrt(body.velocity.x ** 2 + body.velocity.y ** 2);
      if (speed > MAX_SPEED) {
        const scale = MAX_SPEED / speed;
        Body.setVelocity(body, {
          x: body.velocity.x * scale,
          y: body.velocity.y * scale,
        });
      }
    }
  }

  private collectPickups(): void {
    for (const [, entry] of this.cars) {
      const cx = entry.body.position.x;
      const cy = entry.body.position.y;

      this.pickups = this.pickups.filter((pickup) => {
        const dx = cx - pickup.x;
        const dy = cy - pickup.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < PICKUP_COLLECT_RADIUS) {
          entry.fuel += pickup.amount;
          const stats = CAR_ARCHETYPES[entry.carType];
          Body.setMass(entry.body, stats.baseMass + entry.fuel * FUEL_MASS_FACTOR);
          return false;
        }
        return true;
      });
    }
  }

  private decayPickups(): void {
    const dt = 1 / TICK_RATE;
    this.pickups = this.pickups.filter((p) => {
      p.ttl -= dt;
      return p.ttl > 0;
    });
  }

  /** Drain fuel from cars driving outside the zone */
  drainFuelOutsideZone(): void {
    const occupants = new Set(this.getZoneOccupants());
    for (const [id, entry] of this.cars) {
      if (occupants.has(id)) continue; // in zone, no drain

      const speed = Math.sqrt(entry.body.velocity.x ** 2 + entry.body.velocity.y ** 2);
      if (speed < FUEL_DRAIN_MIN_SPEED) continue; // not moving
      if (entry.fuel <= 0) continue;

      entry.fuel = Math.max(0, entry.fuel - FUEL_DRAIN_PER_TICK);
      const stats = CAR_ARCHETYPES[entry.carType];
      Body.setMass(entry.body, stats.baseMass + entry.fuel * FUEL_MASS_FACTOR);
    }
  }

  /** Update combo counters for zone occupants */
  updateCombos(): void {
    const dt = 1 / TICK_RATE;
    const occupants = new Set(this.getZoneOccupants());
    for (const [id, entry] of this.cars) {
      if (occupants.has(id)) {
        entry.comboSeconds += dt;
      } else {
        entry.comboSeconds = 0;
      }
    }
  }

  /** Decay hit flash counters */
  private decayHitFlash(): void {
    for (const [, entry] of this.cars) {
      if (entry.hitFlash > 0) entry.hitFlash--;
    }
  }

  setFuel(id: string, fuel: number): void {
    const entry = this.cars.get(id);
    if (!entry) return;

    entry.fuel = fuel;
    const stats = CAR_ARCHETYPES[entry.carType];
    Body.setMass(entry.body, stats.baseMass + fuel * FUEL_MASS_FACTOR);
  }

  getFuel(id: string): number {
    return this.cars.get(id)?.fuel ?? 0;
  }

  getComboSeconds(id: string): number {
    return this.cars.get(id)?.comboSeconds ?? 0;
  }

  getZoneOccupants(): string[] {
    const occupants: string[] = [];
    for (const [id, entry] of this.cars) {
      for (const zone of GAS_STATIONS) {
        const dx = entry.body.position.x - zone.x;
        const dy = entry.body.position.y - zone.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < zone.radius) {
          occupants.push(id);
          break; // a car can only be in one zone at a time
        }
      }
    }
    return occupants;
  }

  step(): void {
    this.frameCollisions = [];
    this.frameSpills = [];
    Engine.update(this.engine, TICK_MS);
    this.applyDrift();
    this.enforceSpeedCap();
    this.collectPickups();
    this.decayPickups();
    this.decayHitFlash();
  }

  getCollisions(): CollisionEvent[] {
    return this.frameCollisions;
  }

  getSpills(): SpillEvent[] {
    return this.frameSpills;
  }

  getPickups(): FuelPickup[] {
    return [...this.pickups];
  }

  getPlayerStates(): PlayerState[] {
    const states: PlayerState[] = [];
    const occupants = new Set(this.getZoneOccupants());

    for (const [id, entry] of this.cars) {
      const speed = Math.sqrt(entry.body.velocity.x ** 2 + entry.body.velocity.y ** 2);

      // Calculate drift angle (angle between velocity and facing)
      let driftAngle = 0;
      if (speed > 0.5) {
        const velAngle = Math.atan2(entry.body.velocity.y, entry.body.velocity.x);
        driftAngle = entry.body.angle - velAngle;
        while (driftAngle > Math.PI) driftAngle -= Math.PI * 2;
        while (driftAngle < -Math.PI) driftAngle += Math.PI * 2;
      }

      // Calculate combo multiplier from comboSeconds
      let combo = 1;
      for (const tier of COMBO_TIERS) {
        if (entry.comboSeconds >= tier.seconds) combo = tier.multiplier;
      }

      states.push({
        id,
        x: entry.body.position.x,
        y: entry.body.position.y,
        angle: entry.body.angle,
        vx: entry.body.velocity.x,
        vy: entry.body.velocity.y,
        fuel: entry.fuel,
        carType: entry.carType,
        nickname: entry.nickname,
        emoji: entry.emoji,
        color: entry.color,
        inZone: occupants.has(id),
        combo,
        hitFlash: entry.hitFlash,
        speed,
        driftAngle,
      });
    }
    return states;
  }

  /** Ray-casting point-in-polygon test */
  private isInsidePolygon(px: number, py: number, polygon: { x: number; y: number }[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  /** Clamp a point to be inside the Slovenia polygon */
  private clampToPolygon(x: number, y: number): { x: number; y: number } {
    if (this.isInsidePolygon(x, y, SLOVENIA_POLYGON)) return { x, y };
    // Move toward polygon centroid until inside
    const cx = SLOVENIA_POLYGON.reduce((s, p) => s + p.x, 0) / SLOVENIA_POLYGON.length;
    const cy = SLOVENIA_POLYGON.reduce((s, p) => s + p.y, 0) / SLOVENIA_POLYGON.length;
    for (let t = 0.1; t <= 1; t += 0.1) {
      const nx = x + (cx - x) * t;
      const ny = y + (cy - y) * t;
      if (this.isInsidePolygon(nx, ny, SLOVENIA_POLYGON)) return { x: nx, y: ny };
    }
    return { x: cx, y: cy };
  }

  /** Find a random spawn point inside Slovenia but outside any gas station zone */
  private getRandomSpawnPoint(): { x: number; y: number; angle: number } {
    for (let attempt = 0; attempt < 100; attempt++) {
      const x = 80 + Math.random() * (MAP_WIDTH - 160);
      const y = 60 + Math.random() * (MAP_HEIGHT - 120);
      if (!this.isInsidePolygon(x, y, SLOVENIA_POLYGON)) continue;
      const inZone = GAS_STATIONS.some((z) => {
        const dx = x - z.x;
        const dy = y - z.y;
        return Math.sqrt(dx * dx + dy * dy) < z.radius + 80;
      });
      if (!inZone) {
        return { x, y, angle: Math.random() * Math.PI * 2 };
      }
    }
    // Fallback: center of the polygon
    const cx = SLOVENIA_POLYGON.reduce((s, p) => s + p.x, 0) / SLOVENIA_POLYGON.length;
    const cy = SLOVENIA_POLYGON.reduce((s, p) => s + p.y, 0) / SLOVENIA_POLYGON.length;
    return { x: cx, y: cy, angle: 0 };
  }

  getCarIds(): string[] {
    return Array.from(this.cars.keys());
  }

  reset(): void {
    for (const [, entry] of this.cars) {
      World.remove(this.engine.world, entry.body);
    }
    this.cars.clear();
    this.pickups = [];
    this.frameCollisions = [];
    this.frameSpills = [];
  }
}
