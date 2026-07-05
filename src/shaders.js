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

/** Grain argentique + vignette — dernière passe du composer (look cinéma 80s). */
export const FilmShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uTime;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  float g = (hash(vUv * vec2(1920.0, 1080.0) + mod(uTime, 10.0) * 60.0) - 0.5) * 0.035;
  c.rgb += g;
  float d = distance(vUv, vec2(0.5));
  c.rgb *= 1.0 - smoothstep(0.5, 0.95, d) * 0.32;
  gl_FragColor = c;
}` };
