import { create } from "zustand";
import { EARTH, MOON_DEF, BODIES, type BodyId, type Vec3, v3 } from "../physics/core";

export type Mode = "ORBIT" | "FIELD" | "PROBE" | "WEIGHT" | "MOON" | "WHATIF" | "MISSIONS" | "DATA";
export type CameraMode = "PLANET" | "ORBIT" | "FIELD" | "SURFACE" | "DEEP";
export type FieldVis = "LINES" | "VECTORS" | "HEAT" | "NUMERIC";

export interface WhatIfSnapshot {
  label: string;
  massMult: number;
  radiusMult: number;
  rotMult: number;
  hasMoon: boolean;
  moonMassMult: number;
  moonDistMult: number;
}

export interface MissionReport {
  mission: string;
  status: "COMPLETE" | "FAILED";
  detail: string;
  travelTime: number;
  maxAltKm: number;
  maxV: number;
  dV: number;
  finalEnergy: number;
  classification: string;
}

export interface NotebookEntry {
  id: number;
  title: string;
  objective: string;
  given: string;
  formula: string;
  calc: string;
  observation: string;
  conclusion: string;
  note: string;
  stamp: string;
}

interface AppState {
  mode: Mode;
  setMode: (m: Mode) => void;
  camera: CameraMode;
  setCamera: (c: CameraMode) => void;

  // planet
  massMult: number;
  radiusMult: number;
  rotMult: number;
  hasMoon: boolean;
  moonMassMult: number;
  moonDistMult: number;
  moonSpeedMult: number;
  focusBody: BodyId | "custom";
  customBody: { M: number; R: number; rotH: number };
  setPlanet: (p: Partial<Pick<AppState, "massMult" | "radiusMult" | "rotMult" | "hasMoon" | "moonMassMult" | "moonDistMult" | "moonSpeedMult" | "focusBody" | "customBody">>) => void;

  // interaction
  site: { lat: number; lon: number } | null;
  setSite: (s: { lat: number; lon: number } | null) => void;
  probe: Vec3; // scene units (Earth radii)
  setProbe: (p: Vec3) => void;
  highlight: string | null;
  setHighlight: (h: string | null) => void;

  // ui
  muted: boolean;
  setMuted: (b: boolean) => void;
  panelOpen: boolean;
  setPanelOpen: (b: boolean) => void;
  discovery: boolean;
  setDiscovery: (b: boolean) => void;
  showHelp: boolean;
  setShowHelp: (b: boolean) => void;
  atmosphere: boolean;
  setAtmosphere: (b: boolean) => void;
  dragModel: boolean;
  setDragModel: (b: boolean) => void;
  finalMoment: boolean;
  setFinalMoment: (b: boolean) => void;

  // field
  fieldVis: FieldVis;
  fieldDensity: number;
  fieldPlane: "OFF" | "XY" | "XZ" | "YZ";
  surfaceHeat: "OFF" | "SPHERE" | "ROTATING";
  setField: (f: Partial<Pick<AppState, "fieldVis" | "fieldDensity" | "fieldPlane" | "surfaceHeat">>) => void;

  // orbit sandbox
  altKm: number;
  speedKms: number;
  angleDeg: number;
  craftMass: number;
  trailLen: number;
  moonGrav: boolean;
  sunGrav: boolean;
  setOrbit: (o: Partial<Pick<AppState, "altKm" | "speedKms" | "angleDeg" | "craftMass" | "trailLen" | "moonGrav" | "sunGrav">>) => void;

  // weight / jump
  massKg: number;
  jumpV: number;
  setWeight: (w: Partial<Pick<AppState, "massKg" | "jumpV">>) => void;

  // missions / what-if / notebook
  activeMission: number | null;
  setActiveMission: (n: number | null) => void;
  lastReport: MissionReport | null;
  setLastReport: (r: MissionReport | null) => void;
  whatIf: { baseline: WhatIfSnapshot | null; altered: WhatIfSnapshot | null };
  setWhatIf: (w: Partial<AppState["whatIf"]>) => void;
  entries: NotebookEntry[];
  addEntry: (e: Omit<NotebookEntry, "id" | "stamp">) => void;
  setEntryNote: (id: number, note: string) => void;

