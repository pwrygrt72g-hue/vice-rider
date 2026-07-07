/* ================= MER — vagues de Gerstner (côté CPU) =================
   Source de vérité de la SURFACE : waveHeight(x,z,t) est utilisée par la
   physique, le placement de tout ce qui flotte, et doit rester STRICTEMENT
   synchronisée avec le vertex shader de l'océan (mêmes vagues, même
   atténuation côtière — voir shaders dans main.js).

   Zone côtière : grand plateau calme (marina protégée) ; il faut prendre le
   large pour la houle, et encore plus loin pour les très grosses vagues. */
import { TWO_PI } from './util.js?v=45';

/** [dirX, dirZ, amplitude(raideur), longueur d'onde] — miroir GLSL uWaves[8]. */
export const WAVES = [
  [1.0, 0.12, 0.22, 62],
  [0.85, -0.28, 0.18, 44],
  [0.65, 0.60, 0.15, 33],
  [0.45, -0.85, 0.12, 26],
  [-0.30, 1.0, 0.10, 20],
  [1.0, 0.55, 0.08, 16.5],
  [0.20, 1.0, 0.06, 14],
  [-0.70, 0.55, 0.045, 12.5]
];

export const COAST_INNER = 130, COAST_OUTER = 640, COAST_CALM = 0.05;
export const OFFSHORE_START = 640, OFFSHORE_SPAN = 900, OFFSHORE_BOOST = 0.6;

/** Facteur d'agitation locale : ~0.05 à la côte, 1 au large, jusqu'à 1.6 très loin. */
export function seaFactor(x, z) {
  const d = Math.hypot(x, z);
  const t = Math.max(0, Math.min(1, (d - COAST_INNER) / (COAST_OUTER - COAST_INNER)));
  const s = t * t * (3 - 2 * t);
  let f = COAST_CALM + (1 - COAST_CALM) * s;
  // Au-delà du plateau, l'amplitude continue de grossir : grosses vagues au large.
  const far = Math.max(0, Math.min(1, (d - OFFSHORE_START) / OFFSHORE_SPAN));
  f += far * far * OFFSHORE_BOOST;
  return f;
}

/** Hauteur de la surface au point (x,z) à l'instant t — miroir exact du shader. */
export function waveHeight(x, z, t) {
  let y = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    const k = TWO_PI / w[3];
    const c = Math.sqrt(9.8 / k);
    const len = Math.hypot(w[0], w[1]);
    y += (w[2] / k) * Math.sin(k * ((w[0] / len) * x + (w[1] / len) * z - c * t));
  }
  return y * seaFactor(x, z);
}
