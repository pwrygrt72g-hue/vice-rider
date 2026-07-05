/* ================= UTILITAIRES PARTAGÉS ================= */

export const TWO_PI = Math.PI * 2;

/** smoothstep 0..1 (clampé) — même courbe que le smoothstep GLSL. */
export const smooth01 = x => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };

/** 0x-couleur -> '#rrggbb' (pour les swatches DOM). */
export function hex(c) { return '#' + c.toString(16).padStart(6, '0'); }
