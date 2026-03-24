import { CarType } from './types';

export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;

export const MAP_WIDTH = 3000;
export const MAP_HEIGHT = 2000;

// Viewport (canvas) size — camera follows the player within the larger map
export const VIEWPORT_WIDTH = 1200;
export const VIEWPORT_HEIGHT = 800;

// Slovenia-shaped playfield polygon (~75 vertices from Natural Earth + GADM data)
// Projected from real lat/lon, scaled to fit 3000x2000 map
// Traced clockwise from NW corner (Rateče / triple border)
export const SLOVENIA_POLYGON: { x: number; y: number }[] = [
  // NW corner – Rateče (Austrian/Italian triple border)
  { x: 453, y: 575 },
  // North – Karavanke ridge heading east
  { x: 563, y: 593 },
  { x: 645, y: 580 },
  { x: 728, y: 610 },
  { x: 810, y: 638 },
  { x: 893, y: 660 },
  { x: 975, y: 673 },
  { x: 1058, y: 683 },
  { x: 1140, y: 673 },
  { x: 1223, y: 678 },
  // Loibl Pass area
  { x: 1305, y: 638 },
  { x: 1388, y: 593 },
  { x: 1470, y: 540 },
  { x: 1553, y: 490 },
  { x: 1635, y: 423 },
  // Dravograd / Prevalje
  { x: 1760, y: 445 },
  { x: 1885, y: 468 },
  { x: 1968, y: 423 },
  { x: 2050, y: 400 },
  // Maribor north – Drava valley
  { x: 2133, y: 388 },
  { x: 2215, y: 383 },
  { x: 2298, y: 393 },
  { x: 2348, y: 393 },
  // Prekmurje – NE bulge
  { x: 2420, y: 355 },
  { x: 2463, y: 285 },
  { x: 2503, y: 208 },
  // Northernmost point
  { x: 2570, y: 185 },
  { x: 2643, y: 218 },
  // Eastern tip – Lendava descending
  { x: 2710, y: 355 },
  { x: 2768, y: 490 },
  { x: 2800, y: 598 },
  // SE border – Ormož, Ptuj area
  { x: 2710, y: 695 },
  { x: 2585, y: 750 },
  { x: 2463, y: 795 },
  { x: 2338, y: 843 },
  { x: 2215, y: 875 },
  { x: 2148, y: 898 },
  // Sotla river border
  { x: 2090, y: 955 },
  { x: 2075, y: 1058 },
  { x: 2090, y: 1170 },
  { x: 2090, y: 1283 },
  { x: 2065, y: 1358 },
  // Bregana / Zagreb border
  { x: 1968, y: 1398 },
  { x: 1885, y: 1425 },
  { x: 1803, y: 1470 },
  // Kolpa river
  { x: 1785, y: 1623 },
  { x: 1785, y: 1738 },
  { x: 1785, y: 1788 },
  // Metlika / Bela krajina
  { x: 1678, y: 1793 },
  { x: 1553, y: 1783 },
  { x: 1463, y: 1768 },
  // Kočevje area
  { x: 1348, y: 1738 },
  { x: 1265, y: 1680 },
  { x: 1183, y: 1583 },
  // Kolpa bend south
  { x: 1100, y: 1693 },
  { x: 1033, y: 1770 },
  // Osilnica / Babno Polje
  { x: 935, y: 1770 },
  { x: 810, y: 1765 },
  { x: 688, y: 1760 },
  // Snežnik area
  { x: 563, y: 1748 },
  { x: 455, y: 1738 },
  // Coastal area – Koper, Izola
  { x: 480, y: 1703 },
  { x: 563, y: 1675 },
  { x: 638, y: 1635 },
  // Karst edge / Sežana
  { x: 588, y: 1578 },
  { x: 523, y: 1510 },
  // Vipava valley
  { x: 480, y: 1398 },
  { x: 440, y: 1283 },
  // Soča valley / Tolmin
  { x: 440, y: 1148 },
  { x: 423, y: 1035 },
  { x: 398, y: 920 },
  { x: 440, y: 830 },
  // Triglav NP / Bovec
  { x: 398, y: 740 },
  { x: 423, y: 683 },
  { x: 455, y: 625 },
];

// Gas stations at real Slovenian cities
export interface GasStation {
  name: string;
  x: number;
  y: number;
  radius: number;
}

