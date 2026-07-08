/* ================= MER — vagues de Gerstner (côté CPU) =================
   Source de vérité de la SURFACE : waveHeight(x,z,t) est utilisée par la
   physique, le placement de tout ce qui flotte, et doit rester STRICTEMENT
   synchronisée avec le vertex shader de l'océan (mêmes vagues, même
   atténuation côtière — voir shaders dans main.js).

   v63 : waveHeight inverse désormais le DÉPLACEMENT HORIZONTAL de Gerstner
   (2 itérations de point fixe) au lieu de sommer des sinus verticaux : la
   hauteur retournée est celle de la surface RENDUE au-dessus de (x,z). Avant,
   au large (houle ~2 m d'amplitude), l'écart horizontal entre la vague
   physique et la vague affichée atteignait ~2 m -> les objets (et le jet)
   flottaient à côté de la crête visible.

   Zone côtière : grand plateau calme (marina protégée) ; il faut prendre le
   large pour la houle, et encore plus loin pour les très grosses vagues. */
import { TWO_PI } from './util.js?v=67';

/** [dirX, dirZ, amplitude(raideur), longueur d'onde] — miroir GLSL uWaves[8].
    v63 : houle dominante ADOUCIE et ALLONGÉE ([0] 0.22/62 -> 0.13/96,
    [1] 0.18 -> 0.12) : pente réduite de moitié -> le jet SURFE les faces au
    lieu d'être catapulté en balistique au-dessus des creux. */
/* v67 : RAIDEUR globale réduite ~15-20 % (les 2 houles longues dominantes
   0.13/0.12 -> 0.10) + boost du large 0.6 -> 0.35 : au large la houle passe de
   ~5.9 m à ~4.75 m crête-creux, le jet ski RIDE les vagues au lieu de s'y
   enterrer (retour joueur « il traverse l'eau, pas de rapport eau/jetski »). */
export const WAVES = [
  [1.0, 0.12, 0.10, 96],
  [0.85, -0.28, 0.10, 44],
  [0.65, 0.60, 0.13, 33],
  [0.45, -0.85, 0.11, 26],
  [-0.30, 1.0, 0.09, 20],
  [1.0, 0.55, 0.07, 16.5],
  [0.20, 1.0, 0.055, 14],
  [-0.70, 0.55, 0.04, 12.5]
];

export const COAST_INNER = 130, COAST_OUTER = 640, COAST_CALM = 0.05;
export const OFFSHORE_START = 640, OFFSHORE_SPAN = 900, OFFSHORE_BOOST = 0.35;

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

/* Constantes de vagues PRÉCALCULÉES (invariantes dans le temps) : évite de refaire
   k / c / normalize / sqrt à CHAQUE appel de waveHeight (appelé des dizaines de
   fois par frame). [k, c, ux, uz, amp] par vague. */
const N_WAVES = WAVES.length;
const WK = new Float64Array(N_WAVES), WC = new Float64Array(N_WAVES);
const WUX = new Float64Array(N_WAVES), WUZ = new Float64Array(N_WAVES), WA = new Float64Array(N_WAVES);
for (let i = 0; i < N_WAVES; i++) {
  const w = WAVES[i];
  const k = TWO_PI / w[3];
  const len = Math.hypot(w[0], w[1]);
  WK[i] = k; WC[i] = Math.sqrt(9.8 / k); WUX[i] = w[0] / len; WUZ[i] = w[1] / len; WA[i] = w[2] / k;
}

/** Déplacement Gerstner BRUT [dx, dy, dz] au point de grille (x,z) — miroir
    exact de la fonction gerstner() du vertex shader (avant facteur côtier). */
function waveDisp(x, z, t, out) {
  let dx = 0, dy = 0, dz = 0;
  for (let i = 0; i < N_WAVES; i++) {
    const ux = WUX[i], uz = WUZ[i], a = WA[i];
    const f = WK[i] * (ux * x + uz * z - WC[i] * t);
    const cf = Math.cos(f), sf = Math.sin(f);
    dx += ux * a * cf; dy += a * sf; dz += uz * a * cf;
  }
  out[0] = dx; out[1] = dy; out[2] = dz;
}

const _wd = [0, 0, 0];
/** Hauteur de la surface RENDUE au-dessus du point monde (x,z) à l'instant t.
    Inverse le déplacement horizontal de Gerstner par point fixe : on cherche le
    point de grille q tel que q + seaFactor(q)·dispXZ(q) = (x,z), puis on
    retourne seaFactor(q)·dispY(q) — exactement ce que le shader affiche. */
export function waveHeight(x, z, t) {
  let qx = x, qz = z;
  for (let i = 0; i < 2; i++) {
    waveDisp(qx, qz, t, _wd);
    const f = seaFactor(qx, qz);
    qx = x - _wd[0] * f; qz = z - _wd[2] * f;
  }
  waveDisp(qx, qz, t, _wd);
  return _wd[1] * seaFactor(qx, qz);
}
