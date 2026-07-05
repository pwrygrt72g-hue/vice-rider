/* ================= GLSL PARTAGÉ + POST-PROCESS =================
   Fonctions shader utilisées par PLUSIEURS matériaux (ciel ET océan) : les
   garder ici garantit que le reflet dans l'eau correspond exactement au ciel
   affiché. Chaînes pures : aucune dépendance à three.js. */

/** Ciel procédural dégradé sunset (fallback quand le HDRI n'est pas chargé). */
export const SKY_FUNC = `
vec3 skyColor(vec3 dir, vec3 sd){
  float h = clamp(dir.y, -0.05, 1.0);
  vec3 zen = vec3(0.13, 0.17, 0.38);
  vec3 mid = vec3(0.40, 0.30, 0.50);
  vec3 hor = vec3(0.92, 0.55, 0.40);
  vec3 col = mix(mid, zen, smoothstep(0.10, 0.7, h));
  col = mix(hor, col, smoothstep(0.0, 0.20, h));
  vec2 fd = normalize(dir.xz); vec2 fs = normalize(sd.xz);
  float az = pow(max(dot(fd, fs), 0.0), 2.5);
  float horiz = 1.0 - smoothstep(0.0, 0.35, h);
  col += vec3(1.0, 0.35, 0.42) * az * horiz * 0.38;
  col += vec3(1.0, 0.62, 0.35) * pow(max(dot(dir, sd), 0.0), 6.0) * 0.28;
  return col;
}`;

/* Échantillonnage équirectangulaire partagé ciel/eau : garantit que le reflet
   dans l'eau correspond exactement au ciel photographique affiché.
   v = 0.5 - asin(y)/pi — cohérent avec l'orientation RGBELoader. */
export const ENV_FUNC = `
vec3 envSample(sampler2D tex, vec3 d, float rot){
  float cr = cos(rot), sr = sin(rot);
  vec3 q = vec3(d.x * cr - d.z * sr, d.y, d.x * sr + d.z * cr);
  float u = atan(q.z, q.x) * 0.15915494 + 0.5;
  float v = 0.5 - asin(clamp(q.y, -1.0, 1.0)) * 0.31830989;
  return texture2D(tex, vec2(u, v)).rgb;
}`;

/** Passe "caméra embarquée" : flou de vitesse radial + aberration chromatique +
    distorsion barrel (grand-angle GoPro) + éblouissement solaire + grain +
    vignette. uSpeed 0..1 (vitesse), uSun = position écran du soleil (xy en 0..1,
    z<0 si derrière), uWet 0..1 (objectif mouillé). */
export const FilmShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uSpeed: { value: 0 },
    uSun: { value: [0.5, 0.5, -1] }, uWet: { value: 0 }, uAspect: { value: 1.78 }
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `precision highp float;
varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uTime; uniform float uSpeed;
uniform vec3 uSun; uniform float uWet; uniform float uAspect;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 uv = vUv;
  vec2 toC = uv - 0.5;
  float r2 = dot(toC, toC);
  // 1) Distorsion barrel légère (grand-angle) : pousse les bords vers l'extérieur.
  float barrel = 1.0 + r2 * (0.08 + uSpeed * 0.10);
  vec2 duv = 0.5 + toC * barrel;
  // 2) Flou de vitesse RADIAL : on échantillonne le long du rayon (centre->bord),
  //    d'autant plus étalé qu'on va vite et qu'on est loin du centre.
  float edge = smoothstep(0.02, 0.5, r2);
  float blurAmt = uSpeed * edge * 0.055;
  vec3 col = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 6; i++) {
    float f = float(i) / 5.0;
    float w = 1.0 - f * 0.5;
    vec2 s = duv - toC * blurAmt * f;
    // 3) Aberration chromatique : décalage R/B croissant vers les bords + vitesse.
    float ca = (0.0016 + uSpeed * 0.0035) * (0.3 + edge);
    col.r += texture2D(tDiffuse, s + toC * ca).r * w;
    col.g += texture2D(tDiffuse, s).g * w;
    col.b += texture2D(tDiffuse, s - toC * ca).b * w;
    wsum += w;
  }
  col /= wsum;
  // 4) Éblouissement solaire : halo + stries quand le soleil est à l'écran.
  if (uSun.z > 0.0) {
    vec2 sp = uSun.xy; sp.x = (sp.x - 0.5) * uAspect + 0.5;
    vec2 pp = vec2((uv.x - 0.5) * uAspect + 0.5, uv.y);
    float ds = distance(pp, sp);
    float glow = exp(-ds * ds * 12.0);
    float streak = pow(max(0.0, 1.0 - abs((pp.x - sp.x)) * 8.0), 3.0) * exp(-abs(pp.y - sp.y) * 5.0);
    col += (vec3(1.0, 0.85, 0.6) * glow * 0.34 + vec3(1.0, 0.7, 0.5) * streak * 0.16) * smoothstep(0.0, 0.15, uSun.z);
    // Petits fantômes d'objectif le long de l'axe soleil-centre
    vec2 dir = (0.5 - sp);
    for (int k = 1; k <= 3; k++) {
      vec2 gp = sp + dir * (float(k) * 0.35);
      float gd = distance(pp, vec2((gp.x - 0.5), gp.y) + 0.5);
      col += vec3(0.6, 0.75, 1.0) * exp(-gd * gd * 60.0) * 0.12;
    }
  }
  // 5) Objectif mouillé : ondulation légère qui distord + éclat diffus.
  if (uWet > 0.01) {
    float w = sin(uv.y * 60.0 + uTime * 3.0) * sin(uv.x * 45.0 - uTime * 2.0);
    col += w * uWet * 0.022;
  }
  // 6) Grain argentique
  col += (hash(uv * vec2(1920.0, 1080.0) + mod(uTime, 10.0) * 60.0) - 0.5) * 0.032;
  // 7) Vignette
  col *= 1.0 - smoothstep(0.45, 0.95, sqrt(r2)) * (0.34 + uSpeed * 0.12);
  gl_FragColor = vec4(col, 1.0);
}` };