export const GAS_STATIONS: GasStation[] = [
  { name: 'Ljubljana', x: 1105, y: 1105, radius: 160 },
  { name: 'Celje', x: 1733, y: 903, radius: 135 },
  { name: 'Maribor', x: 2045, y: 543, radius: 135 },
  { name: 'Koper', x: 525, y: 1675, radius: 120 },
];

export const GAME_DURATION = 60; // seconds
export const COUNTDOWN_SECONDS = 3; // 3-2-1-GO

export const WALL_THICKNESS = 30;

// Car dimensions (in pixels)
export const CAR_WIDTH = 24;
export const CAR_LENGTH = 48;

// SUV is visually bigger
export const SUV_WIDTH = 30;
export const SUV_LENGTH = 56;

// Fuel gained per tick while in zone (base, before combo)
export const FUEL_PER_TICK = 0.5;

// How much fuel weight affects mass
export const FUEL_MASS_FACTOR = 0.03;

// Speed cap (scaled for larger map)
export const MAX_SPEED = 14;

// Collision fuel spill settings
export const SPILL_SPEED_THRESHOLD = 3;
export const SPILL_FUEL_BASE_PERCENT = 0.10; // base 10%, scales with speed
export const SPILL_FUEL_MAX_PERCENT = 0.30; // max 30% at max speed collision
export const SPILL_MIN_FUEL = 1;
export const PICKUP_RADIUS = 10;
export const PICKUP_LIFETIME = 10;
export const PICKUP_COLLECT_RADIUS = 40;

// Restart
export const RESTART_DELAY = 5;

// Drift: how much lateral velocity is preserved (0 = no drift, 1 = ice)
export const DRIFT_FACTOR_ZASTAVA = 0.92; // very drifty
export const DRIFT_FACTOR_SUV = 0.85; // less drifty but still slides

// Fuel drain while driving outside zone (per tick, only when moving)
export const FUEL_DRAIN_PER_TICK = 0.05;
export const FUEL_DRAIN_MIN_SPEED = 1; // must be moving this fast to drain

// Combo/streak: seconds in zone to reach each tier
export const COMBO_TIERS = [
  { seconds: 0, multiplier: 1 },
  { seconds: 3, multiplier: 1.5 },
  { seconds: 6, multiplier: 2 },
  { seconds: 10, multiplier: 2.5 },
];

// Hit flash duration in ticks
export const HIT_FLASH_TICKS = 8;

// Available emojis for car decoration
export const CAR_EMOJIS = [
  '\u{1F608}', // smiling imp
  '\u{1F47B}', // ghost
  '\u{1F480}', // skull
  '\u{1F525}', // fire
  '\u{26A1}',  // lightning
  '\u{2B50}',  // star
  '\u{1F4A3}', // bomb
  '\u{1F3CE}\u{FE0F}', // racing car
  '\u{1F6A8}', // police light
  '\u{1F344}', // mushroom
  '\u{1F355}', // pizza
  '\u{1F37A}', // beer
];

// Available car colors
export const CAR_COLORS = [
  '#e74c3c', // red
  '#3498db', // blue
  '#2ecc71', // green
  '#f39c12', // orange
  '#9b59b6', // purple
  '#1abc9c', // teal
  '#e91e63', // pink
  '#ff6b35', // deep orange
];

// Car archetype stats
export interface CarStats {
  baseMass: number;
  maxForce: number;
  maxTorque: number;
  friction: number;
  frictionAir: number;
  driftFactor: number;
  width: number;
  length: number;
  label: string;
}

export const CAR_ARCHETYPES: Record<CarType, CarStats> = {
  zastava: {
    baseMass: 1,
    maxForce: 0.004,
    maxTorque: 0.08,
    friction: 0.3,
    frictionAir: 0.04,
    driftFactor: DRIFT_FACTOR_ZASTAVA,
    width: CAR_WIDTH,
    length: CAR_LENGTH,
    label: 'Zastava',
  },
  suv: {
    baseMass: 2.5,
    maxForce: 0.0035,
    maxTorque: 0.05,
    friction: 0.4,
    frictionAir: 0.05,
    driftFactor: DRIFT_FACTOR_SUV,
    width: SUV_WIDTH,
    length: SUV_LENGTH,
    label: 'SUV',
  },
};