  // expo
  expoStep: number; // -1 = off
  setExpoStep: (n: number) => void;

  // time (ui mirrors)
  speed: number;
  running: boolean;
  setSpeed: (n: number) => void;
  setRunning: (b: boolean) => void;
}

let entryId = 1;

export const useStore = create<AppState>((set) => ({
  mode: "ORBIT",
  setMode: (m) => set({ mode: m }),
  camera: "PLANET",
  setCamera: (c) => set({ camera: c }),

  massMult: 1,
  radiusMult: 1,
  rotMult: 1,
  hasMoon: true,
  moonMassMult: 1,
  moonDistMult: 1,
  moonSpeedMult: 1,
  focusBody: "earth",
  customBody: { M: 5.972e24, R: 6371, rotH: 23.934 },
  setPlanet: (p) => set(p),

  site: { lat: 28.5, lon: -80.6 },
  setSite: (s) => set({ site: s }),
  probe: v3(2.2, 0.4, 0),
  setProbe: (p) => set({ probe: p }),
  highlight: null,
  setHighlight: (h) => set({ highlight: h }),

  muted: false,
  setMuted: (b) => set({ muted: b }),
  panelOpen: true,
  setPanelOpen: (b) => set({ panelOpen: b }),
  discovery: false,
  setDiscovery: (b) => set({ discovery: b }),
  showHelp: false,
  setShowHelp: (b) => set({ showHelp: b }),
  atmosphere: true,
  setAtmosphere: (b) => set({ atmosphere: b }),
  dragModel: false,
  setDragModel: (b) => set({ dragModel: b }),
  finalMoment: false,
  setFinalMoment: (b) => set({ finalMoment: b }),

  fieldVis: "LINES",
  fieldDensity: 3,
  fieldPlane: "OFF",
  surfaceHeat: "OFF",
  setField: (f) => set(f),

  altKm: 400,
  speedKms: 7.67,
  angleDeg: 0,
  craftMass: 500,
  trailLen: 600,
  moonGrav: false,
  sunGrav: false,
  setOrbit: (o) => set(o),

  massKg: 70,
  jumpV: 3,
  setWeight: (w) => set(w),

  activeMission: null,
  setActiveMission: (n) => set({ activeMission: n }),
  lastReport: null,
  setLastReport: (r) => set({ lastReport: r }),
  whatIf: { baseline: null, altered: null },
  setWhatIf: (w) => set((s) => ({ whatIf: { ...s.whatIf, ...w } })),
  entries: [],
  addEntry: (e) =>
    set((s) => ({
      entries: [{ ...e, id: entryId++, stamp: `T+${Math.floor(performance.now() / 1000)}s` }, ...s.entries].slice(0, 30),
    })),
  setEntryNote: (id, note) => set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, note } : e)) })),

  expoStep: -1,
  setExpoStep: (n) => set({ expoStep: n }),

  speed: 60,
  running: true,
  setSpeed: (n) => set({ speed: n }),
  setRunning: (b) => set({ running: b }),
}));

/* ---------- derived planet accessors ---------- */
export function planetM(s: Pick<AppState, "focusBody" | "massMult" | "customBody">): number {
  if (s.focusBody === "custom") return s.customBody.M;
  return BODIES[s.focusBody].M * s.massMult;
}
export function planetR(s: Pick<AppState, "focusBody" | "radiusMult" | "customBody">): number {
  if (s.focusBody === "custom") return s.customBody.R * 1000;
  return BODIES[s.focusBody].R * s.radiusMult;
}
export function planetRotPeriod(s: Pick<AppState, "focusBody" | "rotMult" | "customBody">): number {
  const base = s.focusBody === "custom" ? s.customBody.rotH * 3600 : BODIES[s.focusBody].rotH * 3600;
  return base / s.rotMult;
}
export const moonM = (s: Pick<AppState, "moonMassMult">) => MOON_DEF.M * s.moonMassMult;
export const moonDist = (s: Pick<AppState, "moonDistMult">) => MOON_DEF.dist * s.moonDistMult;
export const earthRef = EARTH;
