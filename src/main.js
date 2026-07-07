import * as THREE from 'three';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../vendor/jsm/postprocessing/ShaderPass.js';
import { RGBELoader } from '../vendor/jsm/loaders/RGBELoader.js';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from '../vendor/jsm/loaders/DRACOLoader.js';
import { OBJLoader } from '../vendor/jsm/loaders/OBJLoader.js';
import { TWO_PI, smooth01, hex } from './util.js?v=57';
import { MODELS, JETSKIS, PILOTES, SUITS, QUALITIES } from './data.js?v=57';
import { WAVES, seaFactor, waveHeight } from './sea.js?v=57';
import { SKY_FUNC, ENV_FUNC, FilmShader } from './shaders.js?v=57';
import { TUNING } from './tuning.js?v=57';

// Témoin de version : si ce texte s'affiche en bas à droite, le NOUVEAU code tourne
// (sinon = cache navigateur -> recharge en navigation privée).
const BUILD = 'v57 · audio charnel (burble + sirène + doppler)';
console.info('[Vice Rider] BUILD', BUILD);
{ const _b = document.getElementById('build'); if (_b) _b.textContent = 'build ' + BUILD; }

const sel = { ski: 'rxpx', pilote: 'sonny', suit: 'rose', quality: 'moyen' };

/* ================= MÉTA-JEU : ÉCONOMIE + SAUVEGARDE =================
   Boucle addictive : ramasser des pièces en mer -> acheter jets/skins ->
   revenir plus fort. Sauvegarde locale (localStorage). Prix des jets dérivés
   de leur perf ; le RXP de départ est offert. */
const SAVE_KEY = 'viceRider.save.v2';
const DEFAULT_SAVE = { coins: 0, best: 0, ownedSkis: ['rxpx'], ownedSuits: ['rose', 'turquoise', 'blanc', 'noir'],
  lastDaily: 0, streak: 0, missions: null, missionDay: 0, totalRuns: 0, treasuresFound: 0 };
function loadSave() {
  try { return Object.assign({}, DEFAULT_SAVE, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); }
  catch (e) { return Object.assign({}, DEFAULT_SAVE); }
}
const save = loadSave();
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* quota/privé */ } }
const SKI_PRICES = { rxpx: 0, spark: 1200, gp: 2600, fx: 3400, gtx: 4200, ultra: 6000 };
function skiOwned(id) { return save.ownedSkis.includes(id); }
function updateCoinUI() {
  const a = document.getElementById('coin-bal'); if (a) a.textContent = save.coins.toLocaleString('fr-FR');
  const b = document.getElementById('game-coin-bal'); if (b) b.textContent = save.coins.toLocaleString('fr-FR');
}
function addCoins(n) { save.coins += n; persist(); updateCoinUI(); }

/* ================= MENU DOM ================= */
function makeCards(containerId, items, group, renderFn) {
  const el = document.getElementById(containerId);
  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card' + (group !== 'ski' ? ' small' : '') + (sel[group] === item.id ? ' sel' : '');
    card.dataset.group = group; card.dataset.value = item.id;
    card.innerHTML = renderFn(item);
    card.addEventListener('click', () => {
      sel[group] = item.id;
      // Désélectionne toutes les cartes du même group, même dans une autre section
      document.querySelectorAll('.card[data-group="' + group + '"]').forEach(c => c.classList.remove('sel'));
      card.classList.add('sel');
      if (group === 'ski' || group === 'pilote' || group === 'suit') rebuildSki();
    });
    el.appendChild(card);
  });
}
const cardTpl = m => `
  <div class="swatch"><div style="background:${hex(m.colors.hull)}"></div><div style="background:${hex(m.colors.deck)}"></div><div style="background:${hex(m.colors.accent)}"></div></div>
  <div class="brand">${m.brand}</div><div class="name">${m.name}</div>
  <div class="specs">${m.hp} ch · ${m.top} km/h<br>${m.weight} kg</div>`;
/* Cartes JET SKI avec verrouillage : possédé -> sélection ; verrouillé -> achat
   en pièces si le solde suffit, sinon déblocage par pub récompensée. */
function skiLockHtml(id) {
  return `<div class="lock"><div class="price">🪙 ${SKI_PRICES[id].toLocaleString('fr-FR')}</div><small>ACHETER · 🎬</small></div>`;
}
function refreshSkiCards() {
  document.querySelectorAll('#cards-ski .card').forEach(c => {
    const id = c.dataset.value, lk = c.querySelector('.lock');
    if (skiOwned(id) && lk) lk.remove();
    else if (!skiOwned(id) && !lk) c.insertAdjacentHTML('beforeend', skiLockHtml(id));
  });
}
function selectSki(id, card) {
  sel.ski = id;
  document.querySelectorAll('.card[data-group="ski"]').forEach(c => c.classList.remove('sel'));
  card.classList.add('sel');
  rebuildSki();
}
function onSkiCardClick(m, card) {
  if (skiOwned(m.id)) { selectSki(m.id, card); return; }
  const price = SKI_PRICES[m.id];
  if (save.coins >= price) {
    save.coins -= price; save.ownedSkis.push(m.id); persist(); updateCoinUI(); refreshSkiCards();
    selectSki(m.id, card); toast(`${m.name} débloqué !`);
  } else {
    // Pas assez de pièces -> pub pour débloquer tout de suite (fort hook).
    toast('Regarde une pub pour débloquer…');
    cgRewarded(() => {
      if (!skiOwned(m.id)) { save.ownedSkis.push(m.id); persist(); }
      refreshSkiCards(); selectSki(m.id, card); toast(`${m.name} débloqué !`);
    });
  }
}
(function buildSkiCards() {
  const host = document.getElementById('cards-ski');
  JETSKIS.forEach(m => {
    const card = document.createElement('div');
    card.className = 'card' + (sel.ski === m.id ? ' sel' : '');
    card.dataset.group = 'ski'; card.dataset.value = m.id;
    card.innerHTML = cardTpl(m) + (skiOwned(m.id) ? '' : skiLockHtml(m.id));
    card.addEventListener('click', () => onSkiCardClick(m, card));
    host.appendChild(card);
  });
})();
// (toast() est défini plus bas — réutilisé pour les messages méta.)
makeCards('cards-pilote', PILOTES, 'pilote', p => `
  <div class="dot" style="background:${hex(p.skin)}"></div><div class="name">${p.name}</div>`);
/* Cartes TENUES (mood Miami 80s) : mêmes règles d'achat que les jets. Les tenues
   à price 0 sont offertes ; les autres s'achètent en pièces ou se débloquent par pub. */
function suitOwned(id) { const s = SUITS.find(x => x.id === id); return (s && s.price === 0) || save.ownedSuits.includes(id); }
function suitCardTpl(s) {
  return `<div class="swatch"><div style="background:${hex(s.c)}"></div><div style="background:${hex(s.c2)}"></div></div>
  <div class="name">${s.name}</div>` + (s.price > 0 ? `<div class="price" style="margin-top:3px;">🪙 ${s.price.toLocaleString('fr-FR')}</div>` : '');
}
function suitLockHtml(s) { return `<div class="lock"><div class="price">🪙 ${s.price.toLocaleString('fr-FR')}</div><small>ACHETER · 🎬</small></div>`; }
function refreshSuitCards() {
  document.querySelectorAll('#cards-suit .card').forEach(c => {
    const id = c.dataset.value, s = SUITS.find(x => x.id === id), lk = c.querySelector('.lock');
    if (suitOwned(id) && lk) lk.remove();
    else if (!suitOwned(id) && !lk) c.insertAdjacentHTML('beforeend', suitLockHtml(s));
  });
}
function selectSuit(id, card) {
  sel.suit = id;
  document.querySelectorAll('.card[data-group="suit"]').forEach(c => c.classList.remove('sel'));
  card.classList.add('sel');
  rebuildSki();
}
function onSuitCardClick(s, card) {
  if (suitOwned(s.id)) { selectSuit(s.id, card); return; }
  if (save.coins >= s.price) {
    save.coins -= s.price; save.ownedSuits.push(s.id); persist(); updateCoinUI(); refreshSuitCards();
    selectSuit(s.id, card); toast(`${s.name} débloquée !`);
  } else {
    toast('Regarde une pub pour débloquer…');
    cgRewarded(() => {
      if (!suitOwned(s.id)) { save.ownedSuits.push(s.id); persist(); }
      refreshSuitCards(); selectSuit(s.id, card); toast(`${s.name} débloquée !`);
    });
  }
}
(function buildSuitCards() {
  const host = document.getElementById('cards-suit');
  SUITS.forEach(s => {
    const card = document.createElement('div');
    card.className = 'card small' + (sel.suit === s.id ? ' sel' : '');
    card.dataset.group = 'suit'; card.dataset.value = s.id;
    card.innerHTML = suitCardTpl(s) + (suitOwned(s.id) ? '' : suitLockHtml(s));
    card.addEventListener('click', () => onSuitCardClick(s, card));
    host.appendChild(card);
  });
})();
makeCards('cards-quality', QUALITIES, 'quality', q => `<div class="name">${q.name}</div>`);

/* ================= RENDU ================= */
const canvas = document.getElementById('sea');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
let pixelRatioCap = 1.5;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color(0xe0a58e);
scene.fog = new THREE.Fog(FOG_COLOR, 250, 1500);
const camera = new THREE.PerspectiveCamera(74, 1, 0.1, 9000);
scene.add(camera);

const sunDir = new THREE.Vector3(0.2, 0.14, -0.97).normalize();
const hemi = new THREE.HemisphereLight(0xc9a8c4, 0x1c2a4a, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffb070, 2.3);
sun.position.copy(sunDir).multiplyScalar(40);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -6; sun.shadow.camera.right = 6;
sun.shadow.camera.top = 6; sun.shadow.camera.bottom = -6;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 120;
sun.shadow.bias = -0.002;
scene.add(sun);
scene.add(sun.target);

/* Grade jour<->nuit partagé par le ciel, l'eau et l'ambiance (0 = plein jour,
   1 = crépuscule Miami où le néon prend le dessus). Basculé par setNight(). */
const uNight = { value: 0 };
// Intensité du COUCHER DE SOLEIL (0..1, pic au crépuscule) : superpose un dégradé
// orange->rose->violet + un gros soleil orange sur le ciel. Piloté par applyTOD.
const uSunset = { value: 0 };
// Overlay GLSL de coucher (attend `dir`, `sd`, `col`, `uSunset` dans le scope du shader).
const SUNSET_GLSL = `
  if (uSunset > 0.001) {
    float h = clamp(dir.y * 1.6, -0.2, 1.0);
    vec3 lowC = vec3(1.0, 0.45, 0.18);   // orange horizon
    vec3 midC = vec3(1.0, 0.30, 0.42);   // rose magenta
    vec3 hiC  = vec3(0.36, 0.18, 0.55);  // violet zénith
    vec3 grad = mix(lowC, midC, smoothstep(0.0, 0.28, h));
    grad = mix(grad, hiC, smoothstep(0.22, 0.75, h));
    float az = pow(clamp(sd, 0.0, 1.0), 0.6);
    float band = smoothstep(0.6, -0.05, abs(dir.y));
    float wgt = uSunset * (0.35 + 0.65 * az) * (0.4 + 0.6 * band);
    col = mix(col, grad, clamp(wgt, 0.0, 0.82));
    col += vec3(1.0, 0.55, 0.25) * smoothstep(0.9975, 0.99965, sd) * 2.4 * uSunset;  // disque solaire
    col += vec3(1.0, 0.45, 0.22) * pow(sd, 14.0) * 0.6 * uSunset;                    // halo large
  }`;

/* ================= CIEL ================= */
function makeSkyMaterial(graded) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSunDir: { value: sunDir }, uNight, uSunset },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `precision highp float; uniform vec3 uSunDir; uniform float uNight; uniform float uSunset; varying vec3 vDir;
${SKY_FUNC}
void main(){
  vec3 dir = normalize(vDir);
  vec3 col = skyColor(dir, uSunDir);
  float sd = max(dot(dir, uSunDir), 0.0);
  col += vec3(1.0, 0.72, 0.45) * smoothstep(0.9995, 0.99985, sd) * 1.5;
  col += vec3(1.0, 0.5, 0.35) * pow(sd, 80.0) * 0.3;
  // Crépuscule : assombrit et bleuit le ciel, ne garde qu'une braise près du soleil.
  vec3 night = col * vec3(0.14, 0.18, 0.32) + vec3(0.008, 0.010, 0.026);
  night += vec3(0.9, 0.4, 0.25) * pow(sd, 40.0) * 0.15;
  col = mix(col, night, uNight);
${SUNSET_GLSL}
  gl_FragColor = vec4(col, 1.0);
  ${graded ? '#include <tonemapping_fragment>\n#include <colorspace_fragment>' : ''}
}` });
}
const sky = new THREE.Mesh(new THREE.SphereGeometry(6500, 32, 16), makeSkyMaterial(true));
scene.add(sky);

// Environnement IBL : ciel procédural en attendant, remplacé par une vraie HDRI photo
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), makeSkyMaterial(false)));
scene.environment = pmrem.fromScene(envScene, 0.04).texture;
/* Ciel photographique : la HDRI devient le vrai ciel visible + le reflet de
   l'eau + l'éclairage IBL. On scanne l'image pour trouver le soleil, puis on
   fait tourner la sphère céleste pour le placer droit devant, et on aligne la
   lumière directionnelle, le brouillard et le glitter de l'eau dessus. */
new RGBELoader().setDataType(THREE.FloatType).load('./vendor/textures/sunset_puresky_1k.hdr', hdr => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  hdr.mapping = THREE.UVMapping;
  hdr.wrapS = THREE.RepeatWrapping;
  hdr.wrapT = THREE.ClampToEdgeWrapping;
  hdr.needsUpdate = true;

  // --- Scan du soleil : texel le plus lumineux de l'équirect ---
  const img = hdr.image, data = img.data, w = img.width, h = img.height;
  let best = -1, bi = 0;
  for (let i = 0; i < w * h; i++) {
    const L = data[i * 4] * 0.9 + data[i * 4 + 1] + data[i * 4 + 2] * 0.6;
    if (L > best) { best = L; bi = i; }
  }
  const su = ((bi % w) + 0.5) / w;
  const svRow = (Math.floor(bi / w) + 0.5) / h;
  // Convention d'échantillonnage du shader : v = 0.5 - asin(y)/pi
  const sunYtex = Math.sin((0.5 - svRow) * Math.PI);
  const chTex = Math.sqrt(Math.max(0, 1 - sunYtex * sunYtex));
  const phiTex = (su - 0.5) * TWO_PI;
  const qSun = new THREE.Vector3(Math.cos(phiTex) * chTex, sunYtex, Math.sin(phiTex) * chTex);
  // Rotation pour amener le soleil à l'azimut cible (devant, légèrement à droite)
  const azTarget = Math.atan2(-0.97, 0.2);
  const rot = Math.atan2(qSun.z, qSun.x) - azTarget;
  const sunElev = Math.max(0.06, Math.abs(qSun.y));
  const chW = Math.sqrt(Math.max(0, 1 - sunElev * sunElev));
  sunDir.set(Math.cos(azTarget) * chW, sunElev, Math.sin(azTarget) * chW).normalize();

  // --- Couleur de la lumière + brouillard échantillonnés dans la photo ---
  const px = (uu, vv) => {
    const xi = Math.min(w - 1, Math.max(0, Math.round(uu * w)));
    const yi = Math.min(h - 1, Math.max(0, Math.round(vv * h)));
    const k = (yi * w + xi) * 4;
    return [data[k], data[k + 1], data[k + 2]];
  };
  const sc = px(su, svRow);
  const sunCol = new THREE.Color(sc[0], sc[1], sc[2]);
  const m = Math.max(sunCol.r, sunCol.g, sunCol.b) || 1;
  sunCol.multiplyScalar(1 / m);
  sun.color.copy(sunCol).lerp(new THREE.Color(0xffffff), 0.25);
  let fr = 0, fg = 0, fb = 0, fn = 0;
  for (let k = 0; k < 32; k++) {
    const c = px(k / 32, 0.5);
    fr += c[0]; fg += c[1]; fb += c[2]; fn++;
  }
  const fogC = new THREE.Color(fr / fn, fg / fn, fb / fn);
  const fm = Math.max(fogC.r, fogC.g, fogC.b) || 1;
  fogC.multiplyScalar(0.85 / fm);
  FOG_COLOR.copy(fogC);
  scene.fog.color.copy(fogC);

  // --- La sphère céleste devient la photo (même formule que le reflet eau) ---
  sky.material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uEnvTex: { value: hdr }, uEnvRot: { value: rot }, uNight, uSunset, uSunDir: { value: sunDir } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `precision highp float;
uniform sampler2D uEnvTex; uniform float uEnvRot; uniform float uNight; uniform float uSunset; uniform vec3 uSunDir; varying vec3 vDir;
${ENV_FUNC}
void main(){
  vec3 dir = normalize(vDir);
  vec3 col = envSample(uEnvTex, dir, uEnvRot);
  // Crépuscule Miami : la photo sunset est assombrie/bleuie, une braise subsiste
  // à l'horizon côté soleil.
  float sd = max(dot(dir, uSunDir), 0.0);
  vec3 night = col * vec3(0.13, 0.17, 0.30) + vec3(0.010, 0.012, 0.030);
  night += vec3(0.85, 0.38, 0.24) * pow(sd, 22.0) * 0.20;
  col = mix(col, night, uNight);
${SUNSET_GLSL}
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}` });

  // --- L'eau reflète la même photo, avec la même rotation ---
  oceanUniforms.uEnvTex.value = hdr;
  oceanUniforms.uEnvRot.value = rot;
  oceanUniforms.uUseEnv.value = 1;
  console.info('[Vice Rider] Ciel HDR actif — soleil détecté à u=' + su.toFixed(3) + ' v=' + svRow.toFixed(3) + ', rot=' + rot.toFixed(2));
});

// Vraie texture de normales d'eau (photo, démos officielles Three.js)
const waterNormalTex = new THREE.TextureLoader().load('./vendor/textures/waternormals.jpg', t => {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
});
waterNormalTex.wrapS = waterNormalTex.wrapT = THREE.RepeatWrapping;

/* ================= OCÉAN ================= */
const waveUniform = WAVES.map(w => new THREE.Vector4(w[0], w[1], w[2], w[3]));
const oceanUniforms = {
  uTime: { value: 0 },
  uWaves: { value: waveUniform },
  uSunDir: { value: sunDir },
  uDeepColor: { value: new THREE.Color(0x0a6673) },
  uShallowColor: { value: new THREE.Color(0x30cabf) },
  uFogColor: { value: FOG_COLOR },
  uNormalMap: { value: waterNormalTex },
  uHullPos: { value: new THREE.Vector3(0, 0, 0) },
  uHullFwd: { value: new THREE.Vector3(0, 0, -1) },
  uHullSpeed: { value: 0 },
  uEnvTex: { value: new THREE.DataTexture(new Uint8Array([120, 120, 140, 255]), 1, 1) },
  uEnvRot: { value: 0 },
  uUseEnv: { value: 0 },
  uNight
};
oceanUniforms.uEnvTex.value.needsUpdate = true;
const oceanMaterial = new THREE.ShaderMaterial({
  uniforms: oceanUniforms,
  vertexShader: `
uniform float uTime; uniform vec4 uWaves[8];
uniform vec3 uHullPos; uniform vec3 uHullFwd; uniform float uHullSpeed;
varying vec3 vNormal; varying vec3 vWorldPos; varying float vHeight; varying float vHullPush; varying float vFold;
vec3 gerstner(vec4 w, vec3 wp, inout vec3 tangent, inout vec3 binormal){
  float k = 6.2831853 / w.w; float c = sqrt(9.8 / k); vec2 d = normalize(w.xy);
  float f = k * (dot(d, wp.xz) - c * uTime); float a = w.z / k;
  float sf = sin(f); float cf = cos(f);
  tangent += vec3(-d.x*d.x*w.z*sf, d.x*w.z*cf, -d.x*d.y*w.z*sf);
  binormal += vec3(-d.x*d.y*w.z*sf, d.y*w.z*cf, -d.y*d.y*w.z*sf);
  return vec3(d.x*a*cf, a*sf, d.y*a*cf);
}
void main(){
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 tangent = vec3(1.0, 0.0, 0.0); vec3 binormal = vec3(0.0, 0.0, 1.0);
  vec3 disp = vec3(0.0);
  for (int i = 0; i < 8; i++) { disp += gerstner(uWaves[i], wp, tangent, binormal); }
  float d0 = length(wp.xz);
  float coast = 0.05 + 0.95 * smoothstep(130.0, 640.0, d0);
  float far = clamp((d0 - 640.0) / 900.0, 0.0, 1.0);
  coast += far * far * 0.6; // grosses vagues au large (miroir de seaFactor)
  disp *= coast;
  // Les dérivées suivent la même atténuation côtière que le déplacement,
  // sinon normales et écume seraient fausses près du bord. (mix borné à 1)
  float cflat = min(coast, 1.0);
  tangent = mix(vec3(1.0, 0.0, 0.0), tangent, cflat);
  binormal = mix(vec3(0.0, 0.0, 1.0), binormal, cflat);
  // Jacobien : quand la surface se replie sur elle-même (crête qui déferle),
  // l'aire locale s'effondre -> critère physique des moutons d'écume.
  vFold = length(cross(tangent, binormal));
  // === Interaction coque/eau ===
  // LEÇON : la grille océan a ~8 m entre sommets -> toute déformation
  // GÉOMÉTRIQUE plus fine (cuvette 2 m, bourrelet 0.4 m) est irrésolvable
  // (l'ancien "cratère" venait d'un seul sommet tiré vers le bas puis
  // interpolé sur 16 m). On ne déplace la géométrie que pour la vague en V
  // de proue (échelle ~9 m, résolvable). Le contact fin coque/eau est rendu
  // par : (1) le halo d'eau churnée ci-dessous, calculé AU FRAGMENT
  // (per-pixel, indépendant de la grille), (2) un anneau d'écume mesh collé
  // à la ligne de flottaison côté JS.
  vec3 dHull = wp - uHullPos;
  vec2 fwd2 = normalize(uHullFwd.xz);
  vec2 rel = dHull.xz;
  float alongF = dot(rel, fwd2);
  float sideF = rel.x * fwd2.y - rel.y * fwd2.x;
  float eD = sqrt((alongF * alongF) / 4.84 + sideF * sideF);
  float speedK = min(uHullSpeed / 12.0, 1.0);
  float bowV = 0.0;
  if (uHullSpeed > 0.3) {
    float vShape = alongF * 0.55 - abs(sideF);
    bowV = smoothstep(0.0, 1.4, vShape) * smoothstep(3.5, 0.8, alongF) * min(uHullSpeed / 8.0, 1.0);
    bowV *= exp(-abs(sideF) * abs(sideF) / 9.0);
  }
  // (Le halo de contact coque/eau est calculé PAR PIXEL dans le fragment
  // shader — indépendant de la grille, donc petit et net, sans popping.)
  float hullPush = bowV * 0.32;   // vague de proue TRÈS discrète (plus de long trait devant)
  disp.y += hullPush;
  vec3 p = wp + disp;
  vNormal = normalize(cross(binormal, tangent));
  vWorldPos = p; vHeight = disp.y; vHullPush = bowV;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`,
  fragmentShader: `precision highp float;
uniform vec3 uSunDir; uniform vec3 uDeepColor; uniform vec3 uShallowColor; uniform vec3 uFogColor; uniform float uTime;
uniform sampler2D uNormalMap; uniform sampler2D uEnvTex; uniform float uEnvRot; uniform float uUseEnv; uniform float uNight;
uniform vec3 uHullPos; uniform vec3 uHullFwd; uniform float uHullSpeed;
varying vec3 vNormal; varying vec3 vWorldPos; varying float vHeight; varying float vHullPush; varying float vFold;
${SKY_FUNC}
${ENV_FUNC}
float noise2(vec2 p){ return sin(p.x) * sin(p.y); }
void main(){
  vec3 n = normalize(vNormal);
  vec3 nm1 = texture2D(uNormalMap, vWorldPos.xz * 0.09 + vec2(uTime * 0.035, uTime * 0.022)).xyz * 2.0 - 1.0;
  vec3 nm2 = texture2D(uNormalMap, vWorldPos.xz * 0.021 - vec2(uTime * 0.014, uTime * 0.019)).xyz * 2.0 - 1.0;
  vec3 nm3 = texture2D(uNormalMap, vWorldPos.xz * 0.27 + vec2(uTime * 0.06, -uTime * 0.05)).xyz * 2.0 - 1.0;
  float distN = length(cameraPosition - vWorldPos);
  float detailFade = 1.0 - smoothstep(40.0, 400.0, distN);
  n = normalize(n + vec3((nm1.x + nm2.x) * 0.28 + nm3.x * 0.14 * detailFade, 0.0, (nm1.y + nm2.y) * 0.28 + nm3.y * 0.14 * detailFade));
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 2.8);
  float hf = smoothstep(-2.5, 3.0, vHeight);
  vec3 base = mix(uDeepColor, uShallowColor, hf * 0.82);
  float sss = pow(max(dot(viewDir, -uSunDir), 0.0), 3.0) * smoothstep(0.5, 2.6, vHeight);
  base += vec3(0.10, 0.32, 0.32) * sss;
  vec3 rdir = reflect(-viewDir, n);
  rdir.y = max(rdir.y, 0.02);
  vec3 refl = uUseEnv > 0.5
    ? envSample(uEnvTex, normalize(rdir), uEnvRot)
    : skyColor(normalize(rdir), uSunDir);
  // Compression douce (knee Reinhard) des très hautes lumières du reflet :
  // empêche le ciel près du soleil de réfléchir en une NAPPE BLANCHE uniforme
  // à l'horizon. Les valeurs < 0.8 restent intactes (couleur sunset préservée),
  // seules les HDR brûlantes du disque solaire sont ramenées à ~1.
  refl /= (1.0 + max(vec3(0.0), refl - 0.7) * 1.15);
  vec3 col = mix(base, refl, 0.07 + fresnel * 0.42);
  float sunR = max(dot(rdir, uSunDir), 0.0);
  // --- SUN GLITTER : chemin scintillant du soleil sur l'eau ---
  // Champ de micro-facettes hautes fréquences (2 octaves animées) qui, contrairement
  // aux normales fines, ne s'estompe PAS au loin -> casse le reflet en une myriade
  // d'éclats au lieu d'un miroir plat. Seuil dur = points épars (vraie houle scintille
  // par petits triangles de vague face au soleil).
  vec2 gpos = vWorldPos.xz;
  float spark = noise2(gpos * 2.3 + uTime * 1.7) * noise2(gpos.yx * 2.9 - uTime * 1.3)
              + noise2(gpos * 5.3 - uTime * 2.1) * noise2(gpos.yx * 4.7 + uTime * 1.9);
  spark = spark * 0.5 + 0.5;                          // 0..1
  float glint = smoothstep(0.60, 0.97, spark);        // éclats épars
  float gfade = smoothstep(1500.0, 350.0, distN);     // atténue au loin (anti-alias)
  float glitter = glint * pow(sunR, 7.0) * gfade;
  // Disque adouci + halo serré + tapis de scintillement large. Le cœur du soleil
  // est volontairement moins intense/plus étalé (fini le point brûlant à l'horizon).
  col += vec3(1.0, 0.80, 0.56) * pow(sunR, 240.0) * 0.55;
  col += vec3(1.0, 0.62, 0.42) * pow(sunR, 48.0) * 0.26 * (0.35 + 0.65 * glint);
  col += vec3(1.0, 0.86, 0.62) * glitter * 1.35 * (1.0 - 0.5 * uNight);
  float steep = 1.0 - n.y;
  float mottling = 0.55 + 0.45 * noise2(vWorldPos.xz * 1.7 + uTime * 0.9) * noise2(vWorldPos.zx * 2.3 - uTime * 0.7);
  float crestFoam = smoothstep(1.4, 2.6, vHeight + (mottling - 0.5) * 1.4);
  float slopeFoam = smoothstep(0.16, 0.4, steep) * smoothstep(0.2, 1.4, vHeight);
  float jacFoam = smoothstep(0.72, 0.42, vFold) * (0.6 + 0.4 * mottling);
  float bowFoam = smoothstep(0.45, 0.95, vHullPush) * (0.7 + 0.3 * mottling);
  // Halo de contact coque/eau PER-PIXEL : petite ellipse d'eau churnée qui
  // épouse la coque (~1 m autour), bords rongés par le bruit. Précis quel que
  // soit le pas de la grille (contrairement à un calcul au sommet).
  vec2 relH = vWorldPos.xz - uHullPos.xz;
  vec2 fwdH = normalize(uHullFwd.xz);
  float alongH = dot(relH, fwdH);
  float sideH = relH.x * fwdH.y - relH.y * fwdH.x;
  float eDH = sqrt((alongH * alongH) / 4.84 + sideH * sideH);
  // Halo de contact TOUJOURS présent (la coque brasse l'eau même à l'arrêt) +
  // traînée d'écume qui s'évase derrière (sillage en trompette qui grandit avec
  // la vitesse). Rendu 100% par-pixel -> net quelle que soit la grille.
  float contact = exp(-eDH * eDH * 0.95) * (0.4 + 0.7 * min(uHullSpeed / 10.0, 1.0));
  // behind > 0 DERRIÈRE la coque, < 0 devant. Le sillage ne doit exister QUE
  // derrière : fenêtre qui monte depuis la coque (fondu dès la poupe) puis
  // s'estompe au loin. (BUG corrigé : avant, tous les pixels avant retombaient
  // à behind=0 et s'allumaient -> long trait blanc devant le jet.)
  float behind = -alongH;
  float trailWin = smoothstep(0.6, 4.0, behind) * smoothstep(34.0, 11.0, behind);
  float halfW = 0.9 + 0.16 * max(behind, 0.0);
  float wakeTrail = exp(-(sideH * sideH) / (halfW * halfW)) * trailWin * min(uHullSpeed / 5.0, 1.0);
  float hullFoam = (contact + wakeTrail * 1.1) * (0.6 + 0.4 * mottling);
  float foam = clamp(crestFoam * 0.6 + slopeFoam * 0.5 + jacFoam * 1.2 + bowFoam * 0.35 + hullFoam * 1.35, 0.0, 1.0) * (0.72 + 0.28 * mottling);
  col = mix(col, vec3(0.96, 0.92, 0.92) * (1.0 - 0.55 * uNight), foam * 0.9);
  // Crépuscule : eau sombre et bleu nuit (le scintillement + le néon des tours ressortent).
  col = mix(col, col * vec3(0.20, 0.30, 0.46) + vec3(0.004, 0.010, 0.020), uNight);
  float dist = length(cameraPosition - vWorldPos);
  col = mix(col, uFogColor, smoothstep(250.0, 1500.0, dist));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}` });
let ocean = null;
function buildOcean(segs) {
  if (ocean) { ocean.geometry.dispose(); scene.remove(ocean); }
  ocean = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200, segs, segs).rotateX(-Math.PI / 2), oceanMaterial);
  ocean.frustumCulled = false;
  scene.add(ocean);
}
buildOcean(384);

/* ================= DÉCOR — SKYLINE MIAMI 1986 =================
   Gratte-ciels au crépuscule : façade sombre + grille de fenêtres allumées
   (néon chaud / cyan / rose émissifs) pour qu'ils BRILLENT contre le ciel hazy
   au lieu d'être des boîtes noires. Teintes pastel Miami variées. */
const skyline = new THREE.Group();
// === SKYLINE MIAMI — formes AUTHORED (redans Art-Déco, couronnes néon, antennes)
// et pilotage JOUR/NUIT : le jour, façades en verre sombre (fenêtres à peine
// éclairées) ; la nuit, fenêtres + néons + reflets dans l'eau s'allument. On
// construit d'abord les FORMES, puis les matériaux, puis la lumière (méthode AAA).
// Facteurs d'intensité jour/nuit (le jeu démarre de jour) :
const WIN_DAY = 0.20, WIN_NIGHT = 2.5;      // émissif des fenêtres
const REFL_DAY = 0.08, REFL_NIGHT = 0.92;   // opacité des reflets néon sur l'eau
const towerWindowMats = [], neonTrims = [], beacons = [], towerReflections = [];
// Texture de façade : grille de fenêtres haute densité (lit à distance comme un
// scintillement de ville, pas un damier), mix chaud/froid, quelques étages sombres
// (mécaniques). Bakée une fois puis clonée par tour (repeat = densité).
const towerTex = (() => {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#0a0812'; g.fillRect(0, 0, 128, 256);
  const warm = ['#ffd39a', '#ffc07a', '#ffb060', '#fff2d8'];
  const cool = ['#8febff', '#35e0e0', '#9be8ff', '#bfefff'];
  const cols = 7, rows = 20, mx = 3, my = 3;
  const cw = (128 - mx * (cols + 1)) / cols, ch = (256 - my * (rows + 1)) / rows;
  const coolBias = Math.random();                 // chaque tour tire vers chaud OU froid
  for (let r = 0; r < rows; r++) {
    const darkFloor = Math.random() < 0.14;        // étage technique éteint
    for (let c = 0; c < cols; c++) {
      const x = mx + c * (cw + mx), y = my + r * (ch + my);
      if (!darkFloor && Math.random() < 0.5) {
        const pal = Math.random() < coolBias ? cool : warm;
        g.fillStyle = pal[(Math.random() * pal.length) | 0];
        g.globalAlpha = 0.72 + Math.random() * 0.28;
      } else { g.fillStyle = '#0a0812'; g.globalAlpha = 1; }
      g.fillRect(x, y, cw, ch);
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
// Corps en verre crépusculaire (slate/bleu nuit) : lisibles comme des tours le
// jour, sombres la nuit pour laisser les fenêtres émissives dominer.
const towerTints = [0x232a3d, 0x2a2438, 0x1f2a3a, 0x2d2740, 0x202a38];
const reflHues = [0xffb060, 0x9be8ff, 0xff6fa6, 0x8fe0ff, 0xffd08a];
// Traînée verticale douce pour les reflets néon dans l'eau.
const reflStreakTex = (() => {
  const cv = document.createElement('canvas'); cv.width = 32; cv.height = 128;
  const g = cv.getContext('2d');
  for (let y = 0; y < 128; y++) {
    const vy = Math.pow(1 - y / 128, 1.6);
    for (let x = 0; x < 32; x++) {
      const vx = 1 - Math.abs(x - 15.5) / 15.5;
      const a = Math.max(0, vy * vx * vx);
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const towerMat = (tint, w, h) => {
  const tex = towerTex.clone(); tex.needsUpdate = true;
  tex.repeat.set(Math.max(2, Math.round(w / 8)), Math.max(4, Math.round(h / 9)));
  const m = new THREE.MeshStandardMaterial({
    color: tint, map: tex, emissive: 0xffffff, emissiveMap: tex,
    emissiveIntensity: WIN_DAY, roughness: 0.5, metalness: 0.25
  });
  towerWindowMats.push(m);
  return m;
};
function makeTower(i) {
  const grp = new THREE.Group();
  const w = 24 + Math.random() * 46;
  const d = 18 + Math.random() * 22;
  const h = 52 + Math.random() * 135;
  const tint = towerTints[i % towerTints.length];
  const hue = reflHues[i % reflHues.length];
  // Corps principal
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), towerMat(tint, w, h));
  body.position.y = h / 2; grp.add(body);
  // Redans Art-Déco : 0 à 2 étages qui rétrécissent en montant (couronne étagée)
  let cy = h, cw = w, cd = d;
  const tiers = Math.random() < 0.62 ? (Math.random() < 0.4 ? 2 : 1) : 0;
  for (let s = 0; s < tiers; s++) {
    cw *= 0.66; cd *= 0.66;
    const th = h * (0.14 + Math.random() * 0.12);
    const tier = new THREE.Mesh(new THREE.BoxGeometry(cw, th, cd), towerMat(tint, cw, th));
    tier.position.y = cy + th / 2; grp.add(tier);
    cy += th;
  }
  // Bandeau néon de couronne (tube Art-Déco lumineux) — plus vif la nuit
  const trimMat = new THREE.MeshBasicMaterial({ color: hue, toneMapped: false });
  const trim = new THREE.Mesh(new THREE.BoxGeometry(cw * 1.03, 1.8, cd * 1.03), trimMat);
  trim.position.y = cy - 0.9; grp.add(trim);
  const cDay = new THREE.Color(hue).multiplyScalar(0.42);
  neonTrims.push({ mat: trimMat, day: cDay, night: new THREE.Color(hue) });
  trimMat.color.copy(cDay);
  // Antenne + feu d'aviation rouge clignotant (50%)
  if (Math.random() < 0.5) {
    const ah = 7 + Math.random() * 24;
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.1, ah, 6),
      new THREE.MeshStandardMaterial({ color: 0x1c2230, roughness: 0.6, metalness: 0.4 }));
    ant.position.y = cy + ah / 2; grp.add(ant);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false, transparent: true }));
    beacon.position.y = cy + ah + 1; grp.add(beacon);
    beacons.push(beacon);
  }
  const tx = 950 + Math.random() * 170;
  const tz = -440 + i * 58 + Math.random() * 22;
  grp.position.set(tx, 0, tz);
  skyline.add(grp);
  // Reflet néon sur l'eau (sprite additif, sommet à la ligne d'eau, étiré vers le bas)
  const refl = new THREE.Sprite(new THREE.SpriteMaterial({
    map: reflStreakTex, color: hue, blending: THREE.AdditiveBlending,
    transparent: true, depthTest: false, depthWrite: false, opacity: REFL_DAY
  }));
  const rh = h * 0.6, rw = w * 0.75;
  refl.scale.set(rw, rh, 1);
  refl.position.set(tx, -rh * 0.5 + 1.5, tz);
  refl.renderOrder = 3;
  skyline.add(refl);
  towerReflections.push(refl);
}
for (let i = 0; i < 18; i++) makeTower(i);
scene.add(skyline);

const palmIslands = [];
const sandMat = new THREE.MeshStandardMaterial({ color: 0xd4b488, roughness: 0.95 });
const wetSandMat = new THREE.MeshStandardMaterial({ color: 0xa88a62, roughness: 0.7 });
const grassMat = new THREE.MeshStandardMaterial({ color: 0x3f7a42, roughness: 0.9 });
const rockMat = new THREE.MeshStandardMaterial({ color: 0x6a6560, roughness: 0.85, flatShading: true });
const frondMat = new THREE.MeshStandardMaterial({ color: 0x2c6e35, roughness: 0.85, side: THREE.DoubleSide });
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5c3d, roughness: 0.9 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.9 });
const thatchMat = new THREE.MeshStandardMaterial({ color: 0xbf9450, roughness: 0.96, flatShading: true });
const coconutMat = new THREE.MeshStandardMaterial({ color: 0x54371f, roughness: 0.8 });
// Parasols Miami : nappe pastel + rayures (couleurs vives = accents de plage)
const parasolMats = [0xff5a7a, 0x2fd0e0, 0xffc23a, 0xff7a3a, 0xa06bff]
  .map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, side: THREE.DoubleSide }));

// Paillote tiki : 4 poteaux + plateforme + toit de chaume conique à deux niveaux
function makeTiki(parent, x, z) {
  const t = new THREE.Group();
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 2.3, 7), trunkMat);
    post.position.set(dx * 1.15, 1.15, dz * 1.15); post.castShadow = true; t.add(post);
  }
  const plat = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.16, 3.0), woodMat);
  plat.position.y = 2.3; t.add(plat);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.55, 1.5, 8), thatchMat);
  roof.position.y = 3.15; roof.castShadow = true; t.add(roof);
  const roof2 = new THREE.Mesh(new THREE.ConeGeometry(1.55, 1.0, 8), thatchMat);
  roof2.position.y = 3.95; t.add(roof2);
  t.position.set(x, 0, z); t.rotation.y = Math.random() * TWO_PI;
  parent.add(t);
}
// Parasol de plage : mât + nappe conique colorée
function makeParasol(parent, x, z) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 2.3, 6), woodMat);
  pole.position.set(x, 1.15, z); parent.add(pole);
  const top = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.72, 14), parasolMats[(Math.random() * parasolMats.length) | 0]);
  top.position.set(x, 2.35, z); top.castShadow = true; parent.add(top);
}

function makePalm(g, px, pz, h) {
  const lean = (Math.random() - 0.5) * 0.5;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(px, 0, pz),
    new THREE.Vector3(px + lean * h * 0.3, h * 0.5, pz + lean * h * 0.15),
    new THREE.Vector3(px + lean * h * 0.8, h, pz + lean * h * 0.4)
  ]);
  const trunk = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.14, 7), trunkMat);
  trunk.castShadow = true;
  g.add(trunk);
  const top = curve.getPoint(1);
  for (let f = 0; f < 7; f++) {
    const frond = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.7, 6, 1), frondMat);
    const pos = frond.geometry.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const fx = pos.getX(v);
      pos.setY(v, pos.getY(v) * (1 - Math.abs(fx) / 2.4) - fx * fx * 0.16);
    }
    frond.geometry.computeVertexNormals();
    frond.position.copy(top);
    frond.rotation.y = (f / 7) * TWO_PI + Math.random() * 0.4;
    frond.rotation.z = -0.25 - Math.random() * 0.2;
    frond.translateX(1.35);
    g.add(frond);
  }
  // Grappe de noix de coco sous la couronne (60% des palmiers)
  if (Math.random() < 0.6) {
    for (let n = 0; n < 3; n++) {
      const a = (n / 3) * TWO_PI;
      const nut = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), coconutMat);
      nut.position.copy(top).add(new THREE.Vector3(Math.cos(a) * 0.18, -0.22, Math.sin(a) * 0.18));
      g.add(nut);
    }
  }
}
function makeIsland(r) {
  const g = new THREE.Group();
  // Plage : sable mouillé au bord de l'eau puis sable sec en dôme
  const wet = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.45, 0.7, 28, 1), wetSandMat);
  wet.position.y = -0.05;
  g.add(wet);
  const beach = new THREE.Mesh(new THREE.SphereGeometry(r * 1.08, 28, 10, 0, TWO_PI, 0, Math.PI / 2), sandMat);
  beach.scale.set(1, 0.22, 1);
  beach.position.y = 0.15;
  beach.receiveShadow = true;
  g.add(beach);
  // Végétation centrale
  const mound = new THREE.Mesh(new THREE.SphereGeometry(r * 0.62, 22, 9, 0, TWO_PI, 0, Math.PI / 2), grassMat);
  mound.scale.set(1, 0.38, 1);
  mound.position.y = r * 0.06 + 0.3;
  g.add(mound);
  // Rochers sur la plage
  const rocks = 2 + Math.floor(Math.random() * 3);
  for (let k = 0; k < rocks; k++) {
    const ang = Math.random() * TWO_PI;
    const rr = 0.8 + Math.random() * 1.8;
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(rr, 1), rockMat);
    rock.position.set(Math.cos(ang) * r * 0.85, 0.3, Math.sin(ang) * r * 0.85);
    rock.scale.y = 0.55 + Math.random() * 0.3;
    rock.rotation.set(Math.random(), Math.random() * 3, Math.random());
    g.add(rock);
  }
  // Palmiers
  const palms = 3 + Math.floor(Math.random() * 4);
  for (let p = 0; p < palms; p++) {
    const ang = Math.random() * TWO_PI;
    const pr = r * (0.25 + Math.random() * 0.4);
    makePalm(g, Math.cos(ang) * pr, Math.sin(ang) * pr, 4.5 + Math.random() * 2.5);
  }
  // Paillote tiki (une île sur deux) au centre
  if (Math.random() < 0.55) makeTiki(g, (Math.random() - 0.5) * r * 0.5, (Math.random() - 0.5) * r * 0.5);
  // Parasols colorés sur le sable (accents Miami)
  const paras = 1 + Math.floor(Math.random() * 3);
  for (let p = 0; p < paras; p++) {
    const ang = Math.random() * TWO_PI, pr = r * (0.7 + Math.random() * 0.28);
    makeParasol(g, Math.cos(ang) * pr, Math.sin(ang) * pr);
  }
  scene.add(g);
  return g;
}
function makeDock(g, r) {
  const dock = new THREE.Group();
  const len = 9;
  for (let i = 0; i < 8; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 1.0), woodMat);
    plank.position.set(0, 0.75, -(r * 0.95 + 0.6 + i * 1.1));
    dock.add(plank);
  }
  for (const px of [-0.7, 0.7]) for (let i = 0; i < 4; i++) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.2, 8), woodMat);
    post.position.set(px, -0.2, -(r * 0.95 + 1 + i * 2.8));
    dock.add(post);
  }
  dock.rotation.y = Math.random() * TWO_PI;
  g.add(dock);
}
for (let i = 0; i < 7; i++) {
  const r = 16 + Math.random() * 26;
  const ang = (i / 7) * TWO_PI + Math.random();
  const dist = 240 + Math.random() * 380;
  const g = makeIsland(r);
  if (i === 0 || i === 3) makeDock(g, r);
  g.position.set(Math.cos(ang) * dist, 0, Math.sin(ang) * dist);
  palmIslands.push({ g, r });
}

/* ================= FRONT DE MER SOUTH BEACH =================
   Devant la skyline : une vraie plage (sable + écume), une promenade type Ocean
   Drive, un strip de bâtiments Art-Déco PASTEL bas (devant les tours) + palmiers
   et parasols. Ajouté au groupe `skyline` -> recyclé avec lui pour rester à
   l'horizon face au joueur. Donne le mood Miami depuis l'eau. */
(function buildBeachfront() {
  const zC = 55, zLen = 1120;
  // Sable clair et LARGE, surélevé pour bien dépasser des vagues même au large.
  const beachSand = new THREE.MeshStandardMaterial({ color: 0xe9d7ab, roughness: 0.96 });
  const beachWet = new THREE.MeshStandardMaterial({ color: 0xc3a878, roughness: 0.72 });
  const sand = new THREE.Mesh(new THREE.BoxGeometry(150, 4.6, zLen), beachSand);
  sand.position.set(892, 1.2, zC); sand.receiveShadow = true; skyline.add(sand);
  const wet = new THREE.Mesh(new THREE.BoxGeometry(46, 3.6, zLen), beachWet);
  wet.position.set(816, 0.7, zC); skyline.add(wet);
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(16, zLen).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
  foam.position.set(795, 2.1, zC); skyline.add(foam);
  const prom = new THREE.Mesh(new THREE.BoxGeometry(14, 4.0, zLen),
    new THREE.MeshStandardMaterial({ color: 0xd6cdbb, roughness: 0.92 }));
  prom.position.set(930, 1.1, zC); skyline.add(prom);

  // Strip Art-Déco pastel (bâtiments BAS, devant les tours) — palette South Beach.
  const pastel = [[0xf7b3c6, 0xffffff], [0x9fe4d6, 0xfff2c4], [0xffd39a, 0xff9ec2],
    [0xbfe0ff, 0xffffff], [0xe6d4ff, 0x9fe4d6], [0xfff0b8, 0xff9ec2]];
  for (let i = 0; i < 15; i++) {
    const [c, c2] = pastel[i % pastel.length];
    const w = 40 + Math.random() * 26, h = 11 + Math.random() * 17, d = 22 + Math.random() * 12;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.05 }));
    body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true; g.add(body);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 1.03, 1.3, d * 1.03),
      new THREE.MeshStandardMaterial({ color: 0xf6f2ea, roughness: 0.7 }));
    cap.position.y = h + 0.65; g.add(cap);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(6, h * 0.5, d * 0.55),
      new THREE.MeshStandardMaterial({ color: 0xf6f2ea, roughness: 0.7 }));
    fin.position.y = h + h * 0.25; g.add(fin);
    // Bandes néon pastel (2 lignes Art-Déco) -> s'allument la nuit via setNight.
    for (let b = 0; b < 2; b++) {
      const trimMat = new THREE.MeshBasicMaterial({ color: c2, toneMapped: false });
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w * 1.015, 0.5, d * 1.015), trimMat);
      trim.position.y = h * (0.4 + b * 0.32); g.add(trim);
      const dayC = new THREE.Color(c2).multiplyScalar(0.5); trimMat.color.copy(dayC);
      neonTrims.push({ mat: trimMat, day: dayC, night: new THREE.Color(c2) });
    }
    g.position.set(918 + Math.random() * 8, 2.9, -480 + i * (zLen / 15) + Math.random() * 18);
    skyline.add(g);
  }

  // Palmiers le long de la promenade + parasols sur le sable (groupe surélevé au niveau du sable).
  const props = new THREE.Group(); props.position.y = 3.3; skyline.add(props);
  for (let i = 0; i < 30; i++) {
    const pz = -480 + i * (zLen / 30) + (Math.random() - 0.5) * 10;
    makePalm(props, 900 + Math.random() * 6, pz, 6.5 + Math.random() * 3.5);
    if (i % 2 === 0) makeParasol(props, 858 + Math.random() * 12, pz + 9);
  }
})();

/* ---- Rochers isolés en pleine mer (obstacles) ---- */
const seaRocks = [];
for (let i = 0; i < 6; i++) {
  const rr = 1.6 + Math.random() * 3;
  const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(rr, 1), rockMat);
  rock.scale.y = 0.6 + Math.random() * 0.4;
  rock.rotation.set(Math.random(), Math.random() * 3, Math.random());
  rock.position.set((Math.random() - 0.5) * 700, 0.2, -100 - Math.random() * 600);
  scene.add(rock);
  seaRocks.push({ m: rock, r: rr });
}

/* ================= VIE : MOUETTES ================= */
const gullMat = new THREE.MeshBasicMaterial({ color: 0x2a2530, side: THREE.DoubleSide });
const gullFlocks = [];
for (let f = 0; f < 3; f++) {
  const flock = { anchor: new THREE.Vector3((Math.random() - 0.5) * 500, 10 + Math.random() * 10, -150 - Math.random() * 400), birds: [], phase: Math.random() * TWO_PI, radius: 18 + Math.random() * 22 };
  for (let b = 0; b < 5; b++) {
    const bird = new THREE.Group();
    const wingGeo = new THREE.PlaneGeometry(0.9, 0.28);
    const wl = new THREE.Mesh(wingGeo, gullMat);
    wl.position.x = -0.42;
    const wr = new THREE.Mesh(wingGeo, gullMat);
    wr.position.x = 0.42;
    bird.add(wl, wr);
    bird.userData = { wl, wr, off: Math.random() * TWO_PI, r: 2 + Math.random() * 5, h: (Math.random() - 0.5) * 3 };
    bird.visible = false; // masqué tant qu'on n'est pas en jeu (sinon empilé à l'origine)
    scene.add(bird);
    flock.birds.push(bird);
  }
  gullFlocks.push(flock);
}
function updateGulls(dt, t) {
  for (const fl of gullFlocks) {
    fl.phase += dt * 0.22;
    const d = Math.hypot(fl.anchor.x - state.x, fl.anchor.z - state.z);
    if (d > 900) {
      const ang = Math.random() * TWO_PI;
      fl.anchor.set(state.x + Math.cos(ang) * (250 + Math.random() * 250), 9 + Math.random() * 12, state.z + Math.sin(ang) * (250 + Math.random() * 250));
    }
    for (const bird of fl.birds) {
      const u = bird.userData;
      const a = fl.phase + u.off;
      bird.position.set(
        fl.anchor.x + Math.cos(a) * (fl.radius + u.r),
        fl.anchor.y + u.h + Math.sin(t * 0.7 + u.off) * 1.2,
        fl.anchor.z + Math.sin(a) * (fl.radius + u.r)
      );
      bird.rotation.y = -a - Math.PI / 2;
      const flap = Math.sin(t * 7 + u.off * 3) * 0.55;
      u.wl.rotation.y = 0.25 + flap;
      u.wr.rotation.y = -0.25 - flap;
    }
  }
}

/* ================= VIE : POISSONS QUI SAUTENT ================= */
const fishPool = [];
const FISH_COLORS = [0x8fa6ba, 0xa9bcc9, 0x6f97a8, 0xc7b48a];
function buildFish(col) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.3, metalness: 0.5, envMapIntensity: 0.9 });
  const bellyMat = new THREE.MeshStandardMaterial({ color: 0xeef4f7, roughness: 0.35, metalness: 0.3 });
  // Corps fuselé, allongé sur +Z (le nez pointe en +Z local)
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 12), bodyMat);
  body.scale.set(0.42, 0.52, 1.0); body.castShadow = true; g.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), bellyMat);
  belly.scale.set(0.40, 0.30, 0.92); belly.position.y = -0.035; g.add(belly);
  // Caudale (queue) en éventail
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.2, 4), bodyMat);
  tail.rotation.x = Math.PI / 2; tail.position.z = -0.24; tail.scale.set(1, 0.35, 1); g.add(tail);
  // Dorsale
  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.13, 3), bodyMat);
  dorsal.position.set(0, 0.11, -0.02); g.add(dorsal);
  // Pectorales
  for (const s of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.11, 3), bodyMat);
    fin.rotation.set(0, 0, s * 1.1); fin.position.set(s * 0.06, -0.01, 0.06); g.add(fin);
  }
  return g;
}
function initFish() {
  for (let i = 0; i < 6; i++) {
    const g = buildFish(FISH_COLORS[i % FISH_COLORS.length]);
    g.visible = false;
    scene.add(g);
    fishPool.push({ g, active: false, t: 0, dur: 0, x: 0, z: 0, vx: 0, vz: 0, vy: 0, y0: 0, next: Math.random() * 4 });
  }
}
function updateFish(dt, t) {
  for (const f of fishPool) {
    if (!f.active) {
      if (mode !== 'ride') continue;
      f.next -= dt;
      if (f.next > 0) continue;
      // Émerge à distance moyenne du joueur, saut balistique dans une direction libre
      const ang = Math.random() * TWO_PI;
      const dist = 22 + Math.random() * 75;
      f.x = state.x + Math.cos(ang) * dist;
      f.z = state.z + Math.sin(ang) * dist;
      f.y0 = waveHeight(f.x, f.z, t);
      const jang = Math.random() * TWO_PI, hspd = 1.0 + Math.random() * 2.0;
      f.vx = Math.cos(jang) * hspd; f.vz = Math.sin(jang) * hspd;
      f.vy = 3.4 + Math.random() * 2.4;
      f.t = 0; f.dur = (2 * f.vy) / 9.8;
      f.active = true; f.g.visible = true;
      spawnRing(f.x, f.y0, f.z, 0.9);
      continue;
    }
    f.t += dt;
    const vy = f.vy - 9.8 * f.t;
    const y = f.y0 + f.vy * f.t - 4.9 * f.t * f.t;
    f.x += f.vx * dt; f.z += f.vz * dt;
    f.g.position.set(f.x, y, f.z);
    // Oriente le corps le long de la trajectoire (nez +Z) + frétillement
    f.g.rotation.y = Math.atan2(f.vx, f.vz);
    f.g.rotation.x = -Math.atan2(vy, Math.hypot(f.vx, f.vz) || 0.001);
    f.g.rotation.z = Math.sin(f.t * 32) * 0.22;
    if (f.t > f.dur * 0.45 && y <= waveHeight(f.x, f.z, t)) {
      f.active = false; f.g.visible = false;
      f.next = 1.6 + Math.random() * 5;
      spawnRing(f.x, waveHeight(f.x, f.z, t), f.z, 1.1);
    }
  }
}

/* ================= VIE : YACHTS DE MIAMI (ambiance, non pilotables) ================= */
const ambientYachts = [];
function buildYacht() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xeef1f1, roughness: 0.33, metalness: 0.05 });
  const teak = new THREE.MeshStandardMaterial({ color: 0x9c6a3c, roughness: 0.6 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x123a58, roughness: 0.4 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x14222c, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.55, clearcoat: 1 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd0d6da, metalness: 0.9, roughness: 0.25 });
  const W = 2.1, L = 7.0;
  // Coque : proue pointue (shape-Y = -L) -> bow au -Z du modèle après rotateX
  const s = new THREE.Shape();
  s.moveTo(0, -L);
  s.quadraticCurveTo(W * 0.75, -L * 0.6, W, -L * 0.1);
  s.lineTo(W, L * 0.85); s.lineTo(-W, L * 0.85);
  s.lineTo(-W, -L * 0.1);
  s.quadraticCurveTo(-W * 0.75, -L * 0.6, 0, -L);
  const hullGeo = new THREE.ExtrudeGeometry(s, { depth: 1.5, bevelEnabled: true, bevelThickness: 0.22, bevelSize: 0.2, bevelSegments: 3, curveSegments: 22 });
  hullGeo.rotateX(Math.PI / 2); hullGeo.translate(0, 1.5, 0);
  const hull = new THREE.Mesh(hullGeo, white); hull.castShadow = true; g.add(hull);
  // Bande de flottaison bleue
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(W * 2.06, 0.24, L * 1.85), blue);
  stripe.position.set(0, 0.75, 0.2); g.add(stripe);
  // Pont teck + plage arrière
  const deck = new THREE.Mesh(new THREE.BoxGeometry(W * 1.85, 0.12, L * 1.6), teak);
  deck.position.set(0, 1.52, 0.4); g.add(deck);
  // Superstructure (cabine) vers l'arrière + pare-brise incliné + fenêtres
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 1.5, 1.15, L * 0.85), white);
  cabin.position.set(0, 2.15, L * 0.18); cabin.castShadow = true; g.add(cabin);
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(W * 1.44, 0.62, 0.12), glass);
  windshield.position.set(0, 2.45, L * 0.18 - L * 0.42); windshield.rotation.x = 0.5; g.add(windshield);
  const sideWin = new THREE.Mesh(new THREE.BoxGeometry(W * 1.52, 0.4, L * 0.86), glass);
  sideWin.position.set(0, 2.4, L * 0.18); g.add(sideWin);
  // Arceau radar (flybridge)
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 8), chrome);
    post.position.set(sx * W * 0.55, 3.15, L * 0.35); g.add(post);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, W * 1.2, 8).rotateZ(Math.PI / 2), chrome);
  bar.position.set(0, 3.6, L * 0.35); g.add(bar);
  const radar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.1, 16), white);
  radar.position.set(0, 3.75, L * 0.35); g.add(radar);
  // Rambardes de proue
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, L * 0.7, 6).rotateX(Math.PI / 2), chrome);
    rail.position.set(sx * W * 0.85, 1.75, -L * 0.5); g.add(rail);
  }
  g.scale.setScalar(0.62);
  return g;
}
function initYachts() {
  for (let i = 0; i < 3; i++) {
    const g = buildYacht();
    g.visible = false;
    scene.add(g);
    ambientYachts.push({ g, heading: Math.random() * TWO_PI, speed: 3.5 + Math.random() * 3, x: 0, z: 0, wakeAcc: 0, placed: false });
  }
}
function updateYachts(dt, t) {
  for (const y of ambientYachts) {
    if (!y.placed) {
      const a = Math.random() * TWO_PI, d = 320 + Math.random() * 360;
      y.x = state.x + Math.cos(a) * d; y.z = state.z + Math.sin(a) * d;
      y.heading = Math.random() * TWO_PI; y.placed = true; y.g.visible = true;
    }
    // Modèle : proue au -Z ; sous R_y(heading), avant = (-sin, -cos)
    y.x += -Math.sin(y.heading) * y.speed * dt;
    y.z += -Math.cos(y.heading) * y.speed * dt;
    if (Math.hypot(y.x - state.x, y.z - state.z) > 950) { y.placed = false; y.g.visible = false; continue; }
    const hw = waveHeight(y.x, y.z, t);
    y.g.position.set(y.x, hw * 0.4, y.z);
    y.g.rotation.y = y.heading;
    y.g.rotation.z = Math.sin(t * 0.5 + y.x * 0.3) * 0.02;
    y.g.rotation.x = Math.sin(t * 0.42 + y.z * 0.3) * 0.015;
    // Sillage à la poupe (+Z modèle -> derrière = +sin,+cos)
    y.wakeAcc += 5 * dt;
    while (y.wakeAcc >= 1) {
      y.wakeAcc -= 1;
      const bx = y.x + Math.sin(y.heading) * 3.6, bz = y.z + Math.cos(y.heading) * 3.6;
      spawnWake(bx + (Math.random() - 0.5) * 1.4, waveHeight(bx, bz, t), bz + (Math.random() - 0.5) * 1.4, 1.5, 3.2);
    }
  }
}

/* ================= VIE : oiseaux + poissons + yachts ================= */
function setSeaLifeVisible(v) {
  for (const fl of gullFlocks) for (const bird of fl.birds) bird.visible = v;
  if (!v) {
    for (const f of fishPool) { f.active = false; f.g.visible = false; f.next = Math.random() * 4; }
    for (const y of ambientYachts) { y.placed = false; y.g.visible = false; }
  }
}
const uwEl = document.getElementById('uw');
initFish();
initYachts();

const buoys = [];
const buoyBody = new THREE.CylinderGeometry(0.45, 0.6, 1.1, 12);
const buoyMat = new THREE.MeshStandardMaterial({ color: 0xc4384a, roughness: 0.5 });
for (let i = 0; i < 8; i++) {
  const b = new THREE.Mesh(buoyBody, buoyMat);
  b.position.set((Math.random() - 0.5) * 600, 0, -80 - Math.random() * 500);
  scene.add(b);
  buoys.push(b);
}

/* ---- Portes lumineuses (micro-défis) ---- */
const gate = new THREE.Group();
const gateTorus = new THREE.Mesh(
  new THREE.TorusGeometry(5, 0.35, 14, 40),
  new THREE.MeshStandardMaterial({ color: 0x18e0e0, emissive: 0x11c4c4, emissiveIntensity: 2.2, roughness: 0.4, metalness: 0.2 })
);
gate.add(gateTorus);
for (const px of [-5, 5]) {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 6, 10), new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.6 }));
  post.position.set(px, -3.5, 0);
  gate.add(post);
}
const gateFlag = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.5 }));
gateFlag.position.set(0, 5, 0);
gate.add(gateFlag);
gate.position.set(0, 4, -130);
gate.visible = false;
scene.add(gate);

const GATE_COLORS = [
  { ring: 0x18e0e0, emis: 0x11c4c4 },
  { ring: 0xff4d7d, emis: 0xd42a5a }
];
let gateColorIdx = 0;
function placeGate(dx, dz) {
  const d = 105 + Math.random() * 55;
  const lat = (Math.random() - 0.5) * 46;
  gate.position.x = state.x + dx * d + (-dz) * lat;
  gate.position.z = state.z + dz * d + (dx) * lat;
  gate.rotation.y = Math.atan2(dx, dz);
  gateColorIdx ^= 1;
  const col = GATE_COLORS[gateColorIdx];
  gateTorus.material.color.setHex(col.ring);
  gateTorus.material.emissive.setHex(col.emis);
}

const DEFIS = [
  { t: 'Franchis 3 portes', type: 'gates', target: 3, reward: 500 },
  { t: 'Monte à 95 km/h', type: 'speed', target: 95, reward: 400 },
  { t: 'Ramasse 6 anneaux', type: 'rings', target: 6, reward: 1000 },
  { t: "Reste 1,0 s en l'air", type: 'air', target: 1.0, reward: 700 },
  { t: 'Drifte 3 s cumulées', type: 'drift', target: 3, reward: 800 },
  { t: 'Combo x3 aux portes', type: 'combo', target: 3, reward: 900 },
  { t: 'Porte en moins de 12 s', type: 'sprint', target: 12, reward: 900 },
  { t: 'Franchis 5 portes', type: 'gates', target: 5, reward: 800 },
  { t: 'File en haute mer (400 m)', type: 'offshore', target: 400, reward: 700 },
  { t: 'Enchaîne 4 sauts', type: 'jumps', target: 4, reward: 650 }
];
const CH = { score: 0, combo: 0, comboTimer: 0, gatesPassed: 0, idx: 0, startGates: 0, maxAir: 0, maxCombo: 0, gateFlash: 0, driftAcc: 0, ringsGot: 0, sprintLeft: 0, jumps: 0 };

/* ---- Mini-jeu ANNEAUX : pickups dorés flottants posés en slalom devant le joueur ---- */
const pickups = [];
const pickMat = new THREE.MeshStandardMaterial({ color: 0xffd23c, emissive: 0xffb400, emissiveIntensity: 1.8, roughness: 0.35, metalness: 0.4 });
for (let i = 0; i < 6; i++) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.16, 10, 26), pickMat);
  m.rotation.x = Math.PI / 2;   // à plat sur l'eau
  m.visible = false;
  scene.add(m);
  pickups.push({ m, got: false });
}
function placePickups() {
  // Chapelet en léger slalom devant le joueur (45 m -> ~175 m)
  const fx0 = -Math.sin(state.yaw), fz0 = -Math.cos(state.yaw);
  const rx0 = Math.cos(state.yaw), rz0 = -Math.sin(state.yaw);
  pickups.forEach((p, i) => {
    p.got = false; p.m.visible = true;
    const ahead = 45 + i * 26, lat = Math.sin(i * 1.25) * 15;
    p.m.position.set(state.x + fx0 * ahead + rx0 * lat, 0, state.z + fz0 * ahead + rz0 * lat);
  });
}
function hidePickups() { for (const p of pickups) { p.m.visible = false; p.got = true; } }
/* Entrée dans un défi : remet les compteurs et prépare le terrain du mini-jeu. */
function enterDefi(i) {
  CH.idx = i;
  CH.startGates = CH.gatesPassed; CH.maxAir = 0; CH.maxCombo = 0;
  CH.driftAcc = 0; CH.ringsGot = 0; CH.jumps = 0;
  const d = DEFIS[i];
  CH.sprintLeft = d.type === 'sprint' ? d.target : 0;
  if (d.type === 'rings') placePickups(); else hidePickups();
}

// Sprite d'écume : dégradé radial blanc->transparent sur un canvas carré.
// Factorisé (dropSprite / mistSprite / AI_FOAM partagent ce moule).
function mkFoamTex(size, r0, r1, stops) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(size / 2, size / 2, r0, size / 2, size / 2, r1);
  for (const [o, col] of stops) g.addColorStop(o, col);
  c.fillStyle = g; c.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ================= BOUÉES DE COURSE + JET SKIS IA =================
   Un circuit ovale de bouées coniques marque une course ; 3 pilotes IA
   l'enchaînent en boucle (poursuite de waypoints, gîte dans les virages,
   sillage d'écume). Ils peuplent le plan d'eau et donnent des adversaires. */
const raceBuoys = [];
const BUOY_PATH = [];
(function buildCircuit() {
  const cx = 0, cz = -50, rx = 105, rz = 145, N = 12;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TWO_PI;
    const x = cx + Math.cos(a) * rx, z = cz + Math.sin(a) * rz;
    BUOY_PATH.push({ x, z });
    const col = i % 2 === 0 ? 0xff3b30 : 0xffd21e;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.92, 2.3, 16),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, metalness: 0.1, emissive: col, emissiveIntensity: 0.18 }));
    body.position.y = 0.75; body.castShadow = true; g.add(body);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.42, 16),
      new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.5 }));
    stripe.position.y = 0.72; g.add(stripe);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.5 }));
    cap.position.y = 2.05; g.add(cap);
    const flag = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2 }));
    flag.position.y = 2.5; g.add(flag);
    g.position.set(x, 0, z);
    scene.add(g);
    raceBuoys.push({ g, x, z, ph: (i * 1.7) % TWO_PI });
  }
})();

function makeAiSki(hullColor, vestColor) {
  const g = new THREE.Group();
  const hullM = new THREE.MeshStandardMaterial({ color: hullColor, roughness: 0.32, metalness: 0.35 });
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.44, 1.7, 6, 14), hullM);
  hull.rotation.x = Math.PI / 2; hull.position.y = 0.42; hull.scale.set(1, 1, 1.25); g.add(hull);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.16, 1.95),
    new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.6 }));
  deck.position.y = 0.66; g.add(deck);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.95, 14), hullM);
  nose.rotation.x = -Math.PI / 2; nose.position.set(0, 0.46, -1.4); g.add(nose);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.55, 12), hullM);
  col.position.set(0, 0.78, -0.5); col.rotation.x = 0.55; g.add(col);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.52, 8),
    new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.5 }));
  bar.rotation.z = Math.PI / 2; bar.position.set(0, 0.92, -0.44); g.add(bar);
  const skin = new THREE.MeshStandardMaterial({ color: 0x9a6a48, roughness: 0.7 });
  const vestM = new THREE.MeshStandardMaterial({ color: vestColor, roughness: 0.5 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.42, 6, 12), vestM);
  torso.position.set(0, 1.12, 0.16); torso.rotation.x = -0.38; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 14, 12), skin);
  head.position.set(0, 1.5, -0.02); g.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.175, 14, 12, 0, TWO_PI, 0, Math.PI * 0.6),
    new THREE.MeshStandardMaterial({ color: hullColor, roughness: 0.22, metalness: 0.45 }));
  helmet.position.set(0, 1.52, -0.02); g.add(helmet);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.42, 5, 8), vestM);
    arm.position.set(0.19 * s, 1.06, -0.16); arm.rotation.x = -0.95; arm.rotation.z = 0.18 * s; g.add(arm);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.34, 5, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.7 }));
    thigh.position.set(0.15 * s, 0.82, 0.42); thigh.rotation.x = 1.15; g.add(thigh);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

const AI_FOAM = mkFoamTex(64, 2, 30, [[0, 'rgba(255,255,255,0.9)'], [0.5, 'rgba(226,240,246,0.4)'], [1, 'rgba(226,240,246,0)']]);
const aiSkis = [];
const AI_DEFS = [[0x2f6bff, 0xffe14d], [0xff2f7d, 0x2affea], [0x35d17a, 0xff8a3d]];
AI_DEFS.forEach((def, i) => {
  const g = makeAiSki(def[0], def[1]);
  const wp = Math.floor((i / AI_DEFS.length) * BUOY_PATH.length);
  const p = BUOY_PATH[wp];
  const sx = p.x + (i - 1) * 5;                 // écart latéral au départ (couloir propre)
  g.position.set(sx, 0, p.z);
  scene.add(g);
  const foam = new THREE.Sprite(new THREE.SpriteMaterial({ map: AI_FOAM, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending }));
  foam.scale.set(3, 3, 1); scene.add(foam);
  aiSkis.push({ g, foam, x: sx, z: p.z, yaw: 0, spd: 8, maxSpd: 15 + i * 2.5, turn: 1.5 + i * 0.15, wp: (wp + 1) % BUOY_PATH.length, bob: i * 2.1 });
});

// Circuit IA : poursuite de waypoints + gîte + sillage. Appelé chaque frame en ride.
function updateAiFleet(dt, t) {
  for (const b of raceBuoys) {
    b.g.position.y = waveHeight(b.x, b.z, t);
    b.g.rotation.z = Math.sin(t * 1.3 + b.ph) * 0.14;
    b.g.rotation.x = Math.cos(t * 1.1 + b.ph) * 0.1;
  }
  for (const ai of aiSkis) {
    const tgt = BUOY_PATH[ai.wp];
    const dx = tgt.x - ai.x, dz = tgt.z - ai.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 15) ai.wp = (ai.wp + 1) % BUOY_PATH.length;
    const desired = Math.atan2(-dx, -dz);
    let dy = desired - ai.yaw;
    while (dy > Math.PI) dy -= TWO_PI;
    while (dy < -Math.PI) dy += TWO_PI;
    ai.yaw += Math.sign(dy) * Math.min(Math.abs(dy), ai.turn * dt);
    const targetSpd = ai.maxSpd * (1 - 0.42 * Math.min(Math.abs(dy), 1));
    ai.spd += (targetSpd - ai.spd) * Math.min(1, dt * 1.6);
    const fx = -Math.sin(ai.yaw), fz = -Math.cos(ai.yaw);
    ai.x += fx * ai.spd * dt; ai.z += fz * ai.spd * dt;
    const y = waveHeight(ai.x, ai.z, t);
    ai.g.position.set(ai.x, y, ai.z);
    ai.g.rotation.y = ai.yaw;
    ai.g.rotation.z = -Math.sign(dy) * Math.min(Math.abs(dy), 1) * 0.38;
    ai.g.rotation.x = 0.05 + Math.sin(t * 3.1 + ai.bob) * 0.035;
    const sf = ai.spd / ai.maxSpd;
    ai.foam.position.set(ai.x - fx * 1.7, y + 0.2, ai.z - fz * 1.7);
    ai.foam.material.opacity = Math.min(0.65, sf * 0.7) * (0.8 + 0.2 * Math.sin(t * 13 + ai.bob));
    ai.foam.scale.setScalar(2.4 + sf * 2.8);
  }
}
// Bouées + flotte IA : n'existent qu'en course (comme la gate et la faune).
function setFleetVisible(v) {
  for (const b of raceBuoys) b.g.visible = v;
  for (const ai of aiSkis) { ai.g.visible = v; ai.foam.visible = v; }
}
setFleetVisible(false);   // état initial = menu

/* ================= MÉTA-GAMEPLAY : COLLECTIBLES + CARBURANT + POLICE =================
   Le monde ouvert se remplit de pièces à ramasser (champ infini recyclé autour du
   joueur), de coffres au trésor et de bidons d'essence. Le carburant crée la tension
   "encore un run" ; la police apporte l'adrénaline Miami. Tout nourrit l'économie. */
let fuel = 1, runCoins = 0, runActive = false, runEnding = false, runPaused = false;
let heat = 0, chaseOn = false, escapeTimer = 0, caughtTimer = 0, policeTimer = 45, treasuresRevealed = false;
let lowFuelWarned = false, offshoreCredit = false;

function sfxBlip(freq, freq2, dur, type, gain) {
  if (!audio || muted) return;
  const c = audio.ctx, o = c.createOscillator(), g = c.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(freq, c.currentTime);
  if (freq2) o.frequency.exponentialRampToValueAtTime(freq2, c.currentTime + dur);
  o.connect(g); g.connect(audio.master);
  g.gain.setValueAtTime(gain || 0.14, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.start(); o.stop(c.currentTime + dur + 0.02);
}

/* ---- Champ de PIÈCES recyclé autour du joueur (monde ouvert infini) ---- */
const coins = [];
const coinGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.12, 18).rotateX(Math.PI / 2);
const coinMat = new THREE.MeshStandardMaterial({ color: 0xffd23c, emissive: 0xffb400, emissiveIntensity: 0.7, metalness: 0.6, roughness: 0.3 });
for (let i = 0; i < 46; i++) {
  const m = new THREE.Mesh(coinGeo, coinMat); m.visible = false; scene.add(m);
  coins.push({ m, x: 0, z: 0, ph: Math.random() * TWO_PI });
}
function scatterCoin(c, near) {
  const ang = Math.random() * TWO_PI, d = near ? 40 + Math.random() * 90 : 30 + Math.random() * 220;
  c.x = state.x + Math.cos(ang) * d; c.z = state.z + Math.sin(ang) * d;
}
/* ---- Coffres au trésor (rares, grosse récompense) ---- */
const chests = [];
const chestGeo = new THREE.BoxGeometry(1.3, 0.9, 0.95);
const chestMat = new THREE.MeshStandardMaterial({ color: 0x7a4a1e, emissive: 0x3a2410, emissiveIntensity: 0.4, roughness: 0.6, metalness: 0.2 });
const chestLidMat = new THREE.MeshStandardMaterial({ color: 0xffd23c, emissive: 0xffb400, emissiveIntensity: 0.6, metalness: 0.7, roughness: 0.3 });
for (let i = 0; i < 7; i++) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(chestGeo, chestMat); body.castShadow = true; g.add(body);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.28, 0.99), chestLidMat); lid.position.y = 0.5; g.add(lid);
  g.visible = false; scene.add(g);
  chests.push({ g, x: 0, z: 0, ph: Math.random() * TWO_PI });
}
/* ---- Bidons d'essence (refont le plein) ---- */
const cans = [];
const canGeo = new THREE.BoxGeometry(0.7, 0.9, 0.5);
const canMat = new THREE.MeshStandardMaterial({ color: 0xd8232a, emissive: 0x5a0e10, emissiveIntensity: 0.5, roughness: 0.5 });
for (let i = 0; i < 9; i++) {
  const m = new THREE.Mesh(canGeo, canMat); m.castShadow = true; m.visible = false; scene.add(m);
  cans.push({ m, x: 0, z: 0, ph: Math.random() * TWO_PI });
}
function scatterFar(o, dmin, dmax) {
  const ang = Math.random() * TWO_PI, d = dmin + Math.random() * (dmax - dmin);
  o.x = state.x + Math.cos(ang) * d; o.z = state.z + Math.sin(ang) * d;
}
function seedWorld() {
  for (const c of coins) scatterCoin(c, false);
  for (const ch of chests) scatterFar(ch, 90, 320);
  for (const cn of cans) scatterFar(cn, 70, 280);
  treasuresRevealed = false;
}
function collectiblesVisible(v) {
  for (const c of coins) c.m.visible = v;
  for (const ch of chests) ch.g.visible = v;
  for (const cn of cans) cn.m.visible = v;
}
function gainCoins(n, worldX, worldZ) {
  runCoins += n;
  const gEl = document.getElementById('coin-gain');
  if (gEl) { gEl.textContent = '+' + n; gEl.style.opacity = '1'; clearTimeout(gainCoins._t); gainCoins._t = setTimeout(() => { gEl.style.opacity = '0'; }, 700); }
  const b = document.getElementById('game-coin-bal');
  if (b) b.textContent = (save.coins + runCoins).toLocaleString('fr-FR');
}

/* ---- POLICE : patrouille maritime Miami 1986 (coque blanche + gyrophare) ---- */
const police = makeAiSki(0xeef2f5, 0x16357a);
const sirenR = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 2 }));
const sirenB = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshStandardMaterial({ color: 0x2040ff, emissive: 0x0030ff, emissiveIntensity: 2 }));
sirenR.position.set(-0.12, 1.0, 0.55); sirenB.position.set(0.12, 1.0, 0.55);
police.add(sirenR); police.add(sirenB);
// Barre de gyrophare (support noir entre les 2 feux) + livrée "POLICE" sur les flancs.
const sirenBar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.14), new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.5 }));
sirenBar.position.set(0, 0.95, 0.55); police.add(sirenBar);
const polDecalTex = (() => {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 72;
  const c = cv.getContext('2d');
  c.fillStyle = '#123a86'; c.fillRect(0, 8, 256, 12);      // liseré bleu haut
  c.fillStyle = '#123a86'; c.fillRect(0, 52, 256, 12);     // liseré bleu bas
  c.font = '900 40px "Arial Black", Impact, sans-serif';
  c.fillStyle = '#12306e'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('POLICE', 128, 37);
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; return tx;
})();
for (const s of [-1, 1]) {
  const dec = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.42), new THREE.MeshBasicMaterial({ map: polDecalTex, transparent: true }));
  dec.position.set(0.455 * s, 0.5, 0.1); dec.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
  police.add(dec);
}
police.visible = false; scene.add(police);
const policeState = { x: 0, z: 0, yaw: 0, spd: 0 };
const policeFoam = new THREE.Sprite(new THREE.SpriteMaterial({ map: AI_FOAM, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending }));
policeFoam.scale.set(3.5, 3.5, 1); policeFoam.visible = false; scene.add(policeFoam);
function startChase() {
  if (chaseOn) return;
  chaseOn = true; heat = 0.35; escapeTimer = 0; caughtTimer = 0;
  const ang = state.yaw + Math.PI + (Math.random() - 0.5);
  policeState.x = state.x + Math.sin(ang) * 55; policeState.z = state.z + Math.cos(ang) * 55;
  policeState.yaw = state.yaw; policeState.spd = 12;
  police.visible = true; policeFoam.visible = true;
  toast('🚨 POLICE — sème-les !');
  sfxBlip(500, 900, 0.3, 'sawtooth', 0.1);
}
function endChase(escaped) {
  chaseOn = false; police.visible = false; policeFoam.visible = false;
  policeTimer = 55 + Math.random() * 45;
  if (escaped) {
    const reward = 120 + Math.floor(heat * 260);
    gainCoins(reward); toast('🏁 Semés ! +' + reward + ' 🪙');
    missionAdd('escape', 1);
    cgHappytime();
  }
  heat = 0;
}
function updatePolice(dt, t) {
  const bl = (Math.sin(t * 12) > 0);
  sirenR.material.emissiveIntensity = bl ? 3 : 0.2;
  sirenB.material.emissiveIntensity = bl ? 0.2 : 3;
  if (!chaseOn) {
    if (runActive && !runPaused) { policeTimer -= dt; if (policeTimer <= 0) startChase(); }
    return;
  }
  // Poursuite : cap vers le joueur, vitesse ~ proche de la sienne (un poil moins -> échappable).
  const dx = state.x - policeState.x, dz = state.z - policeState.z;
  const dist = Math.hypot(dx, dz);
  const desired = Math.atan2(-dx, -dz);
  let dy = desired - policeState.yaw;
  while (dy > Math.PI) dy -= TWO_PI; while (dy < -Math.PI) dy += TWO_PI;
  policeState.yaw += Math.sign(dy) * Math.min(Math.abs(dy), 2.0 * dt);
  const chaseSpd = Math.min(PHYS.max * 0.82, 27);   // plus lent que le joueur -> on peut le semer
  policeState.spd += (chaseSpd - policeState.spd) * Math.min(1, dt * 1.2);
  const fxp = -Math.sin(policeState.yaw), fzp = -Math.cos(policeState.yaw);
  policeState.x += fxp * policeState.spd * dt; policeState.z += fzp * policeState.spd * dt;
  const py = waveHeight(policeState.x, policeState.z, t);
  police.position.set(policeState.x, py, policeState.z);
  police.rotation.y = policeState.yaw;
  police.rotation.z = -Math.sign(dy) * Math.min(Math.abs(dy), 1) * 0.35;
  police.rotation.x = 0.05 + Math.sin(t * 3 + 1) * 0.03;
  policeFoam.position.set(policeState.x - fxp * 1.8, py + 0.2, policeState.z - fzp * 1.8);
  policeFoam.material.opacity = 0.5;
  heat = Math.max(0, Math.min(1, heat + (dist < 40 ? dt * 0.15 : -dt * 0.05)));
  if (dist < 7) { caughtTimer += dt; if (caughtTimer > 2.2) { caughtTimer = 0; endRun('busted'); } }
  else caughtTimer = Math.max(0, caughtTimer - dt * 1.5);
  if (dist > 120) { escapeTimer += dt; if (escapeTimer > 3) endChase(true); }   // plus facile à semer
  else escapeTimer = Math.max(0, escapeTimer - dt * 0.5);
}

/* ---- Mise à jour de tout le méta-gameplay en jeu (appelée chaque frame ride) ---- */
const _mmCtx = (() => { const cv = document.getElementById('minimap'); return cv ? cv.getContext('2d') : null; })();
let mmTick = 0;
function updateMeta(dt, t) {
  if (!runActive || runPaused) return;
  const pickR2 = 4.2 * 4.2;
  // Pièces
  for (const c of coins) {
    const dx = c.x - state.x, dz = c.z - state.z;
    if (dx * dx + dz * dz < pickR2) {
      gainCoins(8, c.x, c.z);
      burstDrops(c.x, waveHeight(c.x, c.z, t) + 0.4, c.z, 6, 0.4, 0, 0);
      sfxBlip(880, 1500, 0.09, 'square', 0.1);
      missionAdd('coins', 1);
      scatterCoin(c, true);
    } else if (dx * dx + dz * dz > 340 * 340) scatterCoin(c, false);
    c.m.position.set(c.x, waveHeight(c.x, c.z, t) + 0.55 + Math.sin(t * 3 + c.ph) * 0.12, c.z);
    c.m.rotation.z = t * 3 + c.ph;
  }
  // Coffres
  for (const ch of chests) {
    const dx = ch.x - state.x, dz = ch.z - state.z;
    if (dx * dx + dz * dz < 6 * 6) {
      const reward = 60 + Math.floor(Math.random() * 170);
      gainCoins(reward, ch.x, ch.z); save.treasuresFound++;
      burstDrops(ch.x, waveHeight(ch.x, ch.z, t) + 0.5, ch.z, 30, 0.9, 0, 0);
      sfxBlip(660, 1320, 0.25, 'triangle', 0.16);
      toast('💰 Trésor ! +' + reward + ' 🪙');
      missionAdd('chest', 1); cgHappytime();
      scatterFar(ch, 120, 340);
    }
    ch.g.position.set(ch.x, waveHeight(ch.x, ch.z, t) + 0.35 + Math.sin(t * 2 + ch.ph) * 0.1, ch.z);
    ch.g.rotation.y = t * 0.4 + ch.ph; ch.g.rotation.z = Math.sin(t * 1.7 + ch.ph) * 0.12;
  }
  // Bidons d'essence
  for (const cn of cans) {
    const dx = cn.x - state.x, dz = cn.z - state.z;
    if (dx * dx + dz * dz < 5 * 5) {
      fuel = Math.min(1, fuel + 0.35);
      sfxBlip(300, 200, 0.2, 'sawtooth', 0.12); toast('⛽ +35% carburant');
      scatterFar(cn, 90, 300);
    }
    cn.m.position.set(cn.x, waveHeight(cn.x, cn.z, t) + 0.5 + Math.sin(t * 2.6 + cn.ph) * 0.1, cn.z);
    cn.m.rotation.y = t * 0.8 + cn.ph;
  }
  // Carburant : se vide en roulant (généreux : ~90 s plein gaz), plus vite plein gaz.
  fuel -= dt * (0.004 + Math.max(0, state.throttle) * 0.007);
  const ff = document.getElementById('fuel-fill');
  if (ff) { ff.style.width = Math.max(0, fuel * 100) + '%'; }
  if (fuel < 0.18 && !lowFuelWarned) { lowFuelWarned = true; toast('⛽ Carburant bas — trouve un bidon !'); }
  if (fuel <= 0 && !runEnding) { fuel = 0; endRun('fuel'); }
  // Haute mer (défi + repère) : crédité une fois par run quand on s'éloigne du départ.
  if (!offshoreCredit && Math.hypot(state.x, state.z) > 420) { offshoreCredit = true; missionAdd('offshore', 1); toast('🌊 Haute mer !'); }
  // Police
  updatePolice(dt, t);
  // Missions temps réel (vitesse / air)
  missionReach('speed', Math.abs(state.speed) * 3.6);
  // Minimap (throttlée)
  if (_mmCtx && (++mmTick % 3 === 0)) drawMinimap(t);
}
function drawMinimap(t) {
  const ctx = _mmCtx, S = 150, R = S / 2, RANGE = 300;
  ctx.clearRect(0, 0, S, S);
  const cs = Math.cos(state.yaw), sn = Math.sin(state.yaw);
  const put = (wx, wz, col, r) => {
    let ddx = wx - state.x, ddz = wz - state.z;
    // rotation pour que le joueur pointe vers le haut (repère cap)
    const rx = ddx * cs - ddz * sn, rz = ddx * sn + ddz * cs;
    const px = R + (rx / RANGE) * R, py = R + (rz / RANGE) * R;
    if (px < 2 || px > S - 2 || py < 2 || py > S - 2) return;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px, py, r, 0, TWO_PI); ctx.fill();
  };
  for (const b of raceBuoys) put(b.x, b.z, 'rgba(255,80,80,0.8)', 2);
  for (const c of coins) put(c.x, c.z, 'rgba(255,210,60,0.9)', 1.6);
  for (const cn of cans) put(cn.x, cn.z, 'rgba(255,60,60,0.95)', 2.4);
  if (treasuresRevealed) for (const ch of chests) put(ch.x, ch.z, 'rgba(190,120,255,1)', 3);
  for (const ai of aiSkis) put(ai.x, ai.z, 'rgba(120,200,255,0.7)', 2);
  if (chaseOn) put(policeState.x, policeState.z, (Math.sin(t * 12) > 0 ? '#ff2020' : '#2040ff'), 3.2);
  // joueur au centre (triangle vers le haut)
  ctx.fillStyle = '#35e0e0'; ctx.beginPath(); ctx.moveTo(R, R - 6); ctx.lineTo(R - 4, R + 5); ctx.lineTo(R + 4, R + 5); ctx.closePath(); ctx.fill();
}

/* ================= FIN DE RUN : ×2 pièces + CONTINUE (pubs) ================= */
function endRun(reason) {
  if (runEnding) return;
  runEnding = true; runPaused = true;
  const canContinue = (reason === 'fuel' || reason === 'busted');
  document.getElementById('re-title').textContent = reason === 'busted' ? 'ARRÊTÉ !' : (reason === 'fuel' ? 'PANNE SÈCHE' : 'RUN TERMINÉ');
  document.getElementById('re-sub').textContent = reason === 'busted' ? "La police t'a chopé." : (reason === 'fuel' ? "Plus d'essence — trouve un bidon !" : 'Belle sortie.');
  document.getElementById('re-coins').textContent = runCoins.toLocaleString('fr-FR');
  document.getElementById('re-continue').style.display = canContinue ? '' : 'none';
  const dbl = document.getElementById('re-double'); dbl.disabled = runCoins <= 0; dbl.style.opacity = runCoins <= 0 ? '0.4' : '1';
  document.getElementById('runend').classList.remove('hidden');
  cgGameplayStop();
}
function resumeRun() {
  document.getElementById('runend').classList.add('hidden');
  runEnding = false; runPaused = false;
  cgGameplayStart();
}
function bankRun() {
  if (runCoins > 0) addCoins(runCoins);
  if (CH.score > save.best) { save.best = Math.round(CH.score); persist(); }
  runCoins = 0;
  document.getElementById('runend').classList.add('hidden');
  toGarage();
}
document.getElementById('re-continue').addEventListener('click', () => {
  cgRewarded(() => { fuel = 1; heat = 0; chaseOn = false; police.visible = false; policeFoam.visible = false; policeTimer = 55; caughtTimer = 0; resumeRun(); });
});
document.getElementById('re-double').addEventListener('click', () => {
  const dbl = document.getElementById('re-double');
  if (dbl.disabled) return;
  cgRewarded(() => { runCoins *= 2; document.getElementById('re-coins').textContent = runCoins.toLocaleString('fr-FR'); dbl.disabled = true; dbl.style.opacity = '0.4'; });
});
document.getElementById('re-bank').addEventListener('click', bankRun);
function requestGarage() {
  if (runActive && !runEnding && runCoins > 0) endRun('garage');
  else toGarage();
}

/* ================= MISSIONS DU JOUR ================= */
const MISSION_POOL = [
  { id: 'coins', text: t => `Ramasse ${t} pièces`, target: 40, reward: 150, mode: 'count' },
  { id: 'speed', text: t => `Atteins ${t} km/h`, target: 150, reward: 120, mode: 'max' },
  { id: 'flip', text: () => 'Réussis un salto', target: 1, reward: 200, mode: 'count' },
  { id: 'chest', text: t => `Ouvre ${t} coffre(s)`, target: 2, reward: 250, mode: 'count' },
  { id: 'escape', text: () => 'Sème la police', target: 1, reward: 300, mode: 'count' },
  { id: 'air', text: t => `Reste ${t}s en l'air`, target: 2, reward: 180, mode: 'max' },
  { id: 'gates', text: t => `Franchis ${t} portes`, target: 5, reward: 160, mode: 'count' },
  { id: 'jumps', text: t => `Fais ${t} sauts`, target: 5, reward: 200, mode: 'count' },
  { id: 'offshore', text: () => 'File en haute mer', target: 1, reward: 250, mode: 'count' }
];
function dayNumber() { return Math.floor(Date.now() / 86400000); }
function missionDef(id) { return MISSION_POOL.find(m => m.id === id); }
function ensureMissions() {
  const dn = dayNumber();
  if (save.missionDay !== dn || !save.missions) {
    const pool = MISSION_POOL.map((_, i) => i), idx = [];
    let seed = dn + 1;
    while (idx.length < 3 && pool.length) { seed = (seed * 9301 + 49297) % 233280; idx.push(pool.splice(Math.floor(seed / 233280 * pool.length), 1)[0]); }
    save.missions = idx.map(i => ({ id: MISSION_POOL[i].id, prog: 0, done: false }));
    save.missionDay = dn; persist();
  }
}
function renderMissions() {
  ensureMissions();
  const host = document.getElementById('mission-list'); if (!host) return;
  host.innerHTML = save.missions.map(ms => {
    const d = missionDef(ms.id), pct = Math.min(100, ms.prog / d.target * 100);
    return `<div class="mission ${ms.done ? 'done' : ''}"><span class="mreward">${ms.done ? '✓' : '+' + d.reward + ' 🪙'}</span>${d.text(d.target)}<div class="mbar"><div style="width:${pct}%"></div></div></div>`;
  }).join('');
}
function missionProgress(id, val, isMax) {
  if (!save.missions) return;
  let changed = false;
  for (const ms of save.missions) {
    if (ms.id !== id || ms.done) continue;
    const d = missionDef(id);
    const prev = ms.prog;
    ms.prog = isMax ? Math.max(ms.prog, val) : ms.prog + val;
    if (ms.prog >= d.target) { ms.done = true; addCoins(d.reward); toast('Défi réussi ! +' + d.reward + ' 🪙'); changed = true; }
    else if (ms.prog !== prev) changed = true;   // n'écrit la sauvegarde QUE sur vrai changement (sinon jank)
  }
  if (changed) persist();
}
function missionAdd(id, n) { missionProgress(id, n, false); }
function missionReach(id, val) { missionProgress(id, val, true); }

/* ================= ROUE DE LA CHANCE (quotidienne + spin bonus par pub) ================= */
const WHEEL_PRIZES = [80, 150, 250, 120, 400, 90, 600, 300];
let wheelAngle = 0, wheelSpinning = false;
function drawWheel() {
  const cv = document.getElementById('wheel-cv'); if (!cv) return;
  const ctx = cv.getContext('2d'), N = WHEEL_PRIZES.length, R = 122, cx = 130, cy = 130;
  ctx.clearRect(0, 0, 260, 260);
  for (let i = 0; i < N; i++) {
    const a0 = wheelAngle + i / N * TWO_PI, a1 = wheelAngle + (i + 1) / N * TWO_PI;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath();
    ctx.fillStyle = i % 2 ? '#2a1c3a' : '#3a2450'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,92,138,0.4)'; ctx.stroke();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate((a0 + a1) / 2);
    ctx.fillStyle = '#ffd23c'; ctx.font = '700 15px Menlo, monospace'; ctx.textAlign = 'right';
    ctx.fillText(WHEEL_PRIZES[i], R - 12, 5); ctx.restore();
  }
  ctx.fillStyle = '#35e0e0'; ctx.beginPath(); ctx.moveTo(cx, 4); ctx.lineTo(cx - 9, 20); ctx.lineTo(cx + 9, 20); ctx.closePath(); ctx.fill();
}
function canDailySpin() { return save.lastDaily !== dayNumber(); }
function updateWheelButtons() {
  const sp = document.getElementById('wheel-spin'); if (!sp) return;
  if (canDailySpin()) { sp.textContent = 'TOURNER (gratuit)'; sp.disabled = false; sp.style.opacity = '1'; }
  else { sp.textContent = 'DÉJÀ TOURNÉ AUJOURD’HUI'; sp.disabled = true; sp.style.opacity = '0.5'; }
}
function awardWheel(wasFree) {
  const N = WHEEL_PRIZES.length, seg = TWO_PI / N;
  const topLocal = ((-Math.PI / 2 - wheelAngle) % TWO_PI + TWO_PI) % TWO_PI;
  let prize = WHEEL_PRIZES[Math.floor(topLocal / seg) % N];
  if (wasFree && save.streak > 1) prize = Math.round(prize * (1 + Math.min(save.streak, 7) * 0.08));
  addCoins(prize);
  document.getElementById('wheel-prize').textContent = '+' + prize + ' 🪙' + (wasFree && save.streak > 1 ? ` (série ×${save.streak})` : '');
  sfxBlip(660, 1320, 0.2, 'triangle', 0.14);
  updateWheelButtons();
}
function spinWheel(free) {
  if (wheelSpinning) return;
  if (free && !canDailySpin()) { toast('Déjà tourné aujourd’hui — reviens demain !'); return; }
  const doSpin = () => {
    wheelSpinning = true;
    const start = wheelAngle, target = wheelAngle + (4 + Math.random() * 3) * TWO_PI + Math.random() * TWO_PI, t0 = performance.now(), dur = 2600;
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      wheelAngle = start + (target - start) * e; drawWheel();
      if (p < 1) requestAnimationFrame(step);
      else { wheelSpinning = false; awardWheel(free); }
    };
    requestAnimationFrame(step);
  };
  if (free) { save.lastDaily = dayNumber(); persist(); doSpin(); }
  else cgRewarded(doSpin);
}
{
  const bw = document.getElementById('btn-wheel');
  if (bw) bw.addEventListener('click', () => { document.getElementById('wheel-ov').classList.remove('hidden'); drawWheel(); updateWheelButtons(); document.getElementById('wheel-prize').textContent = ''; });
  const ws = document.getElementById('wheel-spin'); if (ws) ws.addEventListener('click', () => spinWheel(true));
  const wb = document.getElementById('wheel-bonus'); if (wb) wb.addEventListener('click', () => spinWheel(false));
  const wc = document.getElementById('wheel-close'); if (wc) wc.addEventListener('click', () => document.getElementById('wheel-ov').classList.add('hidden'));
}
// Série de connexion quotidienne.
(function initStreak() {
  const dn = dayNumber();
  if (save.lastOpenDay !== dn) {
    save.streak = (save.lastOpenDay === dn - 1) ? (save.streak || 0) + 1 : 1;
    save.lastOpenDay = dn; persist();
  }
})();
// Init UI méta au chargement (le DOM existe : script en fin de body).
updateCoinUI(); renderMissions();
// Hooks de debug (tests headless) — variables méta sinon en closure.
window.__meta = {
  save, get fuel() { return fuel; }, set fuel(v) { fuel = v; },
  get runCoins() { return runCoins; }, get chaseOn() { return chaseOn; }, get treasuresRevealed() { return treasuresRevealed; },
  startChase: () => startChase(), endRun: r => endRun(r), setCoins: n => { save.coins = n; persist(); updateCoinUI(); refreshSkiCards(); refreshSuitCards(); }
};

const splashes = [];
const splashGeo = new THREE.CircleGeometry(1.4, 24).rotateX(-Math.PI / 2);
for (let i = 0; i < 5; i++) {
  const m = new THREE.Mesh(splashGeo, new THREE.MeshBasicMaterial({ color: 0xf4e4e0, transparent: true, opacity: 0, depthWrite: false }));
  scene.add(m);
  splashes.push({ m, age: 99, power: 1 });
}
function spawnSplash(x, y, z, power) {
  let s = splashes[0];
  for (const c of splashes) if (c.age > s.age) s = c;
  s.age = 0; s.power = power;
  s.m.position.set(x, y + 0.1, z);
}

/* ---- Gouttelettes 3D (vraies particules balistiques) ---- */
const DROP_N = 320;
const dropPos = new Float32Array(DROP_N * 3);
const dropVel = [];
const dropLife = new Float32Array(DROP_N);
for (let i = 0; i < DROP_N; i++) { dropPos[i * 3 + 1] = -100; dropVel.push(new THREE.Vector3()); dropLife[i] = 0; }
const dropGeo = new THREE.BufferGeometry();
dropGeo.setAttribute('position', new THREE.BufferAttribute(dropPos, 3));
const dropSprite = mkFoamTex(32, 1, 15, [[0, 'rgba(255,255,255,0.95)'], [0.55, 'rgba(235,242,246,0.5)'], [1, 'rgba(235,242,246,0)']]);
const dropPoints = new THREE.Points(dropGeo, new THREE.PointsMaterial({
  size: 0.16, map: dropSprite, transparent: true, depthWrite: false, sizeAttenuation: true, color: 0xeef4f6
}));
dropPoints.frustumCulled = false;
scene.add(dropPoints);
let dropCursor = 0;
function burstDrops(x, y, z, count, power, velX, velZ) {
  for (let k = 0; k < count; k++) {
    const i = dropCursor;
    dropCursor = (dropCursor + 1) % DROP_N;
    dropPos[i * 3] = x + (Math.random() - 0.5) * 1.4;
    dropPos[i * 3 + 1] = y + 0.15;
    dropPos[i * 3 + 2] = z + (Math.random() - 0.5) * 1.4;
    const ang = Math.random() * TWO_PI;
    const sp = (0.8 + Math.random() * 2.6) * power;
    dropVel[i].set(Math.cos(ang) * sp + velX * 0.35, (2.2 + Math.random() * 3.6) * power, Math.sin(ang) * sp + velZ * 0.35);
    dropLife[i] = 0.9 + Math.random() * 0.5;
  }
}
function updateDrops(dt, t) {
  let any = false;
  for (let i = 0; i < DROP_N; i++) {
    if (dropLife[i] <= 0) continue;
    any = true;
    dropLife[i] -= dt;
    dropVel[i].y -= 12 * dt;
    dropPos[i * 3] += dropVel[i].x * dt;
    dropPos[i * 3 + 1] += dropVel[i].y * dt;
    dropPos[i * 3 + 2] += dropVel[i].z * dt;
    if (dropLife[i] <= 0 || dropPos[i * 3 + 1] < waveHeight(dropPos[i * 3], dropPos[i * 3 + 2], t) - 0.3) {
      dropLife[i] = 0;
      dropPos[i * 3 + 1] = -100;
    }
  }
  if (any) dropGeo.attributes.position.needsUpdate = true;
}

/* ================= ROOSTER TAIL (gerbe de turbine) =================
   LA signature visuelle d'un jetski : la pompe éjecte l'eau vers le haut et
   l'arrière en éventail étroit. L'eau quitte la tuyère à ~la vitesse du jet
   vers l'arrière, donc en espace-monde elle reste quasi sur place et MONTE :
   on n'ajoute pas la vitesse du ski, juste up + un peu d'arrière. */
// Brume douce et plumeuse (cœur diffus, bords très fondus) : superposées et
// nombreuses, les particules se fondent en gerbe d'eau continue plutôt qu'en
// pastilles rondes distinctes.
const mistSprite = mkFoamTex(64, 0, 32, [[0, 'rgba(255,255,255,0.55)'], [0.35, 'rgba(244,252,255,0.28)'], [0.7, 'rgba(232,244,250,0.08)'], [1, 'rgba(232,244,250,0)']]);
const ROOST_N = 1000;
const roostPos = new Float32Array(ROOST_N * 3);
const roostVel = [];
const roostLife = new Float32Array(ROOST_N);
for (let i = 0; i < ROOST_N; i++) { roostPos[i * 3 + 1] = -100; roostVel.push(new THREE.Vector3()); }
const roostGeo = new THREE.BufferGeometry();
roostGeo.setAttribute('position', new THREE.BufferAttribute(roostPos, 3));
const roostPoints = new THREE.Points(roostGeo, new THREE.PointsMaterial({
  size: 0.62, map: mistSprite, transparent: true, opacity: 0.6, depthWrite: false, sizeAttenuation: true, color: 0xf4fcff
}));
roostPoints.frustumCulled = false;
scene.add(roostPoints);
let roostCursor = 0, roostAccum = 0;
function emitRoost(dt, t, fx, fz, rx, rz, speedF) {
  // Débit et hauteur ∝ régime turbine et vitesse (plein pot = geyser).
  const power = state.rpm * (0.35 + 0.65 * speedF);
  const rate = (110 + 480 * speedF) * state.rpm;
  roostAccum += rate * dt;
  const sx = state.x - fx * 1.8, sz = state.z - fz * 1.8;
  const sy = waveHeight(sx, sz, t);
  while (roostAccum >= 1) {
    roostAccum -= 1;
    const i = roostCursor; roostCursor = (roostCursor + 1) % ROOST_N;
    const lat = (Math.random() - 0.5) * 0.26;
    roostPos[i * 3] = sx + rx * lat;
    roostPos[i * 3 + 1] = sy + 0.04;
    roostPos[i * 3 + 2] = sz + rz * lat;
    const vUp = (3.2 + Math.random() * 2.6) * (0.45 + power);
    const vBack = 1.2 + Math.random() * 1.8 + speedF * 2.5;
    const vLatJ = (Math.random() - 0.5) * (0.6 + speedF * 1.6);
    roostVel[i].set(-fx * vBack + rx * vLatJ, vUp, -fz * vBack + rz * vLatJ);
    roostLife[i] = 0.7 + Math.random() * 0.6;
  }
}
function updateRoost(dt, t) {
  let any = false;
  for (let i = 0; i < ROOST_N; i++) {
    if (roostLife[i] <= 0) continue;
    any = true;
    roostLife[i] -= dt;
    roostVel[i].y -= 9.8 * dt;
    roostPos[i * 3] += roostVel[i].x * dt;
    roostPos[i * 3 + 1] += roostVel[i].y * dt;
    roostPos[i * 3 + 2] += roostVel[i].z * dt;
    if (roostLife[i] <= 0 || (roostVel[i].y < 0 && roostPos[i * 3 + 1] < waveHeight(roostPos[i * 3], roostPos[i * 3 + 2], t))) {
      roostLife[i] = 0;
      roostPos[i * 3 + 1] = -100;
    }
  }
  if (any) roostGeo.attributes.position.needsUpdate = true;
}

/* ================= TRAÎNÉE PERSISTANTE (world-space wake) =================
   Nappe d'écume qui reste dans le monde derrière la coque : chaque frame on
   dépose un "puff" à la position de la turbine, il grandit et s'estompe.
   Résultat : un vrai sillage qu'on voit s'étirer sur 30-40 mètres. */
const WAKE_N = 160;
const wakePuffs = [];
const wakeSprite = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.4, 'rgba(240,246,250,0.5)');
  g.addColorStop(0.75, 'rgba(220,232,240,0.15)');
  g.addColorStop(1, 'rgba(220,232,240,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 24; i++) {
    c.beginPath(); c.arc(20 + Math.random() * 88, 20 + Math.random() * 88, 2 + Math.random() * 6, 0, TWO_PI);
    c.fillStyle = 'rgba(0,0,0,' + (0.15 + Math.random() * 0.3) + ')';
    c.globalCompositeOperation = 'destination-out'; c.fill();
    c.globalCompositeOperation = 'source-over';
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();
const wakePlane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
for (let i = 0; i < WAKE_N; i++) {
  const m = new THREE.Mesh(wakePlane, new THREE.MeshBasicMaterial({ map: wakeSprite, transparent: true, opacity: 0, depthWrite: false }));
  m.visible = false;
  scene.add(m);
  wakePuffs.push({ m, age: 99, life: 3.0, baseSize: 1.2 });
}
let wakeCursor = 0, wakeAccum = 0;
function spawnWake(x, y, z, size, life) {
  const p = wakePuffs[wakeCursor];
  wakeCursor = (wakeCursor + 1) % WAKE_N;
  p.age = 0; p.life = life;
  p.baseSize = size;
  p.m.position.set(x, y + 0.02, z);
  p.m.rotation.y = Math.random() * TWO_PI;
  p.m.visible = true;
}
function updateWake(dt, t) {
  for (const p of wakePuffs) {
    if (!p.m.visible) continue;
    p.age += dt;
    const f = p.age / p.life;
    if (f >= 1) { p.m.visible = false; continue; }
    // Suit la surface de l'eau
    p.m.position.y = waveHeight(p.m.position.x, p.m.position.z, t) + 0.03;
    const s = p.baseSize * (0.7 + f * 2.0);
    p.m.scale.set(s, 1, s);
    p.m.material.opacity = (1 - f) * (1 - f) * 0.5;
  }
}

/* ================= ANNEAUX D'ONDE (rayonnement poupe) ================= */
const RING_N = 14;
const rings = [];
const ringGeo = new THREE.RingGeometry(0.9, 1.0, 48).rotateX(-Math.PI / 2);
for (let i = 0; i < RING_N; i++) {
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xf6faff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  m.visible = false;
  scene.add(m);
  rings.push({ m, age: 99, life: 1.6 });
}
let ringCursor = 0;
function spawnRing(x, y, z, life) {
  const r = rings[ringCursor];
  ringCursor = (ringCursor + 1) % RING_N;
  r.age = 0; r.life = life;
  r.m.position.set(x, y + 0.04, z);
  r.m.visible = true;
}
function updateRings(dt, t) {
  for (const r of rings) {
    if (!r.m.visible) continue;
    r.age += dt;
    const f = r.age / r.life;
    if (f >= 1) { r.m.visible = false; continue; }
    r.m.position.y = waveHeight(r.m.position.x, r.m.position.z, t) + 0.05;
    const s = 0.4 + f * 8;
    r.m.scale.set(s, 1, s);
    r.m.material.opacity = (1 - f) * 0.35;
  }
}

/* ================= JETSKI DÉTAILLÉ ================= */
// Texture d'écume : blanc qui s'estompe en longueur, rongé de trous
const foamTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 256;
  const c = cv.getContext('2d');
  const grad = c.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = grad;
  c.fillRect(0, 0, 128, 256);
  const side = c.createLinearGradient(0, 0, 128, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)');
  side.addColorStop(0.25, 'rgba(0,0,0,0)');
  side.addColorStop(0.75, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)');
  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = side;
  c.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 260; i++) {
    const y = Math.random() * 256;
    const r = 2 + Math.random() * 9 * (0.3 + y / 256);
    c.beginPath();
    c.arc(Math.random() * 128, y, r, 0, TWO_PI);
    c.fillStyle = 'rgba(0,0,0,' + (0.25 + Math.random() * 0.5) + ')';
    c.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();

// Plaque numéro dans le dos du pilote
const numberTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#f2f2f2';
  c.beginPath(); c.arc(64, 64, 60, 0, TWO_PI); c.fill();
  c.strokeStyle = '#14161c'; c.lineWidth = 5; c.stroke();
  c.fillStyle = '#14161c';
  c.font = 'bold 82px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('5', 64, 70);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

// Texture d'anneau d'écume de contact : donut blanc rongé de trous, centre
// transparent (la coque passe au travers), bord externe fondu.
const contactTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(128, 128, 40, 128, 128, 126);
  g.addColorStop(0.0, 'rgba(255,255,255,0)');
  g.addColorStop(0.30, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.55, 'rgba(245,250,252,0.55)');
  g.addColorStop(1.0, 'rgba(240,246,250,0)');
  c.fillStyle = g; c.fillRect(0, 0, 256, 256);
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 40; i++) {
    c.beginPath();
    c.arc(20 + Math.random() * 216, 20 + Math.random() * 216, 3 + Math.random() * 9, 0, TWO_PI);
    c.fillStyle = 'rgba(0,0,0,' + (0.2 + Math.random() * 0.4) + ')';
    c.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();

const ski = new THREE.Group();
ski.rotation.order = 'YXZ';
scene.add(ski);
let barGroup = null, sprays = [], wakes = [], sternWash = null, contactRing = null, riderBody = null, animRefs = null;
let realModel = null, realHullMesh = null, realDeckMesh = null, realRiderGroup = null;
let realSuitMats = [];
function updateRealModelColors() {
  const cfg = MODELS.find(m => m.id === sel.ski);
  if (realHullMesh) realHullMesh.material.color.setHex(cfg.colors.hull);
  if (realDeckMesh) realDeckMesh.material.color.setHex(cfg.colors.deck);
  if (realSuitMats.length) {
    const suitColor = SUITS.find(s => s.id === sel.suit).c;
    for (const m of realSuitMats) m.color.setHex(suitColor);
  }
}
let gaugeTex = null, gctx = null;

function hullShape(widthF, lengthF) {
  // Plan de coque PWC : proue EFFILÉE (pointe fine à -z), flancs galbés avec une
  // ligne de chine marquée vers -0.2L, tableau arrière large et net (+z).
  const s = new THREE.Shape();
  const w = widthF, L = lengthF;
  s.moveTo(0, -2.18 * L);
  s.quadraticCurveTo(0.16 * w, -2.02 * L, 0.38 * w, -1.55 * L);
  s.quadraticCurveTo(0.60 * w, -1.0 * L, 0.66 * w, -0.18 * L);   // chine
  s.quadraticCurveTo(0.685 * w, 0.62 * L, 0.60 * w, 1.42 * L);
  s.lineTo(0.52 * w, 1.5 * L);                                   // coin de tableau
  s.lineTo(-0.52 * w, 1.5 * L);
  s.quadraticCurveTo(-0.60 * w, 0.62 * L, -0.685 * w, -0.18 * L);
  s.quadraticCurveTo(-0.66 * w, -1.0 * L, -0.38 * w, -1.55 * L);
  s.quadraticCurveTo(-0.16 * w, -2.02 * L, 0, -2.18 * L);
  return s;
}
function hullLayer(widthF, lengthF, depth, mat, y) {
  const geo = new THREE.ExtrudeGeometry(hullShape(widthF, lengthF), {
    depth, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.045, bevelSegments: 5, curveSegments: 32
  });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, depth, 0);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function decalTexture(brand, name, colorCss) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, 512, 128);
  c.font = 'italic 900 58px "Avenir Next", sans-serif';
  c.textAlign = 'left';
  c.fillStyle = colorCss;
  c.fillText(brand, 18, 62);
  c.font = 'italic 700 38px "Avenir Next", sans-serif';
  c.fillStyle = 'rgba(255,255,255,0.92)';
  c.fillText(name, 18, 108);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
function gel(color, rough) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: 0.1, roughness: rough, clearcoat: 1.0, clearcoatRoughness: 0.12, envMapIntensity: 0.75 });
}

function buildSki() {
  // Purge
  while (ski.children.length) {
    const c = ski.children[0];
    ski.remove(c);
  }
  sprays = []; wakes = []; sternWash = null;

  const cfg = MODELS.find(m => m.id === sel.ski);
  const suitCfg = SUITS.find(s => s.id === sel.suit);
  const skinColor = PILOTES.find(p => p.id === sel.pilote).skin;

  const hullM = gel(cfg.colors.hull, 0.28);
  const deckM = gel(cfg.colors.deck, 0.22);
  const accM = gel(cfg.colors.accent, 0.18);
  const seatM = new THREE.MeshStandardMaterial({ color: cfg.colors.seat, roughness: 0.85 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x121417, roughness: 0.85 });
  const gripRub = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.95, metalness: 0.0 });
  const chrome = new THREE.MeshPhysicalMaterial({ color: 0xd6dbe0, metalness: 1.0, roughness: 0.14, clearcoat: 1.0, clearcoatRoughness: 0.1, envMapIntensity: 1.2 });
  const mirrorGlass = new THREE.MeshPhysicalMaterial({ color: 0x2a3644, metalness: 0.9, roughness: 0.06, clearcoat: 1.0, envMapIntensity: 1.4 });
  const suitM = new THREE.MeshStandardMaterial({ color: suitCfg.c, roughness: 0.75 });
  const cuffM = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.7 }); // bracelet néoprène sombre (plus discret que l'accent vif)
  // Peau bronzée mouillée : PBR + reflet spéculaire humide (clearcoat) + pseudo-SSS
  // (sheen chaud) pour éviter l'aspect plastique. Base de tout le pilote Miami.
  const skinM = new THREE.MeshPhysicalMaterial({ color: skinColor, roughness: 0.44, metalness: 0.0, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffd9b0), clearcoat: 0.35, clearcoatRoughness: 0.42, envMapIntensity: 0.7 });
  // Peau des zones bombées (épaules/dos) légèrement plus claire = highlights musculaires.
  const skinHiM = skinM.clone(); skinHiM.color = new THREE.Color(skinColor).lerp(new THREE.Color(0xffffff), 0.12);
  // Gants néoprène (mains) : caoutchouc sombre mat avec léger satiné.
  const gloveM = new THREE.MeshPhysicalMaterial({ color: 0x15171d, roughness: 0.62, metalness: 0.0, sheen: 0.3, sheenColor: new THREE.Color(0x2a2f38), clearcoat: 0.2, clearcoatRoughness: 0.6 });
  const gloveAcc = new THREE.MeshStandardMaterial({ color: suitCfg.c, roughness: 0.55 }); // liseré coloré du gant
  // Gilet de sauvetage : mousse gainée nylon (couleur combinaison) + sangles + boucles.
  const vestFabM = new THREE.MeshStandardMaterial({ color: suitCfg.c, roughness: 0.62, metalness: 0.0 });
  const vestFabM2 = new THREE.MeshStandardMaterial({ color: suitCfg.c2, roughness: 0.6 });
  const strapM = new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.7 });
  const buckleM = new THREE.MeshStandardMaterial({ color: 0x0c0d11, roughness: 0.35, metalness: 0.2 });
  // Lunettes aviateur : verres miroir fumés + monture dorée (Miami 1986).
  const lensM = new THREE.MeshPhysicalMaterial({ color: 0x0a0e16, metalness: 0.6, roughness: 0.06, clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.6 });
  const goldM = new THREE.MeshStandardMaterial({ color: 0xd8b24a, metalness: 0.95, roughness: 0.22 });
  // Cheveux 80s brun foncé (satinés).
  const hairM2 = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.72, metalness: 0.0 });
  // Board short (couleur combinaison, tissu mat).
  const shortsM = new THREE.MeshStandardMaterial({ color: suitCfg.c, roughness: 0.7 });
  const shortsM2 = new THREE.MeshStandardMaterial({ color: suitCfg.c2, roughness: 0.68 });

  const scaleF = cfg.id === 'spark' ? 0.88 : 1.0;

  const S = scaleF;
  const wellM = new THREE.MeshStandardMaterial({ color: 0x0c0d11, roughness: 0.98 });
  const matM = new THREE.MeshStandardMaterial({ color: 0x191b21, roughness: 1.0 });
  const stitchM = new THREE.MeshStandardMaterial({ color: 0x3a3d45, roughness: 0.8 });

  const trimGel = new THREE.MeshPhysicalMaterial({ color: cfg.colors.trim, metalness: 0.2, roughness: 0.3, clearcoat: 1.0, clearcoatRoughness: 0.1, envMapIntensity: 1.0 });
  // ===================== COQUE (carène planante, DEUX-TONS) =====================
  ski.add(hullLayer(1.0 * S, S, 0.36, hullM, 0.0));                 // carène BASSE = teinte hull (sombre)
  ski.add(hullLayer(1.06 * S, 1.012 * S, 0.028, trimGel, 0.335));   // filet de livrée clair (trim)
  ski.add(hullLayer(1.05 * S, 1.008 * S, 0.05, chrome, 0.365));     // liston CHROMÉ (bond line)
  ski.add(hullLayer(0.92 * S, 0.975 * S, 0.20, deckM, 0.42));       // pont = teinte deck (colorée)
  // Strakes de chine : lignes qui fendent l'eau le long de la carène
  for (const sx of [-1, 1]) for (const k of [0, 1]) {
    const strake = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 2.1 * S), accM);
    strake.position.set((0.5 + k * 0.11) * sx * S, 0.13 - k * 0.09, -0.1 * S);
    strake.rotation.z = sx * 0.5; ski.add(strake);
  }

  // ===================== PONT SCULPTÉ (avant) =====================
  // Nez de proue effilé et RELEVÉ
  const bowNose = new THREE.Mesh(new THREE.CapsuleGeometry(0.15 * S, 0.72 * S, 8, 18).rotateX(Math.PI / 2), deckM);
  bowNose.position.set(0, 0.6, -1.5 * S); bowNose.rotation.x = -0.3; bowNose.scale.set(1.35, 0.66, 1.15); bowNose.castShadow = true; ski.add(bowNose);
  // Capot avant bombé (compartiment moteur) — teinte pont, avec un panneau
  // sombre sur le dessus (color-blocking = les formes se lisent).
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.35 * S, 22, 14), deckM);
  hood.position.set(0, 0.58, -0.9 * S); hood.scale.set(1.08, 0.6, 1.5); hood.castShadow = true; ski.add(hood);
  const hoodPanel = new THREE.Mesh(new THREE.SphereGeometry(0.29 * S, 18, 12), accM);
  hoodPanel.position.set(0, 0.66, -0.95 * S); hoodPanel.scale.set(0.78, 0.42, 1.35); ski.add(hoodPanel);
  // Nacelle de console (sombre) : monte du pont vers le guidon
  const nacelle = new THREE.Mesh(new THREE.BoxGeometry(0.46 * S, 0.46, 0.68 * S), accM);
  nacelle.position.set(0, 0.74, -0.5 * S); nacelle.rotation.x = 0.2; nacelle.castShadow = true; ski.add(nacelle);
  // Œil de proue chromé
  const bowEye = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.011, 6, 14), chrome);
  bowEye.rotation.x = Math.PI / 2; bowEye.position.set(0, 0.36, -1.98 * S); ski.add(bowEye);

  // ===================== REPOSE-PIEDS + GUNWALES =====================
  for (const sx of [-1, 1]) {
    const well = new THREE.Mesh(new THREE.BoxGeometry(0.4 * S, 0.06, 1.55 * S), wellM);
    well.position.set(0.42 * sx * S, 0.55, 0.55 * S); well.receiveShadow = true; ski.add(well);
    const trac = new THREE.Mesh(new THREE.BoxGeometry(0.34 * S, 0.03, 1.45 * S), matM);
    trac.position.set(0.42 * sx * S, 0.585, 0.55 * S); ski.add(trac);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1 * S, 0.15, 1.7 * S), deckM);
    gun.position.set(0.66 * sx * S, 0.62, 0.45 * S); gun.castShadow = true; ski.add(gun);
    const gunCap = new THREE.Mesh(new THREE.BoxGeometry(0.12 * S, 0.04, 1.7 * S), rubber);
    gunCap.position.set(0.66 * sx * S, 0.7, 0.45 * S); ski.add(gunCap);
  }

  // ===================== SELLE 2 NIVEAUX =====================
  const seatFront = new THREE.Mesh(new THREE.CapsuleGeometry(0.2 * S, 0.48 * S, 10, 22).rotateX(Math.PI / 2), seatM);
  seatFront.position.set(0, 0.74, 0.42 * S); seatFront.scale.set(1.2, 0.72, 1); seatFront.castShadow = true; ski.add(seatFront);
  const seatRear = new THREE.Mesh(new THREE.CapsuleGeometry(0.23 * S, 0.5 * S, 10, 22).rotateX(Math.PI / 2), seatM);
  seatRear.position.set(0, 0.8, 1.02 * S); seatRear.scale.set(1.24, 0.92, 1); seatRear.castShadow = true; ski.add(seatRear);
  for (const zx of [0.2, 0.55, 0.9, 1.25]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.012, 0.4 * S), stitchM); st.position.set(0, 0.93, zx * S); ski.add(st); }

  // ===================== ARRIÈRE (plateforme, tuyère, admission) =====================
  const platform = new THREE.Mesh(new THREE.BoxGeometry(0.92 * S, 0.08, 0.52 * S), deckM);
  platform.position.set(0, 0.5, 1.55 * S); platform.castShadow = true; ski.add(platform);
  const platMat = new THREE.Mesh(new THREE.BoxGeometry(0.82 * S, 0.03, 0.44 * S), matM);
  platMat.position.set(0, 0.54, 1.55 * S); ski.add(platMat);
  const handleRear = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.022, 8, 18), chrome);
  handleRear.rotation.x = Math.PI / 2; handleRear.position.set(0, 0.62, 1.52 * S); ski.add(handleRear);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.34, 16).rotateX(Math.PI / 2), chrome);
  nozzle.position.set(0, 0.2, 1.66 * S); ski.add(nozzle);
  const nozzleCone = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.14, 12).rotateX(Math.PI / 2), rubber);
  nozzleCone.position.set(0, 0.2, 1.8 * S); ski.add(nozzleCone);
  const intake = new THREE.Mesh(new THREE.BoxGeometry(0.3 * S, 0.04, 0.5 * S), rubber);
  intake.position.set(0, 0.02, 1.0 * S); ski.add(intake);
  for (let g = 0; g < 4; g++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.28 * S, 0.05, 0.02), chrome); bar.position.set(0, 0.03, (0.82 + g * 0.1) * S); ski.add(bar); }
  for (const sx of [-1, 1]) {
    const sponson = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.7 * S), accM);
    sponson.position.set(0.68 * sx * S, 0.14, 1.05 * S); sponson.rotation.z = sx * 0.15; ski.add(sponson);
  }

  // LIVRÉE GRAPHIQUE sur les flancs : swoosh deux-tons dynamique + marque + modèle
  const livCss = '#' + cfg.colors.trim.toString(16).padStart(6, '0');
  const livAcc = '#' + cfg.colors.accent.toString(16).padStart(6, '0');
  const livCv = document.createElement('canvas'); livCv.width = 640; livCv.height = 200;
  const lc = livCv.getContext('2d'); lc.clearRect(0, 0, 640, 200);
  lc.fillStyle = livCss; lc.beginPath(); lc.moveTo(0, 152); lc.lineTo(640, 58); lc.lineTo(640, 104); lc.lineTo(0, 200); lc.closePath(); lc.fill();
  lc.fillStyle = livAcc; lc.globalAlpha = 0.9; lc.beginPath(); lc.moveTo(0, 128); lc.lineTo(640, 36); lc.lineTo(640, 54); lc.lineTo(0, 146); lc.closePath(); lc.fill(); lc.globalAlpha = 1;
  lc.font = 'italic 900 64px "Avenir Next", sans-serif'; lc.textAlign = 'left'; lc.fillStyle = livCss;
  lc.fillText(cfg.brand.toUpperCase(), 26, 74);
  lc.font = 'italic 700 42px "Avenir Next", sans-serif'; lc.fillStyle = 'rgba(255,255,255,0.95)';
  lc.fillText(cfg.name, 28, 128);
  const livTex = new THREE.CanvasTexture(livCv); livTex.colorSpace = THREE.SRGBColorSpace; livTex.anisotropy = 4;
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2.4 * S, 0.72 * S),
      new THREE.MeshBasicMaterial({ map: livTex, transparent: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    p.position.set(0.665 * sx * S, 0.4, 0.05);
    p.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    ski.add(p);
  }

  // ===================== MARQUES / LIVRÉE =====================
  const trimCss = '#' + cfg.colors.trim.toString(16).padStart(6, '0');
  const trimM = new THREE.MeshStandardMaterial({ color: cfg.colors.trim, roughness: 0.35, metalness: 0.3 });
  // Bande de livrée le long du pont (chaque côté)
  for (const sx of [-1, 1]) {
    const stripe2 = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.055, 2.5 * S), trimM);
    stripe2.position.set(0.605 * sx * S, 0.5, -0.02 * S); stripe2.rotation.x = 0.02; ski.add(stripe2);
  }
  // GROS badge de marque sur le capot, incliné vers le pilote (visible en FPV)
  const badgeTex = decalTexture(cfg.brand, '', trimCss);
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.66 * S, 0.165 * S),
    new THREE.MeshBasicMaterial({ map: badgeTex, transparent: true, depthWrite: false }));
  badge.position.set(0, 0.84, -0.76 * S); badge.rotation.x = -0.55; ski.add(badge);
  // Logo sur le pad central du guidon (bien visible en 1re personne)
  if (barGroup) {
    const barLogo = new THREE.Mesh(new THREE.PlaneGeometry(0.22 * S, 0.055 * S),
      new THREE.MeshBasicMaterial({ map: badgeTex, transparent: true, depthWrite: false }));
    barLogo.position.set(0, 0.17, 0.135); barLogo.rotation.x = -0.85; barGroup.add(barLogo);
  }
  // GROS décalco du modèle sur le capot arrière (visible de dos en chase)
  const rearTex = decalTexture(cfg.brand, cfg.name, trimCss);
  const rearDecal = new THREE.Mesh(new THREE.PlaneGeometry(1.0 * S, 0.25 * S),
    new THREE.MeshBasicMaterial({ map: rearTex, transparent: true, depthWrite: false }));
  rearDecal.position.set(0, 0.72, 1.34 * S); rearDecal.rotation.set(-0.25, Math.PI, 0); ski.add(rearDecal);
  // Numéro de coque « 86 » type course sur la proue (chaque côté)
  const numCv = document.createElement('canvas'); numCv.width = 128; numCv.height = 128;
  const nctx = numCv.getContext('2d');
  nctx.fillStyle = trimCss; nctx.font = 'italic 900 104px "Avenir Next", sans-serif';
  nctx.textAlign = 'center'; nctx.textBaseline = 'middle'; nctx.fillText('86', 64, 68);
  const numTex = new THREE.CanvasTexture(numCv); numTex.colorSpace = THREE.SRGBColorSpace;
  for (const sx of [-1, 1]) {
    const num = new THREE.Mesh(new THREE.PlaneGeometry(0.24 * S, 0.24 * S),
      new THREE.MeshBasicMaterial({ map: numTex, transparent: true, depthWrite: false }));
    num.position.set(0.5 * sx * S, 0.44, -1.35 * S); num.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2; ski.add(num);
  }

  // ===================== DÉTAILS PRODUIT (panneaux + chrome) =====================
  const panelM = new THREE.MeshStandardMaterial({ color: 0x08090c, roughness: 0.9 });
  // Lignes de tôle (panel lines) sur le capot avant
  for (const pz of [-1.25, -1.05, -0.7]) {
    const pl = new THREE.Mesh(new THREE.BoxGeometry(0.5 * S, 0.012, 0.02), panelM);
    pl.position.set(0, 0.66, pz * S); ski.add(pl);
  }
  // Filet chromé le long du capot moteur
  const hoodChrome = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.9 * S), chrome);
  hoodChrome.position.set(0, 0.72, -0.9 * S); ski.add(hoodChrome);
  // Bouchon d'essence chromé
  const fuelCap = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * S, 0.05 * S, 0.03, 16), chrome);
  fuelCap.position.set(0.15 * S, 0.66, 0.18 * S); ski.add(fuelCap);
  // Taquets d'amarrage chromés (proue + poupe)
  for (const cz of [-1.15, 1.3]) {
    const cleat = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.12 * S, 8).rotateZ(Math.PI / 2), chrome);
    cleat.position.set(0, 0.56, cz * S); ski.add(cleat);
  }
  // Grilles d'aération chromées sur les flancs du capot
  for (const sx of [-1, 1]) for (let v = 0; v < 3; v++) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.015, 0.16 * S), chrome);
    vent.position.set(0.34 * sx * S, 0.6 - v * 0.045, -0.75 * S); vent.rotation.z = sx * 0.2; ski.add(vent);
  }

  // Console + compteur à rouleaux
  const consoleBox = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.36, 0.6), deckM);
  consoleBox.position.set(0, 0.95, -0.5 * scaleF);
  consoleBox.rotation.x = 0.15;
  consoleBox.castShadow = true;
  ski.add(consoleBox);
  const gcv = document.createElement('canvas');
  gcv.width = 256; gcv.height = 160;
  gctx = gcv.getContext('2d');
  window.__viceGauge = gcv;
  gaugeTex = new THREE.CanvasTexture(gcv);
  gaugeTex.colorSpace = THREE.SRGBColorSpace;
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.05), rubber);
  bezel.position.set(0, 1.28, -0.46 * scaleF);
  bezel.rotation.x = -0.6;
  ski.add(bezel);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.43, 0.27),
    new THREE.MeshBasicMaterial({ map: gaugeTex }));
  window.__viceScreen = screen.material;
  screen.position.set(0, 1.297, -0.46 * scaleF + 0.025);
  screen.rotation.x = -0.6;
  ski.add(screen);

  // Guidon
  barGroup = new THREE.Group();
  // Guidon posé sur la console du modèle vert (dessus de pont ≈ Y0.51) : hauteur
  // de riser réaliste ~0.3 au-dessus, et la colonne plonge DANS le pont pour que
  // ça paraisse intégré au jetski (avant : le guidon flottait 0.7 trop haut).
  barGroup.position.set(0, 0.68, -0.30 * scaleF);
  ski.add(barGroup);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.62, 12), rubber);
  column.position.set(0, -0.22, 0.02);
  column.rotation.x = 0.32;
  barGroup.add(column);
  const centerPad = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.12), rubber);
  centerPad.position.set(0, 0.12, 0.06);
  barGroup.add(centerPad);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.0, 24).rotateZ(Math.PI / 2), chrome);
  bar.position.set(0, 0.14, 0.1);
  barGroup.add(bar);
  // Renfort central + colliers de serrage (détail réaliste du guidon)
  const clampBlock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.09), rubber);
  clampBlock.position.set(0, 0.155, 0.1); barGroup.add(clampBlock);
  // === TABLEAU DE BORD (façon Sea-Doo) : plus GRAND + cerclage chromé, incliné vers le pilote ===
  const dashHousing = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.21, 0.06), new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.45, metalness: 0.2 }));
  dashHousing.position.set(0, 0.24, 0.0); dashHousing.rotation.x = -0.5; barGroup.add(dashHousing);
  const dashBezel = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.18, 0.02), chrome);
  dashBezel.position.set(0, 0.24 + Math.sin(0.5) * 0.032, Math.cos(0.5) * 0.032); dashBezel.rotation.x = -0.5; barGroup.add(dashBezel);
  // Écran incliné, décalé LE LONG DE SA NORMALE (sin/cos du tilt) pour éviter le z-fighting.
  const dashScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.155),
    new THREE.MeshBasicMaterial({ map: gaugeTex, side: THREE.DoubleSide, toneMapped: false }));
  dashScreen.position.set(0, 0.24 + Math.sin(0.5) * 0.04, Math.cos(0.5) * 0.04);
  dashScreen.rotation.x = -0.5;
  barGroup.add(dashScreen);
  // Leviers articulés : gâchette de gaz (droite) et frein (gauche), pivot au guidon
  animRefs = { throttleLever: null, brakeLever: null, rFingers: [], lFingers: [], rThumb: null };
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.36 * s, 0.14, 0.1);
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.15, 10), chrome);
    lever.position.set(0, -0.055, -0.055);
    lever.rotation.x = 0.75;
    pivot.add(lever);
    barGroup.add(pivot);
    if (s > 0) animRefs.throttleLever = pivot; else animRefs.brakeLever = pivot;
    // Rétroviseur : coque sombre + verre réfléchissant, incliné vers le pilote
    const mHousing = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.085, 0.05), rubber);
    mHousing.position.set(0.66 * s, 0.10, -0.3); mHousing.rotation.set(0.2, -0.35 * s, 0);
    barGroup.add(mHousing);
    const mGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.07), mirrorGlass);
    mGlass.position.set(0.66 * s + 0.026 * s, 0.10, -0.275); mGlass.rotation.set(0.2, -0.35 * s + Math.PI, 0);
    barGroup.add(mGlass);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.18, 8), rubber);
    stalk.position.set(0.58 * s, 0.03, -0.22);
    stalk.rotation.z = -0.6 * s;
    barGroup.add(stalk);
  }
  // Bouton de démarrage rouge sur le pavé central
  const startBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.015, 12), new THREE.MeshStandardMaterial({ color: 0xd8232a, roughness: 0.4 }));
  startBtn.position.set(-0.06, 0.165, 0.06);
  barGroup.add(startBtn);
  const stopBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.015, 12), new THREE.MeshStandardMaterial({ color: 0x2c8a3a, roughness: 0.4 }));
  stopBtn.position.set(0.06, 0.165, 0.06);
  barGroup.add(stopBtn);

  /* ---- Bras + mains détaillées (doigt par doigt) ---- */
  function limbMesh(parent, p1, p2, r1, r2, mat) {
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = dir.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, 12), mat);
    m.position.addVectors(p1, p2).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    m.castShadow = true;
    parent.add(m);
    return m;
  }
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Vector3(0.24 * s, -0.01, 0.90);
    const elbow = new THREE.Vector3(0.40 * s, -0.06, 0.55);
    const wrist = new THREE.Vector3(0.455 * s, 0.10, 0.22);
    // Bras nus (pilote torse nu) : peau du haut du bras jusqu'aux mains.
    limbMesh(barGroup, shoulder, elbow, 0.078, 0.064, skinM);
    limbMesh(barGroup, elbow, wrist, 0.06, 0.045, skinM);
    const elbowBall = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), skinM);
    elbowBall.position.copy(elbow);
    barGroup.add(elbowBall);
    // Poignet : peau + liseré de combinaison
    const wristSkin = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.045, 0.08, 10), skinM);
    wristSkin.position.copy(wrist).add(new THREE.Vector3(0, 0.01, -0.04));
    wristSkin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(wrist, elbow).normalize());
    barGroup.add(wristSkin);
    const cuffB = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.05, 10), cuffM);
    cuffB.position.copy(wrist).add(new THREE.Vector3(0, -0.02, 0.06));
    cuffB.quaternion.copy(wristSkin.quaternion);
    barGroup.add(cuffB);
    // Montre dorée au poignet gauche
    if (s < 0) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.022, 12), rubber);
      band.position.copy(wrist).add(new THREE.Vector3(0, 0.0, -0.01));
      band.quaternion.copy(wristSkin.quaternion);
      barGroup.add(band);
      const face = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 12), new THREE.MeshStandardMaterial({ color: 0xd4a53c, metalness: 0.85, roughness: 0.25 }));
      face.position.copy(wrist).add(new THREE.Vector3(-0.045, 0.01, -0.01));
      face.rotation.z = Math.PI / 2;
      barGroup.add(face);
    }
    // Poignée caoutchouc rainurée + embout d'extrémité
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.22, 16).rotateZ(Math.PI / 2), gripRub);
    grip.position.set(0.46 * s, 0.14, 0.1);
    barGroup.add(grip);
    for (let r = 0; r < 5; r++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.005, 6, 18), gripRub);
      rib.position.set((0.40 + r * 0.03) * s, 0.14, 0.1); rib.rotation.y = Math.PI / 2;
      barGroup.add(rib);
    }
    const capEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.042, 0.03, 16).rotateZ(Math.PI / 2), chrome);
    capEnd.position.set(0.565 * s, 0.14, 0.1);
    barGroup.add(capEnd);
    /* Main réaliste enveloppant la poignée (grip: centre y0.14 z0.10, r0.046).
       Paume bombée drapée sur le dessus, 4 doigts en 3 phalanges qui suivent
       le cercle de la poignée (haut -> avant -> dessous), pouce qui verrouille
       l'arrière. Angles: sur le cercle de rayon 0.058, y=0.14+r·cosθ,
       z=0.10+r·sinθ, capsule tangente => rotation.x = θ + π/2. */
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), skinM);
    palm.position.set(0.455 * s, 0.185, 0.085);
    palm.scale.set(1.0, 0.62, 1.25);
    palm.rotation.x = -0.55;
    palm.castShadow = true;
    barGroup.add(palm);
    // Dos de main : comble le creux entre poignet et paume
    const handBack = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.05, 6, 12), skinM);
    handBack.position.set(0.455 * s, 0.163, 0.148);
    handBack.rotation.x = -0.95;
    barGroup.add(handBack);
    const FING_THETA = [0.7, 1.65, 2.6];
    for (let f = 0; f < 4; f++) {
      const fxp = (0.418 + f * 0.026) * s;
      for (let k = 0; k < 3; k++) {
        const th = FING_THETA[k];
        const rW = 0.058;
        const ph = new THREE.Mesh(new THREE.CapsuleGeometry(0.0135 - k * 0.001, 0.028 - k * 0.002, 6, 10), skinM);
        ph.position.set(fxp, 0.14 + rW * Math.cos(th), 0.10 + rW * Math.sin(th));
        ph.rotation.x = th + Math.PI / 2;
        barGroup.add(ph);
        // La phalange distale est celle qui se resserre avec le gaz/frein
        if (k === 2) { if (s > 0) animRefs.rFingers.push(ph); else animRefs.lFingers.push(ph); }
      }
    }
    // Pouce : 2 segments qui enveloppent l'ARRIÈRE de la poignée (θ négatif)
    const th1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0135, 0.028, 6, 10), skinM);
    th1.position.set(0.416 * s, 0.176, 0.070);
    th1.rotation.x = 1.07;
    barGroup.add(th1);
    const th2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0125, 0.026, 6, 10), skinM);
    th2.position.set(0.418 * s, 0.148, 0.044);
    th2.rotation.x = 0.17;
    barGroup.add(th2);
    if (s > 0) animRefs.rThumb = th2;
    // Gant néoprène SANS DOIGTS (cohérent avec les gants du pilote 3e pers.) :
    // dossière sombre sur le dos de la main + sangle de serrage colorée. Les
    // doigts (peau) dépassent vers la poignée -> lecture "gant de sport".
    const gBack = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.03, 0.088), gloveM);
    gBack.position.set(0.452 * s, 0.176, 0.122); gBack.rotation.x = -0.75; gBack.castShadow = true; barGroup.add(gBack);
    const gStrap = new THREE.Mesh(new THREE.BoxGeometry(0.084, 0.02, 0.03), gloveAcc);
    gStrap.position.set(0.452 * s, 0.166, 0.168); gStrap.rotation.x = -0.95; barGroup.add(gStrap);
  }

  /* ================= PILOTE MIAMI (3e personne) : torse nu bronzé, gilet ouvert,
     lunettes aviateur. Vu surtout DE DOS en chase -> dos/épaules/cheveux soignés. */
  riderBody = new THREE.Group();
  const zc = z => z * scaleF;
  // HAUT DU CORPS articulé autour d'un PIVOT AUX HANCHES (torsoPivot) : il se penche,
  // reporte le poids et absorbe les chocs pendant que bassin + jambes restent plaqués
  // au jet. Animé dans la boucle -> le pilote SUIT vraiment les mouvements du jetski.
  const HPY = 0.96, HPZ = zc(0.83);
  const torsoPivot = new THREE.Group(); torsoPivot.position.set(0, HPY, HPZ);
  torsoPivot.rotation.order = 'ZXY';
  const up = new THREE.Group(); up.position.set(0, -HPY, -HPZ); torsoPivot.add(up);
  riderBody.add(torsoPivot);
  const ball = (x, y, z, r, mat, sx, sy, sz, rx, parent) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat);
    m.position.set(x, y, z); if (sx !== undefined) m.scale.set(sx, sy, sz); if (rx) m.rotation.x = rx;
    m.castShadow = true; (parent || up).add(m); return m;
  };
  // --- Bassin (sous le board short) : PLAQUÉ (hors pivot) ---
  ball(0, 0.90, zc(0.87), 0.185, shortsM, 1.2, 0.82, 1.0, 0, riderBody);
  // --- Tronc musclé : capsule le long de la colonne, aplatie (épaules larges) ---
  const hipP = new THREE.Vector3(0, 0.96, zc(0.84)), shP = new THREE.Vector3(0, 1.15, zc(0.575));
  const trunk = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, hipP.distanceTo(shP), 14, 24), skinM);
  trunk.position.addVectors(hipP, shP).multiplyScalar(0.5);
  trunk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(shP, hipP).normalize());
  trunk.scale.set(1.32, 1.0, 0.8); trunk.castShadow = true; up.add(trunk);
  // Dos (chase) : trapèzes + omoplates + creux de la colonne
  ball(0, 1.14, zc(0.63), 0.14, skinHiM, 1.35, 0.7, 0.7);              // trapèzes
  ball(-0.085, 1.08, zc(0.66), 0.07, skinM, 1.0, 1.2, 0.55);          // omoplate G
  ball(0.085, 1.08, zc(0.66), 0.07, skinM, 1.0, 1.2, 0.55);           // omoplate D
  const spine = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.24, 6, 8), new THREE.MeshStandardMaterial({ color: new THREE.Color(skinColor).multiplyScalar(0.7).getHex(), roughness: 0.55 }));
  spine.position.set(0, 1.05, zc(0.71)); spine.rotation.x = -0.9; up.add(spine); // sillon vertébral (ombre)
  // Pecs (larges et plats) + abdos
  ball(-0.08, 1.065, zc(0.48), 0.08, skinHiM, 1.25, 0.62, 0.62);
  ball(0.08, 1.065, zc(0.48), 0.08, skinHiM, 1.25, 0.62, 0.62);
  for (let a = 0; a < 3; a++) { ball(-0.045, 1.0 - a * 0.05, zc(0.5 + a * 0.02), 0.03, skinM, 1, 0.8, 0.6); ball(0.045, 1.0 - a * 0.05, zc(0.5 + a * 0.02), 0.03, skinM, 1, 0.8, 0.6); }
  // Deltoïdes ÉLARGIS (V-taper athlétique) + grands dorsaux
  ball(-0.258, 1.12, zc(0.585), 0.096, skinHiM);
  ball(0.258, 1.12, zc(0.585), 0.096, skinHiM);
  ball(-0.17, 1.0, zc(0.66), 0.075, skinM, 1.0, 1.6, 0.7);   // lat gauche
  ball(0.17, 1.0, zc(0.66), 0.075, skinM, 1.0, 1.6, 0.7);    // lat droit
  // Tatouage tribal sur l'omoplate droite (signature, visible de dos en chase)
  const tatCv = document.createElement('canvas'); tatCv.width = 128; tatCv.height = 128;
  const tctx = tatCv.getContext('2d'); tctx.clearRect(0, 0, 128, 128);
  tctx.strokeStyle = 'rgba(18,12,22,0.92)'; tctx.lineCap = 'round';
  tctx.lineWidth = 10; tctx.beginPath(); tctx.moveTo(34, 18); tctx.bezierCurveTo(74, 40, 42, 82, 84, 112); tctx.stroke();
  tctx.lineWidth = 8; tctx.beginPath(); tctx.moveTo(58, 14); tctx.bezierCurveTo(98, 46, 72, 86, 100, 108); tctx.stroke();
  tctx.lineWidth = 5; tctx.beginPath(); tctx.moveTo(42, 56); tctx.bezierCurveTo(62, 60, 56, 76, 30, 92); tctx.stroke();
  const tatTex = new THREE.CanvasTexture(tatCv); tatTex.colorSpace = THREE.SRGBColorSpace;
  const tattoo = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.16),
    new THREE.MeshBasicMaterial({ map: tatTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
  // Sur le deltoïde arrière droit (peau nue, jamais couverte par le gilet)
  tattoo.position.set(0.245, 1.13, zc(0.61)); tattoo.rotation.set(0.15, -0.5, 0.15); up.add(tattoo);

  // --- GILET DE SAUVETAGE (PFD) : coque-tube néoprène/nylon clairement PROUD ---
  const vestAxis = new THREE.Vector3().subVectors(shP, hipP).normalize();
  const vestQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vestAxis);
  const vestCenter = new THREE.Vector3().lerpVectors(hipP, shP, 0.44);
  const vestShell = new THREE.Mesh(new THREE.CylinderGeometry(0.212, 0.205, 0.30, 24, 1, true), vestFabM);
  vestShell.position.copy(vestCenter); vestShell.quaternion.copy(vestQuat);
  vestShell.scale.set(1.28, 1.0, 0.94); vestShell.castShadow = true; up.add(vestShell);
  for (let q = 0; q < 2; q++) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.216, 0.216, 0.014, 24, 1, true), strapM);
    ring.position.copy(vestCenter).addScaledVector(vestAxis, 0.06 - q * 0.12);
    ring.quaternion.copy(vestQuat); ring.scale.set(1.28, 1.0, 0.94); up.add(ring);
  }
  const vestTop = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.028, 10, 24), vestFabM2);
  vestTop.position.copy(vestCenter).addScaledVector(vestAxis, 0.15); vestTop.quaternion.copy(vestQuat); vestTop.scale.set(1.28, 0.94, 1.0); up.add(vestTop);
  const frontDir = new THREE.Vector3(0, Math.sin(0.62), -Math.cos(0.62)); // ~normale avant du torse
  const zip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.30, 0.02), buckleM);
  zip.position.copy(vestCenter).addScaledVector(frontDir, 0.19); zip.quaternion.copy(vestQuat); up.add(zip);
  const zipTab = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.02), goldM);
  zipTab.position.copy(vestCenter).addScaledVector(frontDir, 0.20).addScaledVector(vestAxis, 0.08); up.add(zipTab);
  const vestLogo = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14), new THREE.MeshBasicMaterial({ map: numberTex, transparent: true }));
  vestLogo.position.copy(vestCenter).addScaledVector(frontDir, -0.205).addScaledVector(vestAxis, 0.02);
  vestLogo.quaternion.copy(vestQuat); vestLogo.rotateY(Math.PI); up.add(vestLogo);
  for (const s of [-1, 1]) {
    const shStrap = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.30), vestFabM);
    shStrap.position.set(0.15 * s, 1.17, zc(0.585)); shStrap.rotation.x = -0.2; shStrap.castShadow = true; up.add(shStrap);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.03), buckleM);
    buckle.position.copy(vestCenter).addScaledVector(frontDir, 0.17); buckle.position.x = 0.15 * s; up.add(buckle);
  }

  // --- BLING Miami : chaîne en or + médaillon (tenues flashy uniquement) ---
  if (suitCfg.bling) {
    const chain = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.013, 8, 30), goldM);
    chain.position.set(0, 1.135, zc(0.58)); chain.rotation.x = 1.42; chain.scale.set(1.0, 1.25, 1.0);
    chain.castShadow = true; up.add(chain);
    const medal = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.01, 16), goldM);
    medal.position.set(0, 1.055, zc(0.635)); medal.rotation.x = Math.PI / 2 + 0.5; up.add(medal);
  }

  // --- Cou + TÊTE (la tête est un sous-groupe : elle se stabilise à l'horizon) ---
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.07, 0.12, 14), skinM);
  neck.position.set(0, 1.22, zc(0.55)); neck.rotation.x = 0.2; up.add(neck);
  const headPivot = new THREE.Group(); headPivot.position.set(0, 1.27, zc(0.52)); up.add(headPivot);
  const hp = z => z; // les enfants de headPivot sont exprimés en delta autour du cou
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.108, 24, 20), skinM);
  head.position.set(0, 0.04, zc(-0.02)); head.scale.set(0.92, 1.05, 1.0); head.castShadow = true; headPivot.add(head);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), skinM); jaw.position.set(0, -0.015, zc(-0.08)); jaw.scale.set(0.85, 0.8, 0.7); headPivot.add(jaw);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.028, 14, 10), skinM); nose.position.set(0, 0.03, zc(-0.105)); nose.scale.set(0.8, 0.7, 1.0); headPivot.add(nose);
  for (const s of [-1, 1]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), skinM); ear.position.set(0.10 * s, 0.035, zc(-0.015)); ear.scale.set(0.5, 1.0, 0.8); headPivot.add(ear); }
  const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.122, 20, 16, 0, TWO_PI, 0, Math.PI * 0.62), hairM2);
  hairTop.position.set(0, 0.048, zc(-0.015)); hairTop.scale.set(0.98, 1.08, 1.05); hairTop.castShadow = true; headPivot.add(hairTop);
  const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 14), hairM2);
  hairBack.position.set(0, 0.03, zc(0.045)); hairBack.scale.set(0.95, 1.0, 0.7); headPivot.add(hairBack);
  for (const s of [-1, 1]) { const sb = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.05, 6, 8), hairM2); sb.position.set(0.095 * s, 0.0, zc(-0.02)); headPivot.add(sb); }
  for (const s of [-1, 1]) {
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.038, 20), lensM);
    lens.position.set(0.042 * s, 0.045, zc(-0.122)); lens.rotation.y = Math.PI + 0.1 * s; headPivot.add(lens);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.005, 8, 20), goldM);
    rim.position.copy(lens.position); rim.position.z += 0.001; rim.rotation.y = lens.rotation.y; headPivot.add(rim);
    const temple = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.13, 6), goldM);
    temple.position.set(0.075 * s, 0.048, zc(-0.06)); temple.rotation.set(0, 0.2, Math.PI / 2); headPivot.add(temple);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.006), goldM);
  bridge.position.set(0, 0.052, zc(-0.122)); headPivot.add(bridge);
  // --- Signature Miami : chaîne en or au cou (visible nuque/épaules en chase) ---
  const chain = new THREE.Mesh(new THREE.TorusGeometry(0.082, 0.0075, 8, 28), goldM);
  chain.position.set(0, 1.155, zc(0.56)); chain.rotation.x = 1.35; chain.scale.set(1.05, 1, 0.9); up.add(chain);
  const pendant = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.032, 0.01), goldM);
  pendant.position.set(0, 1.095, zc(0.475)); up.add(pendant);
  // --- Bandeau néon coral sur le front (iconique + masque la couture des cheveux) ---
  const bandMat = new THREE.MeshStandardMaterial({ color: 0xff5a7a, roughness: 0.45, emissive: 0x30060f, emissiveIntensity: 0.5 });
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.017, 10, 26), bandMat);
  band.position.set(0, 0.09, zc(-0.01)); band.rotation.x = 0.12; band.scale.set(0.98, 1, 1.04); headPivot.add(band);
  // --- Mèches au vent : elles se rabattent vers l'arrière avec la vitesse (animées) ---
  const hairTufts = [];
  for (let ht = 0; ht < 6; ht++) {
    const a = (ht / 5 - 0.5) * 1.3;
    const tuft = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.085 + Math.random() * 0.04, 5, 8), hairM2);
    tuft.position.set(Math.sin(a) * 0.075, 0.075, zc(0.05));
    tuft.rotation.set(1.15, 0, a * 0.55);
    headPivot.add(tuft);
    hairTufts.push({ mesh: tuft, baseX: 1.15, z: a * 0.55, ph: ht * 1.1 });
  }
  animRefs.hairTufts = hairTufts;

  // --- BRAS : deltoïde -> biceps -> avant-bras -> gant. Meshes sous riderBody (NON
  //     penchés) + une ANCRE d'épaule dans le pivot du torse. Chaque frame on résout
  //     une IK 2 os (épaule mobile -> poignée FIXE sur le guidon) : les mains restent
  //     sur les poignées quand le pilote penche/reporte le poids. ---
  const armRefs = [];
  for (const s of [-1, 1]) {
    const shV = new THREE.Vector3(0.235 * s, 1.11, zc(0.585));
    const elV = new THREE.Vector3(0.40 * s, 0.965, zc(0.14));
    const wrV = new THREE.Vector3(0.455 * s, 0.83, zc(-0.16));
    const shAnchor = new THREE.Object3D(); shAnchor.position.copy(shV); up.add(shAnchor); // suit le torse
    const upper = limbMesh(riderBody, shV, elV, 0.062, 0.052, skinM);
    const biceps = ball(0, 0, 0, 0.05, skinHiM, 1, 1.3, 1, 0, riderBody);
    const elbowB = ball(0, 0, 0, 0.05, skinM, undefined, undefined, undefined, 0, riderBody);
    const fore = limbMesh(riderBody, elV, wrV, 0.05, 0.04, skinM);
    const brach = ball(0, 0, 0, 0.045, skinHiM, 1.1, 1.3, 1.1, 0, riderBody);
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 12), gloveM); fist.scale.set(1.0, 0.95, 1.25); fist.castShadow = true; riderBody.add(fist);
    const knuck = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.028, 0.075), gloveM); riderBody.add(knuck);
    const cuffG = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.042, 0.05, 12), gloveAcc); riderBody.add(cuffG);
    armRefs.push({ s, upper, biceps, elbowB, fore, brach, fist, knuck, cuffG, shAnchor,
      grip: wrV.clone(), L1: shV.distanceTo(elV), L2: elV.distanceTo(wrV) });
  }
  animRefs.torsoPivot = torsoPivot; animRefs.headPivot = headPivot; animRefs.arms = armRefs;
  animRefs.torsoBaseY = HPY; animRefs.up = up;
  riderBody.visible = false;
  ski.add(riderBody);
  window.__rider = riderBody;   // hook d'inspection

  /* ---- Jambes : cuisses en board short + genoux + mollets bronzés + chaussons ---- */
  for (const s of [-1, 1]) {
    const hip = new THREE.Vector3(0.2 * s, 0.74, zc(0.95));
    const knee = new THREE.Vector3(0.31 * s, 0.87, zc(0.30));
    const foot = new THREE.Vector3(0.4 * s, 0.6, zc(0.5));
    // Cuisse (board short) : conique + renflement quadriceps
    const thigh = limbMesh(ski, hip, knee, 0.10, 0.075, shortsM);
    const quad = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 12), shortsM);
    quad.position.lerpVectors(hip, knee, 0.45).add(new THREE.Vector3(0, 0.0, -0.02)); quad.scale.set(1, 1.4, 1); ski.add(quad);
    const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.078, 0.03, 14), shortsM2); // ourlet du short
    hem.position.copy(knee).lerp(hip, 0.12);
    hem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(knee, hip).normalize()); ski.add(hem);
    const kneeB = new THREE.Mesh(new THREE.SphereGeometry(0.062, 14, 12), skinM); kneeB.position.copy(knee); ski.add(kneeB);
    // Mollet bronzé + tibia
    limbMesh(ski, knee, foot, 0.058, 0.04, skinM);
    const calf = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), skinHiM);
    calf.position.lerpVectors(knee, foot, 0.35).add(new THREE.Vector3(0, 0, 0.03)); calf.scale.set(1, 1.5, 1); ski.add(calf);
    // Chausson néoprène
    const bootie = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.075, 0.24), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.85 }));
    bootie.position.set(0.41 * s, 0.6, zc(0.44)); bootie.castShadow = true; ski.add(bootie);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.25), gloveAcc);
    sole.position.set(0.41 * s, 0.565, zc(0.44)); ski.add(sole);
  }

  /* ---- Effets d'eau attachés ---- */
  // Plus de "tapis" blanc plat sous le jet : on ne garde que 2 fines gerbes de
  // proue (jaillissement latéral à vitesse). Le vrai sillage vient du pool
  // wakePuffs en espace-monde (traînée d'écume qui reste derrière), pas d'un
  // plan collé sous la coque.
  const sprayMatBase = { color: 0xf0e2e2, map: foamTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide };
  for (const sx of [-0.7, 0.7]) {
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial(sprayMatBase));
    sp.position.set(sx, 0.1, -0.9);
    sp.rotation.z = sx > 0 ? -0.3 : 0.3;
    ski.add(sp);
    sprays.push(sp);
  }
  // Bouillon de poupe : patch d'écume qui bout juste derrière le tableau
  // arrière (un vrai jet ne montre JAMAIS le dessous de son tableau à l'eau).
  sternWash = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.8).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0, depthWrite: false }));
  sternWash.position.set(0, 0.08, 2.4);
  ski.add(sternWash);
  // Anneau d'écume de contact : collé à la ligne de flottaison chaque frame,
  // c'est LUI qui assoit visuellement la coque dans l'eau (résolution
  // indépendante de la grille océan, contrairement au shader).
  contactRing = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 3.7).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, opacity: 0.42, depthWrite: false })
  );
  contactRing.position.set(0, 0.1, 0.2);
  ski.add(contactRing);
  if (realModel) { ski.add(realModel); alignRideModel(); refreshModelMode(); }
}
function rebuildSki() {
  buildSki();
  if (realModel) realModel.visible = true;
  if (realRiderGroup) realRiderGroup.visible = (typeof camMode !== 'undefined' && camMode !== 'fpv');
  updateRealModelColors();
}

buildSki();

/* ================= CHARGEUR DE MODÈLE .glb RÉEL (optionnel) =================
   Dépose vendor/models/jetski.glb : il s'affiche dans le garage sur un plateau
   tournant. Absent -> le jetski procédural reste utilisé (aucune erreur). */
// Calage du modèle réel une fois attaché au jetski (réglable à chaud via window.__align)
// rotY négatif : la proue (extrémité X négative, la plus fine) doit pointer vers -Z local (l'avant)
const MODEL_RIDE = { rotY: -Math.PI / 2, y: -0.14, scale: 1 };
function alignRideModel() {
  if (!realModel) return;
  realModel.rotation.set(0, MODEL_RIDE.rotY, 0);
  realModel.position.set(0, MODEL_RIDE.y, 0);
  realModel.scale.setScalar(MODEL_RIDE.scale);
}
// Masque le jetski procédural (garde caméra + effets d'eau) quand le modèle réel est là
function refreshModelMode() {
  if (!realModel) return;
  if (realModel.parent !== ski) ski.add(realModel);
  ski.children.forEach(c => {
    // barGroup (bras + mains + guidon) reste géré à part : c'est le cockpit
    // visible en vue 1re personne, on ne le force pas invisible ici.
    if (c === camera || c === realModel || c === barGroup || c === contactRing || sprays.includes(c) || wakes.includes(c) || c === sternWash) return;
    c.visible = false;
  });
  realModel.visible = true;
  updateCockpitVisibility();
}
// Les bras/mains procéduraux servent de cockpit en vue 1re personne : visibles
// seulement en jeu + FPV (masqués au garage et en 3e personne, où c'est le
// pilote réaliste qui prend le relais).
function updateCockpitVisibility() {
  if (barGroup) barGroup.visible = (mode === 'ride' && camMode === 'fpv');
}

// Recadre, oriente et met à l'échelle un objet importé (longueur cible ~4,2 u)
function fitImported(obj, opts) {
  opts = opts || {};
  if (opts.rotX !== undefined) obj.rotation.x = opts.rotX;
  if (opts.rotY !== undefined) obj.rotation.y = opts.rotY;
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  const s = (opts.targetLen || 4.2) / longest;
  const holder = new THREE.Group();
  obj.position.set(-center.x, -center.y, -center.z);
  const inner = new THREE.Group();
  inner.add(obj);
  inner.scale.setScalar(s);
  holder.add(inner);
  return holder;
}

(function tryLoadModel() {
  const objUrl = './vendor/models/jetski.obj';
  const glbUrl = './vendor/models/jetski.glb';
  // DÉSACTIVÉ : on utilise TOUJOURS le jet ski procédural fait main. Avant, un
  // jetski.obj importé se chargeait en async et REMPLAÇAIT le modèle procédural
  // (garage = fait main tant que l'OBJ n'était pas chargé, puis ride = OBJ importé).
  return;
  // eslint-disable-next-line no-unreachable
  fetch(glbUrl, { method: 'HEAD' }).then(res => {
    if (res.ok) return loadGlb(glbUrl);
    return fetch(objUrl, { method: 'HEAD' }).then(r => { if (r.ok) loadObj(objUrl); });
  }).catch(() => {});

  function finalize(holder, label) {
    holder.traverse(m => {
      if (m.isMesh) {
        m.castShadow = true;
        if (m.material) { m.material.envMapIntensity = 0.7; m.material.needsUpdate = true; }
      }
    });
    // Masque un éventuel socle/plan plat inclus dans le fichier (fréquent sur Free3D)
    const meshList = [];
    holder.traverse(m => { if (m.isMesh) meshList.push(m); });
    meshList.forEach(m => {
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox;
      const sx = bb.max.x - bb.min.x, sy = bb.max.y - bb.min.y, sz = bb.max.z - bb.min.z;
      const flat = Math.min(sx, sy, sz);
      const big = Math.max(sx, sy, sz);
      // très plat + très large + peu de sommets = socle
      const verts = m.geometry.attributes.position.count;
      if (flat / big < 0.02 && verts < 20) m.visible = false;
    });
    realModel = holder;
    ski.add(realModel);
    alignRideModel();
    refreshModelMode();
    realRiderGroup = attachRealRider(holder);
    if (realRiderGroup) realRiderGroup.visible = camMode !== 'fpv';
    console.info('[Vice Rider] Modèle réel intégré (garage + pilotage) :', label);
  }
  function loadGlb(url) {
    const draco = new DRACOLoader();
    draco.setDecoderPath('./vendor/jsm/libs/draco/');   // local (jamais atteint : loader désactivé) — pas de CDN externe
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.load(url, gltf => finalize(fitImported(gltf.scene, { targetLen: 4.2 }), url),
      undefined, err => console.warn('[Vice Rider] Échec .glb :', err));
  }
  // Retire le socle plat inclus dans le fichier : détecte l'axe et l'extrême
  // (min ou max) portant le plus grand amas de faces coplanaires, puis les retire.
  function stripGroundPlane(mesh) {
    const g = mesh.geometry;
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    const axes = ['x', 'y', 'z'];
    const getA = (i, a) => a === 'x' ? pos.getX(i) : a === 'y' ? pos.getY(i) : pos.getZ(i);
    // Cherche le meilleur plan (axe + côté) : max de triangles coplanaires à l'extrême
    let best = { axis: 'y', side: 'min', count: 0, plane: 0, eps: 0 };
    for (const a of axes) {
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < pos.count; i++) { const v = getA(i, a); if (v < mn) mn = v; if (v > mx) mx = v; }
      const eps = (mx - mn) * 0.02 || 0.001;
      for (const side of ['min', 'max']) {
        const plane = side === 'min' ? mn : mx;
        let cnt = 0;
        for (let t = 0; t < pos.count; t += 3) {
          const in0 = Math.abs(getA(t, a) - plane) < eps;
          const in1 = Math.abs(getA(t + 1, a) - plane) < eps;
          const in2 = Math.abs(getA(t + 2, a) - plane) < eps;
          if (in0 && in1 && in2) cnt++;
        }
        if (cnt > best.count) best = { axis: a, side, count: cnt, plane, eps };
      }
    }
    if (best.count < 2) return 0;
    const kp = [], ku = [];
    let removed = 0;
    for (let t = 0; t < pos.count; t += 3) {
      const in0 = Math.abs(getA(t, best.axis) - best.plane) < best.eps;
      const in1 = Math.abs(getA(t + 1, best.axis) - best.plane) < best.eps;
      const in2 = Math.abs(getA(t + 2, best.axis) - best.plane) < best.eps;
      if (in0 && in1 && in2) { removed++; continue; }
      for (let k = 0; k < 3; k++) {
        const i = t + k;
        kp.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        if (uv) ku.push(uv.getX(i), uv.getY(i));
      }
    }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(kp, 3));
    if (uv) ng.setAttribute('uv', new THREE.Float32BufferAttribute(ku, 2));
    ng.computeVertexNormals();
    g.dispose();
    mesh.geometry = ng;
    console.info('[Vice Rider] Socle retiré :', removed, 'faces (axe', best.axis, best.side + ')');
    return removed;
  }

  // Sépare un mesh fusionné en deux (coque basse / pont haut) selon la hauteur brute,
  // pour peindre deux couleurs distinctes reliées à la palette du modèle choisi.
  function splitHullDeck(mesh, detailTex) {
    const pos = mesh.geometry.attributes.position;
    const uv = mesh.geometry.attributes.uv;
    let zLo = Infinity, zHi = -Infinity;
    for (let i = 0; i < pos.count; i++) { const z = pos.getZ(i); if (z < zLo) zLo = z; if (z > zHi) zHi = z; }
    const thr = zLo + (zHi - zLo) * 0.42;
    const build = (predicate) => {
      const kp = [], ku = [];
      for (let t = 0; t < pos.count; t += 3) {
        const avgZ = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
        if (!predicate(avgZ)) continue;
        for (let k = 0; k < 3; k++) {
          const i = t + k;
          kp.push(pos.getX(i), pos.getY(i), pos.getZ(i));
          if (uv) ku.push(uv.getX(i), uv.getY(i));
        }
      }
      const ng = new THREE.BufferGeometry();
      ng.setAttribute('position', new THREE.Float32BufferAttribute(kp, 3));
      if (uv) ng.setAttribute('uv', new THREE.Float32BufferAttribute(ku, 2));
      ng.computeVertexNormals();
      return ng;
    };
    // Coque : gelcoat verni brillant mouillé, bas de coque plus métallisé.
    // Le bake gris sert de carte de rugosité ET de reflet spéculaire clearcoat.
    const hullMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.24, metalness: 0.2, roughnessMap: detailTex, clearcoat: 1.0, clearcoatRoughness: 0.08, clearcoatRoughnessMap: detailTex, envMapIntensity: 1.25 });
    // Pont : anti-dérapant plus mat en haut, mais garde un vernis constructeur.
    const deckMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.1, roughnessMap: detailTex, clearcoat: 0.85, clearcoatRoughness: 0.2, envMapIntensity: 1.1 });
    const hullMesh = new THREE.Mesh(build(z => z < thr), hullMat);
    const deckMesh = new THREE.Mesh(build(z => z >= thr), deckMat);
    hullMesh.castShadow = true; deckMesh.castShadow = true; hullMesh.receiveShadow = true; deckMesh.receiveShadow = true;
    return { hullMesh, deckMesh };
  }

  // Pilote détaillé : combinaison + gilet de sauvetage + casque intégral, corps
  // articulé (épaules, coudes, poignets ; hanches, genoux, chevilles), mains
  // fermées sur le guidon virtuel. Position d'assise déduite de la bbox monde
  // pour éviter tout mapping d'axes fragile.
  function attachRealRider(holder) {
    if (!realHullMesh || !realDeckMesh) return null;
    holder.updateWorldMatrix(true, true);
    const hullBox = new THREE.Box3().setFromObject(realHullMesh);
    const deckBox = new THREE.Box3().setFromObject(realDeckMesh);
    const seatWorld = new THREE.Vector3(
      hullBox.min.x + (hullBox.max.x - hullBox.min.x) * 0.5,
      deckBox.max.y - 0.22,
      hullBox.min.z + (hullBox.max.z - hullBox.min.z) * 0.52
    );
    const seatLocal = holder.worldToLocal(seatWorld.clone());
    const g = new THREE.Group();
    g.position.copy(seatLocal);
    g.scale.setScalar(0.94);
    // Le pilote est parenté au modèle OBJ, pivoté de -90° (MODEL_RIDE.rotY) pour
    // aligner la proue. Sans compensation, son "avant" (+Z local) pointe vers le
    // flanc. On le contre-pivote pour qu'il regarde bien vers la proue (-Z du ski).
    // Ordre YXZ : la barre (y) est appliquée en dernier, donc les inclinaisons de
    // corps rotation.z (roulis/penche dans le virage) et rotation.x (avant/arrière)
    // agissent dans le repère du corps -> body English propre par-dessus le cap.
    g.rotation.order = 'YXZ';
    g.rotation.y = -Math.PI / 2;

    const suitCfg = SUITS.find(s => s.id === sel.suit);
    const suitColor = suitCfg.c, accColor = suitCfg.c2;
    // Pilote torse nu, style Miami : peau bronzée (léger reflet mouillé/sueur),
    // couleur de peau du personnage choisi. Le "combinaison" sélectionné teinte
    // le short de bain (short = seul textile recoloré via realSuitMats).
    const skinColor = PILOTES.find(p => p.id === sel.pilote).skin;
    const skinMat = new THREE.MeshPhysicalMaterial({ color: skinColor, roughness: 0.48, metalness: 0.0, sheen: 0.55, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xffe4cc), clearcoat: 0.28, clearcoatRoughness: 0.45, envMapIntensity: 0.6 });
    const shortsMat = new THREE.MeshPhysicalMaterial({ color: suitColor, roughness: 0.55, metalness: 0.0, sheen: 0.4, sheenColor: new THREE.Color(0xffffff), clearcoat: 0.2, clearcoatRoughness: 0.4, envMapIntensity: 0.7 });
    const waistMat = new THREE.MeshStandardMaterial({ color: accColor, roughness: 0.5, metalness: 0.1 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x241812, roughness: 0.88 });
    const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x090c12, roughness: 0.05, metalness: 0.6, clearcoat: 1.0, clearcoatRoughness: 0.04, envMapIntensity: 1.5 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.35, metalness: 0.35 });
    realSuitMats = [shortsMat];

    // Membre fuselé (cylindre plein), orienté entre 2 points ; sphères aux
    // articulations pour lisser. Jamais openEnded (sinon tubes creux visibles).
    function limb(p1, p2, r1, r2, mat, cast) {
      const dir = new THREE.Vector3().subVectors(p2, p1);
      const len = dir.length();
      const geo = new THREE.CylinderGeometry(r2, r1, len, 16);
      const m = new THREE.Mesh(geo, mat);
      m.position.addVectors(p1, p2).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      if (cast !== false) m.castShadow = true;
      return m;
    }
    function ball(pos, r, mat, cast) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 16), mat);
      m.position.copy(pos);
      if (cast !== false) m.castShadow = true;
      return m;
    }

    // === Bassin + short de bain (couvre hanches -> mi-cuisse) ===
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.185, 22, 18), shortsMat);
    pelvis.scale.set(1.08, 0.72, 0.92); pelvis.position.set(0, 0.055, -0.01); pelvis.castShadow = true;
    g.add(pelvis);
    // Ceinture / cordon de serrage accent
    const waistband = new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.168, 0.055, 22), waistMat);
    waistband.position.set(0, 0.155, 0.01); waistband.scale.set(1, 1, 0.92); g.add(waistband);

    // === Ventre nu (taille fine) -> torse en V ===
    g.add(limb(new THREE.Vector3(0, 0.14, 0.01), new THREE.Vector3(0, 0.34, 0.11), 0.132, 0.152, skinMat));
    // Nombril (petit creux foncé) + ligne alba suggérée par 2 rangées d'abdos
    for (const yy of [0.21, 0.28]) for (const s of [-1, 1]) {
      const ab = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), skinMat);
      ab.scale.set(1, 0.8, 0.5); ab.position.set(s * 0.05, yy, 0.155); g.add(ab);
    }
    // Poitrine + pectoraux
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.178, 22, 18), skinMat);
    chest.scale.set(1.12, 0.82, 0.72); chest.position.set(0, 0.42, 0.13); chest.rotation.x = 0.30; chest.castShadow = true;
    g.add(chest);
    for (const s of [-1, 1]) {
      const pec = new THREE.Mesh(new THREE.SphereGeometry(0.078, 16, 12), skinMat);
      pec.scale.set(1.0, 0.66, 0.55); pec.position.set(s * 0.072, 0.40, 0.205); pec.rotation.x = 0.30; g.add(pec);
    }
    // Haut du dos nu (arrondi)
    const upperBack = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 14, 0, Math.PI), skinMat);
    upperBack.scale.set(1.05, 0.95, 0.78); upperBack.position.set(0, 0.41, 0.075); upperBack.rotation.set(0.30, Math.PI, 0);
    g.add(upperBack);

    // === Épaules (deltoïdes nus) + trapèzes ===
    for (const s of [-1, 1]) g.add(ball(new THREE.Vector3(s * 0.195, 0.485, 0.09), 0.083, skinMat));
    const traps = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skinMat);
    traps.scale.set(1.4, 0.5, 0.7); traps.position.set(0, 0.50, 0.04); g.add(traps);

    // === Cou + tête réaliste (mâchoire, nez), sans casque ===
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.062, 0.10, 14), skinMat);
    neck.position.set(0, 0.565, 0.055); neck.rotation.x = 0.18; g.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.102, 26, 22), skinMat);
    head.scale.set(0.94, 1.06, 1.0); head.position.set(0, 0.655, 0.05); head.castShadow = true; g.add(head);
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.078, 18, 14), skinMat);
    jaw.scale.set(0.9, 0.72, 0.92); jaw.position.set(0, 0.605, 0.082); g.add(jaw);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.019, 0.05, 10), skinMat);
    nose.rotation.x = Math.PI / 2 + 0.35; nose.position.set(0, 0.638, 0.15); g.add(nose);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), skinMat);
      ear.scale.set(0.5, 1.0, 0.7); ear.position.set(s * 0.098, 0.652, 0.03); g.add(ear);
    }

    // === Cheveux courts mouillés (calotte plaquée + repousse nuque) ===
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.11, 22, 18, 0, TWO_PI, 0, Math.PI * 0.6), hairMat);
    hair.scale.set(1.0, 1.06, 1.04); hair.position.set(0, 0.665, 0.028); hair.castShadow = true; g.add(hair);
    const nape = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), hairMat);
    nape.scale.set(0.95, 0.6, 0.7); nape.position.set(0, 0.64, -0.02); g.add(nape);

    // === Lunettes de soleil (façon Miami Vice) ===
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.012, 0.014), frameMat);
    bridge.position.set(0, 0.667, 0.145); g.add(bridge);
    for (const s of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.04, 0.014), lensMat);
      lens.position.set(s * 0.046, 0.664, 0.142); lens.rotation.y = -s * 0.28; g.add(lens);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.044, 0.016), frameMat);
      rim.position.set(s * 0.046, 0.664, 0.140); rim.rotation.y = -s * 0.28; g.add(rim);
      const temple = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.009, 0.009), frameMat);
      temple.position.set(s * 0.093, 0.668, 0.088); temple.rotation.y = s * 0.55; g.add(temple);
    }

    // === Bras nus (biceps -> coude -> avant-bras -> main sur le guidon) ===
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Vector3(side * 0.195, 0.485, 0.09);
      const elbow = new THREE.Vector3(side * 0.245, 0.34, 0.34);
      const wrist = new THREE.Vector3(side * 0.28, 0.27, 0.57);
      g.add(limb(shoulder, elbow, 0.06, 0.048, skinMat));   // biceps
      g.add(ball(elbow, 0.05, skinMat));
      g.add(limb(elbow, wrist, 0.048, 0.04, skinMat));       // avant-bras
      // Main nue refermée autour de la poignée (formes bombées, pas de cubes)
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 10), skinMat);
      palm.position.set(side * 0.29, 0.262, 0.62); palm.scale.set(1.1, 0.8, 1.35);
      palm.rotation.set(0.5, 0, 0); palm.castShadow = true;
      g.add(palm);
      const fingers = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.062, 6, 10), skinMat);
      fingers.rotation.set(0.35, 0, Math.PI / 2); fingers.position.set(side * 0.29, 0.234, 0.653);
      g.add(fingers);
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.04, 6, 8), skinMat);
      thumb.rotation.set(0.6, 0, side * 0.5); thumb.position.set(side * 0.256, 0.255, 0.635);
      g.add(thumb);
    }

    // === Jambes : short sur le haut de cuisse, peau nue en dessous, tongs ===
    for (const side of [-1, 1]) {
      const hip = new THREE.Vector3(side * 0.13, 0.02, 0.03);
      const knee = new THREE.Vector3(side * 0.21, -0.10, 0.26);
      const ankle = new THREE.Vector3(side * 0.20, -0.30, 0.14);
      const midThigh = hip.clone().lerp(knee, 0.55);
      g.add(limb(hip, midThigh, 0.11, 0.095, shortsMat));    // bas de short baggy
      g.add(limb(midThigh, knee, 0.088, 0.074, skinMat));     // bas de cuisse nu
      g.add(ball(knee, 0.076, skinMat));
      g.add(limb(knee, ankle, 0.07, 0.05, skinMat));          // tibia nu
      g.add(ball(ankle, 0.048, skinMat, false));
      // Pied nu + tong (semelle + lanière)
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.05, 0.17), skinMat);
      foot.position.set(side * 0.20, -0.335, 0.20); foot.castShadow = true; g.add(foot);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.02, 0.19), frameMat);
      sole.position.set(side * 0.20, -0.368, 0.205); g.add(sole);
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.016, 0.045), waistMat);
      strap.position.set(side * 0.20, -0.312, 0.20); g.add(strap);
    }

    holder.add(g);
    return g;
  }

  function loadObj(url) {
    // La texture livrée est un niveau de gris (bake d'ombrage) : on s'en sert
    // comme carte de rugosité/détail, pas comme couleur, et on peint le gelcoat.
    const detail = new THREE.TextureLoader().load('./vendor/models/jetski.jpg', t => { t.flipY = false; });
    detail.flipY = false;
    new OBJLoader().load(url, obj => {
      let targetMesh = null;
      obj.traverse(m => { if (m.isMesh) targetMesh = m; });
      if (targetMesh) {
        stripGroundPlane(targetMesh);
        const { hullMesh, deckMesh } = splitHullDeck(targetMesh, detail);
        const parent = targetMesh.parent || obj;
        parent.remove(targetMesh);
        parent.add(hullMesh, deckMesh);
        realHullMesh = hullMesh; realDeckMesh = deckMesh;
        updateRealModelColors();
      }
      // Export 3ds Max = Z-up : bascule en Y-up
      finalize(fitImported(obj, { targetLen: 3.8, rotX: -Math.PI / 2 }), url);
    }, undefined, err => console.warn('[Vice Rider] Échec .obj :', err));
  }
})();

/* ================= COMPTEUR À ROULEAUX ================= */
function drawOdo(kmh, thr, brand, reverse) {
  if (!gctx) return;
  gctx.fillStyle = '#0a0710';
  gctx.fillRect(0, 0, 256, 160);
  // Léger glow de contour néon (le tableau de bord "brille")
  gctx.strokeStyle = reverse ? '#ffb020' : '#ff5c8a';
  gctx.lineWidth = 4;
  gctx.strokeRect(5, 5, 246, 150);
  gctx.fillStyle = '#4defe0';
  gctx.font = '700 15px Menlo, monospace';
  gctx.textAlign = 'left';
  gctx.fillText(reverse ? 'REVERSE' : brand.toUpperCase(), 16, 26);
  gctx.textAlign = 'right';
  gctx.fillText('KM/H', 240, 26);
  const H = 78, W = 56, y0 = 38;
  const v = Math.max(kmh, 0);
  const places = [100, 10, 1];
  for (let i = 0; i < 3; i++) {
    const p = places[i];
    const x = 40 + i * (W + 8);
    gctx.fillStyle = '#1c1220';
    gctx.fillRect(x, y0, W, H);
    const d = Math.floor(v / p) % 10;
    let frac;
    if (p === 1) frac = v - Math.floor(v);
    else frac = Math.max(0, (v % p) - (p - 1));
    const dim = v < p && d === 0 && p > 1;
    gctx.save();
    gctx.beginPath();
    gctx.rect(x, y0, W, H);
    gctx.clip();
    gctx.fillStyle = dim ? '#3a2433' : '#ff6b86';
    gctx.font = '800 64px Menlo, monospace';
    gctx.textAlign = 'center';
    const cx = x + W / 2, cy = y0 + H / 2 + 22;
    gctx.fillText(String(d), cx, cy - frac * H);
    gctx.fillText(String((d + 1) % 10), cx, cy + H - frac * H);
    gctx.restore();
  }
  gctx.fillStyle = '#3a2433';
  gctx.fillRect(40, 128, 176, 8);
  gctx.fillStyle = '#35e0e0';
  gctx.fillRect(40, 128, 176 * thr, 8);
  gaugeTex.needsUpdate = true;
}

/* ================= GOUTTES SUR L'OBJECTIF ================= */
const dropsWrap = document.getElementById('drops');
const drops = [];
for (let i = 0; i < 16; i++) {
  const d = document.createElement('div');
  d.style.cssText = 'position:absolute; border-radius:50%; background:rgba(240,225,235,0.45); border:1px solid rgba(255,255,255,0.3); pointer-events:none; opacity:0;';
  dropsWrap.appendChild(d);
  drops.push({ el: d, life: 0, vy: 0, top: 0 });
}
function lensDrops(n) {
  let added = 0;
  for (const d of drops) {
    if (added >= n) break;
    if (d.life <= 0) {
      const sz = 5 + Math.random() * 14;
      d.el.style.width = sz + 'px';
      d.el.style.height = sz * (1 + Math.random() * 0.4) + 'px';
      d.el.style.left = (8 + Math.random() * 84) + '%';
      d.top = 5 + Math.random() * 55;
      d.life = 1;
      d.vy = 2 + Math.random() * 6;
      added++;
    }
  }
}

/* ================= AUDIO ================= */
let audio = null, muted = false;
function initAudio() {
  if (audio) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Bus master + compresseur : moteur, embruns et musique se partagent la scène
    // sans saturer (glue façon mixage arcade).
    const master = ctx.createGain(); master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 22; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.25;
    master.connect(comp).connect(ctx.destination);

    // --- MOTEUR : saw + square + sub sinus (grondement) sous un lowpass ---
    const osc1 = ctx.createOscillator(); osc1.type = 'sawtooth';
    const osc2 = ctx.createOscillator(); osc2.type = 'square';
    const sub = ctx.createOscillator(); sub.type = 'sine';
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 320;
    const eGain = ctx.createGain(); eGain.gain.value = 0;
    osc1.connect(filter); osc2.connect(filter); sub.connect(filter);
    filter.connect(eGain).connect(master);
    osc1.start(); osc2.start(); sub.start();
    // Sifflement de turbine (aigu), monte avec le régime.
    const whine = ctx.createOscillator(); whine.type = 'triangle'; whine.frequency.value = 1200;
    const wGain = ctx.createGain(); wGain.gain.value = 0;
    whine.connect(wGain).connect(master); whine.start();

    // --- SIRÈNE DE POLICE (positionnelle) : wail deux-tons, panoramique + doppler ---
    const siren = ctx.createOscillator(); siren.type = 'sawtooth'; siren.frequency.value = 750;
    const sirenLp = ctx.createBiquadFilter(); sirenLp.type = 'lowpass'; sirenLp.frequency.value = 1700; sirenLp.Q.value = 0.9;
    const sirGain = ctx.createGain(); sirGain.gain.value = 0;
    const sirPan = ctx.createStereoPanner();
    siren.connect(sirenLp).connect(sirGain).connect(sirPan).connect(master); siren.start();
    // --- MOTEUR d'un JET IA proche (positionnel) : ronflement qui passe (doppler) ---
    const aiOsc = ctx.createOscillator(); aiOsc.type = 'sawtooth'; aiOsc.frequency.value = 80;
    const aiLp = ctx.createBiquadFilter(); aiLp.type = 'lowpass'; aiLp.frequency.value = 520;
    const aiGain = ctx.createGain(); aiGain.gain.value = 0;
    const aiPan = ctx.createStereoPanner();
    aiOsc.connect(aiLp).connect(aiGain).connect(aiPan).connect(master); aiOsc.start();

    // --- BRUIT : sillage de coque + gerbes ---
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = nb.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = nb; noise.loop = true;
    const nFilter = ctx.createBiquadFilter(); nFilter.type = 'bandpass'; nFilter.frequency.value = 700; nFilter.Q.value = 0.6;
    const nGain = ctx.createGain(); nGain.gain.value = 0;
    noise.connect(nFilter).connect(nGain).connect(master);
    const sFilter = ctx.createBiquadFilter(); sFilter.type = 'lowpass'; sFilter.frequency.value = 1100;
    const sGain = ctx.createGain(); sGain.gain.value = 0;
    noise.connect(sFilter).connect(sGain).connect(master);
    noise.start();

    // --- MUSIQUE synthwave : bus dédié + écho à la double-croche pointée ---
    const musicBus = ctx.createGain(); musicBus.gain.value = 0;
    const musDelay = ctx.createDelay(0.6); musDelay.delayTime.value = (60 / 104 / 4) * 3;
    const musFb = ctx.createGain(); musFb.gain.value = 0.3;
    const musWet = ctx.createGain(); musWet.gain.value = 0.32;
    musicBus.connect(master);
    musicBus.connect(musDelay); musDelay.connect(musFb); musFb.connect(musDelay);
    musDelay.connect(musWet); musWet.connect(master);
    // Court buffer de bruit pour caisse claire / charleston.
    const dnb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate);
    const dd = dnb.getChannelData(0);
    for (let i = 0; i < dd.length; i++) dd[i] = Math.random() * 2 - 1;

    audio = { ctx, master, osc1, osc2, sub, filter, eGain, whine, wGain, nGain, sGain,
      siren, sirenLp, sirGain, sirPan, aiOsc, aiLp, aiGain, aiPan,
      musicBus, noiseBuf: dnb, music: { bpm: 104, step: 0, nextTime: 0 } };
  } catch (e) { audio = null; }
}

/* ---- Séquenceur synthwave (Miami 1986) : Am–F–C–G, arpège + basse + batterie ---- */
const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);
const MUSIC_CHORDS = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]]; // Am F C G
const MUSIC_BASS = [33, 29, 36, 31];                                            // A1 F1 C2 G1
function mNote(freq, when, dur, type, peak, cutoff) {
  const { ctx, musicBus } = audio;
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = ctx.createGain();
  if (cutoff) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; o.connect(f); f.connect(g); }
  else o.connect(g);
  g.connect(musicBus);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(peak, when + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.start(when); o.stop(when + dur + 0.03);
}
function mKick(when) {
  const { ctx, musicBus } = audio;
  const o = ctx.createOscillator(); o.type = 'sine';
  const g = ctx.createGain(); o.connect(g); g.connect(musicBus);
  o.frequency.setValueAtTime(150, when); o.frequency.exponentialRampToValueAtTime(45, when + 0.12);
  g.gain.setValueAtTime(0.85, when); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.24);
  o.start(when); o.stop(when + 0.26);
}
function mNoise(when, dur, peak, type, hz, q) {
  const { ctx, musicBus, noiseBuf } = audio;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q || 1;
  const g = ctx.createGain();
  s.connect(f); f.connect(g); g.connect(musicBus);
  g.gain.setValueAtTime(peak, when); g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  s.start(when); s.stop(when + dur + 0.03);
}
function musicStep(step, when, spb) {
  const bar = Math.floor(step / 16) % 4, s = step % 16;
  const chord = MUSIC_CHORDS[bar];
  if (s % 4 === 0) mNote(midiHz(MUSIC_BASS[bar]), when, spb * 3.6, 'sawtooth', 0.5, 300);      // basse
  const arp = chord[s % chord.length] + 12;                                                    // arpège aigu
  mNote(midiHz(arp), when, spb * 1.4, 'square', 0.12, 2200);
  if (s === 0) for (const n of chord) mNote(midiHz(n), when, spb * 15, 'triangle', 0.05, 1000); // nappe
  if (s === 0 || s === 8) mKick(when);
  if (s === 4 || s === 12) mNoise(when, 0.18, 0.26, 'bandpass', 1800, 1.1);                     // caisse
  if (s % 2 === 0) mNoise(when, 0.035, 0.08, 'highpass', 8500, 0.7);                            // charley
}
function musicTick() {
  if (!audio || !audio.music) return;
  const { ctx, music } = audio;
  const spb = 60 / music.bpm / 4;               // durée d'une double-croche
  const ahead = ctx.currentTime + 0.18;
  if (music.nextTime < ctx.currentTime) music.nextTime = ctx.currentTime + 0.06;
  while (music.nextTime < ahead) {
    musicStep(music.step, music.nextTime, spb);
    music.step = (music.step + 1) % 64;
    music.nextTime += spb;
  }
  audio.musicBus.gain.setTargetAtTime(muted ? 0 : 0.17, ctx.currentTime, 0.12);
}
/* Spatialisation légère d'une source (sx,sz) de vélocité (svx,svz), écoutée depuis
   le jet (position/cap/vélocité du joueur) : renvoie {gain, pan, pitch}. Pan gauche/
   droite selon le gisement, atténuation avec la distance, doppler exagéré (arcade)
   sur la vitesse radiale relative. Approche = pitch ↑, éloignement = pitch ↓. */
function spatialAudio(sx, sz, svx, svz, refDist, maxGain) {
  const rX = sx - state.x, rZ = sz - state.z;
  const dist = Math.hypot(rX, rZ) || 0.001;
  const nX = rX / dist, nZ = rZ / dist;
  const rgx = Math.cos(state.yaw), rgz = -Math.sin(state.yaw);   // tribord (droite écran)
  const pan = Math.max(-1, Math.min(1, nX * rgx + nZ * rgz));
  const gain = maxGain * (refDist / (refDist + dist));           // atténuation douce
  const vrad = (svx - state.vx) * nX + (svz - state.vz) * nZ;    // >0 = s'éloigne
  const pitch = Math.max(0.82, Math.min(1.2, 1 - vrad / 70));    // doppler arcade
  return { gain, pan, pitch, dist };
}
function audioSplash(power) {
  if (!audio || muted) return;
  const g = audio.sGain.gain;
  const now = audio.ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(Math.min(0.3 * power, 0.4), now);
  g.exponentialRampToValueAtTime(0.001, now + 0.5);
}

/* ================= INTÉGRATION CRAZYGAMES (pubs + événements) =================
   Le SDK n'existe que sur crazygames.com ; partout ailleurs (GitHub Pages, local)
   window.CrazyGames est absent -> tout est en fallback et le jeu tourne normalement.
   Règle CrazyGames : pendant une pub, on COUPE le son (master à 0) et on met le jeu
   en pause. On reprend à la fin (ou en cas d'erreur). */
const CG = { sdk: null, ready: false, env: 'disabled', lastAdMs: -999999, ridesStarted: 0, boostNextRide: false };
window.__cg = CG;   // debug : forcer __cg.env='disabled' en test pour bypasser les pubs simulées
let adPaused = false;
async function initCrazyGames() {
  try {
    const S = window.CrazyGames && window.CrazyGames.SDK;
    if (!S) return;
    await S.init();
    CG.sdk = S; CG.ready = true;
    try { CG.env = S.environment || 'disabled'; } catch (e) { CG.env = 'disabled'; }
    cgCall(s => s.game.loadingStart());   // encadre le chargement (loadingStop appelé au boot)
  } catch (e) { CG.sdk = null; }
}
function cgCall(fn) { try { if (CG.sdk) fn(CG.sdk); } catch (e) { /* no-op */ } }
function cgLoadingStop() { cgCall(s => s.game.loadingStop()); }
function cgGameplayStart() { cgCall(s => s.game.gameplayStart()); }
function cgGameplayStop() { cgCall(s => s.game.gameplayStop()); }
function cgHappytime() { cgCall(s => s.game.happytime()); }
function adSilence(on) {
  adPaused = on;
  if (audio) audio.master.gain.setTargetAtTime(on ? 0 : 0.9, audio.ctx.currentTime, 0.05);
}
// Pub interstitielle entre deux runs (jamais au 1er run, cooldown 100 s).
function cgInterstitial() {
  if (!CG.sdk || CG.env === 'disabled' || CG.ridesStarted <= 1) return;
  const now = performance.now();
  if (now - CG.lastAdMs < 100000) return;
  CG.lastAdMs = now;
  cgCall(s => s.ad.requestAd('midgame', {
    adStarted: () => adSilence(true),
    adFinished: () => adSilence(false),
    adError: () => adSilence(false)
  }));
}
// Pub récompensée : accorde `onReward` à la fin. En standalone (pas de SDK), on
// accorde direct (il n'y a de toute façon aucune pub à regarder).
function cgRewarded(onReward) {
  // Hors CrazyGames (SDK absent ou désactivé) : aucune pub à montrer -> récompense directe.
  if (!CG.sdk || CG.env === 'disabled') { onReward(); return; }
  CG.lastAdMs = performance.now();
  cgCall(s => s.ad.requestAd('rewarded', {
    adStarted: () => adSilence(true),
    adFinished: () => { adSilence(false); onReward(); },
    adError: () => { adSilence(false); }
  }));
}
document.getElementById('btn-mute').addEventListener('click', () => {
  muted = !muted;
  document.getElementById('btn-mute').textContent = muted ? '🔇' : '🔊';
});

/* ================= ÉTAT & CONTRÔLES ================= */
let mode = 'menu';
let camMode = 'fpv';
const CAM_BASE = new THREE.Vector3(0, 1.36, 0.8);
// state.vx/vz = vecteur vitesse MONDE (vraie inertie). state.speed = composante
// vers l'avant (signée), conservée pour le HUD, les effets et le hull-push.
// rpm = régime turbine (0..~1.2, monte/descend avec inertie, s'emballe hors de l'eau).
// yawRate = vitesse de lacet (inertie de rotation : la barre applique un couple).
const state = { x: 0, z: 0, yaw: 0, speed: 0, vx: 0, vz: 0, throttle: 0, rudder: 0, rpm: 0, yawRate: 0, pitch: 0, roll: 0, y: 0, vy: 0, air: false, airTime: 0, bestAir: 0, showAirUntil: 0 };
let PHYS = { max: 30, thrust: 8, dragLin: 0.1, dragQuad: 0.008, dragLatQ: 0.06, gripLo: 3.4, gripHi: 1.1, planeLo: 8, planeHi: 18, steerBase: 0.12, steerThrust: 1.0, turn: 2.0 };
// Hauteur d'assiette au repos (origine du ski au-dessus de la surface). ↑ = le
// jet monte / a l'air de flotter ; ↓ = il s'enfonce. Réglable à chaud : window.__vice.setDraft(v).
// Calé pour que le bas de coque (-0.79 local) s'asseye AU FOND de la cuvette
// que le shader creuse sous le jet (-0.5 au repos) : bas à hw-0.45, juste au
// ras du fond de cuvette, bourrelet +0.3 qui remonte sur les flancs.
let DRAFT_REST = TUNING.hull.draftRest;   // réglable à chaud via window.__vice.setDraft(v)
function computePhys() {
  const cfg = MODELS.find(m => m.id === sel.ski);
  const vmax = cfg.top / 3.6;                         // vitesse de pointe (m/s)
  const ratio = cfg.hp / cfg.weight;                  // ~0.4 (lourd) .. 0.95 (race)
  const accel0 = Math.max(5.5, Math.min(9.5, 3.2 + 6.2 * ratio)); // accél. départ plein gaz
  const dragLin = 0.10;                               // traînée linéaire faible -> erre longue
  // Vitesse de pointe atteinte quand poussée = traînée AU PLANAGE (coque déjaugée,
  // traînée réduite ×0.55) : accel0 = dragQuad·0.55·vmax² + dragLin·vmax.
  const dragQuad = Math.max(0.003, (accel0 - dragLin * vmax) / (0.55 * vmax * vmax));
  PHYS = {
    max: vmax,
    thrust: accel0,                                   // accél. de poussée à plein gaz
    dragLin, dragQuad,
    dragLatQ: 0.06,                                   // traînée latérale quadratique
    gripLo: 3.6,                                      // grip latéral fort à basse vitesse (suit le nez)
    gripHi: 1.0,                                      // grip faible au planage -> dérive/drift
    planeLo: vmax * 0.30,                             // début de déjaugeage
    planeHi: vmax * 0.62,                             // planage établi
    steerBase: cfg.style === 'luxe' ? 0.16 : 0.11,   // assistance de barre hors-gaz (faible)
    steerThrust: 1.0,                                 // gros gain de barre proportionnel au gaz
    turn: cfg.style === 'race' ? 2.0 : cfg.style === 'fun' ? 2.4 : 1.5,
    yawResp: cfg.style === 'race' ? 6.5 : cfg.style === 'fun' ? 7.5 : 5.0, // inertie de lacet (↑ = plus vif)
    spoolUp: 3.6, spoolDown: 2.4                      // montée/descente en régime de la turbine
  };
}
const keys = {};
let slamCd = 0, camImpact = 0;
let plunge = 0, lastPlunge = 0;
// État caméra FPV : offsets lissés des forces G (la tête/le corps réagit à
// l'accél, aux virages, aux chocs) + suivi de la vitesse pour dériver l'accél.
const camG = { x: 0, z: 0, pitch: 0, roll: 0, yaw: 0 };
let camPrevSpeed = 0, camJolt = 0;
// Punch de FOV (accélération), "thunk" de suspension (atterrissage) : canaux dédiés.
let fovKick = 0, fovPrevSpeed = 0, camLand = 0;
// Bruit de valeur lissé (1D) : grain organique pour casser la périodicité des sinus
// de vibration caméra. Déterministe, sans état, pas cher.
const _vhash = x => { const s = Math.sin(x * 12.9898) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
const vnoise = x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return _vhash(i) * (1 - u) + _vhash(i + 1) * u; };
// Objectif mouillé (0..1) : monte aux gerbes/impacts, sèche progressivement.
let lensWet = 0;
// --- FIGURES AÉRIENNES (tricks) : rotations accumulées pendant le vol (rad).
//     Barrel roll (roulis, touches gauche/droite) + flips (tangage, haut/bas/espace).
let trickRoll = 0, trickPitch = 0;
const trickHud = { until: 0, name: '', pts: '' };
const trickNameEl = document.getElementById('hud-trick');
const trickTxtEl = document.getElementById('hud-trick-name');
const trickPtsEl = document.getElementById('hud-trick-pts');
function showTrick(name, pts) {
  trickHud.until = simTime + 1.8; trickHud.name = name; trickHud.pts = pts;
  if (trickTxtEl) trickTxtEl.textContent = name;
  if (trickPtsEl) trickPtsEl.textContent = pts;
  if (trickNameEl) { trickNameEl.style.opacity = '1'; trickNameEl.style.transform = 'translateX(-50%) scale(1)'; }
}
// Évaluation d'un saut à l'atterrissage : compte les rotations complètes réussies
// (barrel rolls + flips), award le score, popup, et lâche une grosse gerbe.
function scoreTrick(fx, fz) {
  const t = simTime;
  const hw = waveHeight(state.x, state.z, t);
  const air = state.airTime;
  const spd = Math.hypot(state.vx, state.vz);
  // Grosse gerbe d'atterrissage, d'autant plus imposante que le saut fut long/rapide.
  const gp = Math.min(0.6 + air * 0.9 + spd / PHYS.max, 2.4);
  spawnSplash(state.x, hw, state.z, gp);
  burstDrops(state.x, hw + 0.1, state.z, 30 + Math.floor(air * 40 + spd), 0.7 + gp * 0.5, fx * state.speed, fz * state.speed);
  lensDrops(4 + Math.floor(air * 6));
  camImpact = Math.max(camImpact, Math.min(0.14 + air * 0.2, 0.5));
  camJolt = Math.max(camJolt, Math.min(0.6 + air * 1.4, 2.4));
  audioSplash(Math.min(0.4 + air * 0.5, 0.9));

  missionReach('air', air);   // défi "reste Xs en l'air"
  // Trop court pour être une figure -> juste la gerbe.
  if (air < 0.32) return;
  if (air > 0.5) { missionAdd('jumps', 1); CH.jumps++; }   // défi "fais des sauts"
  const rollTurns = trickRoll / TWO_PI, flipTurns = trickPitch / TWO_PI;
  const nRoll = Math.round(rollTurns), nFlip = Math.round(flipTurns);
  const nr = Math.abs(nRoll), nf = Math.abs(nFlip);
  // Une figure n'est "tentée" que si la rotation est nette et VOLONTAIRE (>~240°).
  // Un simple saut de vague en tenant A/D (~3,6 rad) ne compte donc PAS comme une
  // vrille -> plus de "wipeout" injuste qui coupait la vitesse sur chaque vague.
  const attempted = Math.abs(trickRoll) > 4.2 || Math.abs(trickPitch) > 4.2;
  const clean = Math.abs(rollTurns - nRoll) < 0.18 && Math.abs(flipTurns - nFlip) < 0.18;

  if (!attempted) {
    // Saut normal : big air si conséquent, JAMAIS de pénalité de vitesse.
    if (air > 0.95) { const pts = 200 + Math.floor(air * 260); CH.score += pts; gainCoins(Math.floor(pts / 15)); showTrick('BIG AIR', '+' + pts); }
    return;
  }
  if (!clean) {
    // Vraie tentative ratée à la réception : pas de points, MAIS on garde la vitesse
    // (juste une secousse) -> le jeu ne s'arrête plus, il reste fluide.
    showTrick('presque !', '');
    camJolt = Math.max(camJolt, 1.0);
    return;
  }
  let pts = 0; const parts = [];
  if (nf > 0) { pts += nf * 750; parts.push((nf > 1 ? nf + '× ' : '') + (nFlip > 0 ? 'BACKFLIP' : 'FRONTFLIP')); }
  if (nr > 0) { pts += nr * 550; parts.push((nr > 1 ? nr + '× ' : '') + 'BARREL ROLL'); }
  if (air > 0.95) { pts += 200; parts.push('BIG AIR'); }
  const combo = nr + nf;
  if (combo > 1) pts = Math.round(pts * (1 + 0.4 * (combo - 1)));   // bonus multi-figure
  CH.score += pts;
  if (nf > 0) missionAdd('flip', 1);        // défi "réussis un salto"
  gainCoins(Math.floor(pts / 15));          // les figures paient des pièces
  // NB : on n'écrit PAS CH.maxCombo ici — c'est le compteur du défi "Combo x3
  // aux portes" (progress = CH.maxCombo/target) ; une figure ne doit pas le remplir.
  showTrick(parts.join(' + '), '+' + pts.toLocaleString('fr-FR'));
}
const _sunProj = new THREE.Vector3(), _camDir = new THREE.Vector3();
function updateFilm(t, sf, wet) {
  if (!filmPass) return;
  const u = filmPass.uniforms;
  u.uTime.value = t;
  u.uSpeed.value = sf;
  u.uWet.value = wet;
  u.uAspect.value = window.innerWidth / Math.max(1, window.innerHeight);
  // Position ÉCRAN du soleil : on projette un point lointain dans sa direction ;
  // z = cap caméra · direction soleil (>0 = soleil devant l'objectif).
  camera.getWorldDirection(_camDir);
  _sunProj.copy(camera.position).addScaledVector(sunDir, 3000).project(camera);
  u.uSun.value[0] = _sunProj.x * 0.5 + 0.5;
  u.uSun.value[1] = _sunProj.y * 0.5 + 0.5;
  u.uSun.value[2] = _camDir.dot(sunDir);
}
window.__tune = TUNING;   // réglage du feel à chaud en test (physique flottaison + caméra)
window.__audio = () => audio;   // inspection/réglage audio en test (nœuds, gains live)
window.__vice = { state, keys, toggleCam: () => toggleCam(), setNight: v => setNight(v), islands: palmIslands, gate, CH, DEFIS, enterDefi, ai: aiSkis, buoys: raceBuoys, path: BUOY_PATH, setDraft: v => { DRAFT_REST = v; return DRAFT_REST; }, getDraft: () => DRAFT_REST };
window.__align = (o) => { Object.assign(MODEL_RIDE, o || {}); alignRideModel(); return { ...MODEL_RIDE }; };
window.__analyzeModel = () => {
  if (!realModel) return 'no model';
  let mesh = null;
  realModel.traverse(m => { if (m.isMesh) mesh = m; });
  if (!mesh) return 'no mesh';
  const pos = mesh.geometry.attributes.position;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); if (x < lo) lo = x; if (x > hi) hi = x; }
  const span = hi - lo;
  const bucket = (predicate) => {
    let yLo = Infinity, yHi = -Infinity, zLo = Infinity, zHi = -Infinity, n = 0;
    for (let i = 0; i < pos.count; i++) {
      if (predicate(pos.getX(i))) {
        const y = pos.getY(i), z = pos.getZ(i);
        if (y < yLo) yLo = y; if (y > yHi) yHi = y;
        if (z < zLo) zLo = z; if (z > zHi) zHi = z;
        n++;
      }
    }
    if (!n) return { n: 0 };
    return { n, wy: (yHi - yLo).toFixed(2), wz: (zHi - zLo).toFixed(2) };
  };
  const p = 0.08;
  return {
    xRange: [lo.toFixed(1), hi.toFixed(1)],
    lowExtreme: bucket(x => x < lo + span * p),
    highExtreme: bucket(x => x > hi - span * p),
    vertCount: pos.count
  };
};
window.__debug = { scene, camera, THREE, ski, realHullMesh: () => realHullMesh, realDeckMesh: () => realDeckMesh, realRiderGroup: () => realRiderGroup, tick: () => frame() };
window.__debug.wh = (x, z) => waveHeight(x || 0, z || 0, simTime);
window.__debug.rideGeom = () => {
  // Bas de coque exprimé dans le repère LOCAL du ski (indépendant de ski.position.y).
  const b = new THREE.Box3().setFromObject(realHullMesh);
  const skiY = ski.position.y;
  const hullBottomLocal = b.min.y - skiY;   // relatif à l'origine du ski
  const hullTopLocal = b.max.y - skiY;
  const hw = waveHeight(state.x, state.z, simTime);
  const rideOriginY = hw + DRAFT_REST;       // draft au repos (planing 0)
  return {
    hw: hw.toFixed(3),
    hullBottomLocal: hullBottomLocal.toFixed(3),
    hullTopLocal: hullTopLocal.toFixed(3),
    rideOriginY: rideOriginY.toFixed(3),
    hullBottomWorldRide: (rideOriginY + hullBottomLocal).toFixed(3),
    hullTopWorldRide: (rideOriginY + hullTopLocal).toFixed(3),
    gapBottomToWater: (rideOriginY + hullBottomLocal - hw).toFixed(3),  // >0 = vole, <0 = immergé
    gapTopToWater: (rideOriginY + hullTopLocal - hw).toFixed(3)
  };
};
window.__meshBounds = () => {
  const hull = realHullMesh, deck = realDeckMesh;
  if (!hull || !deck) return null;
  const bh = new THREE.Box3().setFromObject(hull);
  const bd = new THREE.Box3().setFromObject(deck);
  return {
    hullMin: [bh.min.x.toFixed(2), bh.min.y.toFixed(2), bh.min.z.toFixed(2)],
    hullMax: [bh.max.x.toFixed(2), bh.max.y.toFixed(2), bh.max.z.toFixed(2)],
    deckMin: [bd.min.x.toFixed(2), bd.min.y.toFixed(2), bd.min.z.toFixed(2)],
    deckMax: [bd.max.x.toFixed(2), bd.max.y.toFixed(2), bd.max.z.toFixed(2)]
  };
};
window.__rawToWorld = (x, y, z) => {
  if (!realRiderGroup || !realRiderGroup.parent) return null;
  const parent = realRiderGroup.parent;
  const v = new THREE.Vector3(x, y, z);
  parent.updateWorldMatrix(true, false);
  parent.localToWorld(v);
  return [v.x.toFixed(3), v.y.toFixed(3), v.z.toFixed(3)];
};
window.__bbox = () => {
  if (!realModel) return 'no model';
  const b = new THREE.Box3().setFromObject(realModel);
  const s = new THREE.Vector3(); b.getSize(s);
  const c = new THREE.Vector3(); b.getCenter(c);
  return { size: [s.x.toFixed(2), s.y.toFixed(2), s.z.toFixed(2)], center: [c.x.toFixed(2), c.y.toFixed(2), c.z.toFixed(2)] };
};

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'escape' && mode === 'ride') { requestGarage(); return; }
  if (k === 'c' && mode === 'ride') { toggleCam(); return; }
  if (k === 'n') { setNight(!isNight); return; }
  if (['w', 'a', 's', 'd', 'z', 'q', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) {
    keys[k] = true;
    if (mode === 'ride') e.preventDefault();
  }
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
function bindBtn(id, key) {
  const b = document.getElementById(id);
  const on = e => { keys[key] = true; e.preventDefault(); };
  const off = () => { keys[key] = false; };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointerleave', off);
  b.addEventListener('pointercancel', off);
}
bindBtn('btn-fast', 'w'); bindBtn('btn-slow', 's'); bindBtn('btn-port', 'a'); bindBtn('btn-stbd', 'd');
// Manettes tactiles plein écran (mobile) : ◄ ► à gauche, ▲ ▼ à droite
bindBtn('t-fast', 'w'); bindBtn('t-slow', 's'); bindBtn('t-left', 'a'); bindBtn('t-right', 'd');
const touchPad = document.getElementById('touch');
document.getElementById('btn-cam').addEventListener('click', () => { if (mode === 'ride') toggleCam(); });
const btnNight = document.getElementById('btn-night');
if (btnNight) btnNight.addEventListener('click', () => cycleTOD());
document.getElementById('btn-garage').addEventListener('click', requestGarage);
{
  // Révéler les coffres sur la minimap contre une pub (hook exploration).
  const br = document.getElementById('btn-reveal');
  if (br) br.addEventListener('click', () => {
    if (mode !== 'ride') return;
    if (treasuresRevealed) { toast('Trésors déjà révélés'); return; }
    cgRewarded(() => { treasuresRevealed = true; toast('💰 Trésors révélés sur la carte !'); });
  });
}
document.getElementById('btn-ride').addEventListener('click', startRide);
// TURBO DÉPART : le joueur regarde une pub récompensée -> son prochain run démarre boosté.
{
  const bb = document.getElementById('btn-boost');
  if (bb) bb.addEventListener('click', () => {
    if (CG.boostNextRide) return;   // déjà armé
    cgRewarded(() => {
      CG.boostNextRide = true;
      bb.textContent = '✓ BOOST ARMÉ';
      bb.style.borderColor = '#35e0e0';
    });
  });
}

function startRide() {
  computePhys();
  mode = 'ride';
  // On démarre en vue CHASE (3e personne) pour montrer le pilote Miami tout de
  // suite : le cockpit FPV reste dispo d'une touche 'C'. Avant, le jeu ouvrait en
  // FPV -> le pilote n'était jamais visible sans presser C (source de confusion).
  camMode = 'chase';
  ski.visible = true;
  scene.attach(camera);
  if (riderBody) riderBody.visible = !realModel;
  if (realRiderGroup) realRiderGroup.visible = true;
  updateCockpitVisibility();
  setSeaLifeVisible(true);
  setFleetVisible(true);
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  touchPad.classList.remove('hidden');
  const hint = document.getElementById('hint');
  hint.style.opacity = '1';
  setTimeout(() => { hint.style.opacity = '0'; }, 3500);
  initAudio();
  if (audio && audio.ctx.state === 'suspended') audio.ctx.resume();
  applyQuality();
  CH.score = 0; CH.combo = 0; CH.comboTimer = 0; CH.gatesPassed = 0;
  enterDefi(0);
  placeGate(0, -1);
  gate.visible = true;
  chalPanel.style.display = 'block';
  // Méta-jeu : monde ouvert (collectibles), plein de carburant, run neuf.
  runActive = true; runEnding = false; runPaused = false;
  runCoins = 0; fuel = 1; heat = 0; chaseOn = false; caughtTimer = 0;
  lowFuelWarned = false; offshoreCredit = false;
  policeTimer = 70 + Math.random() * 40;   // laisse respirer avant la 1re poursuite
  police.visible = false; policeFoam.visible = false;
  seedWorld(); collectiblesVisible(true);
  document.getElementById('game-coins').classList.remove('hidden');
  document.getElementById('fuel-wrap').classList.remove('hidden');
  document.getElementById('minimap').classList.remove('hidden');
  document.getElementById('game-coin-bal').textContent = save.coins.toLocaleString('fr-FR');
  document.getElementById('fuel-fill').style.width = '100%';
  save.totalRuns++; persist();
  // CrazyGames : signale le début de partie + pub interstitielle entre les runs.
  CG.ridesStarted++;
  cgInterstitial();
  cgGameplayStart();
  // TURBO DÉPART (récompense de pub) : lance le run pied au plancher.
  if (CG.boostNextRide) {
    CG.boostNextRide = false;
    state.rpm = 1.0; state.throttle = 1;
    const bf = 24, bfx = -Math.sin(state.yaw), bfz = -Math.cos(state.yaw);
    state.vx = bfx * bf; state.vz = bfz * bf; state.speed = bf;
    const bb = document.getElementById('btn-boost');
    if (bb) { bb.textContent = '🎁 TURBO DÉPART'; bb.style.borderColor = 'rgba(255,210,60,0.6)'; }
  }
}
function toGarage() {
  cgGameplayStop();   // CrazyGames : fin de partie
  mode = 'menu';
  scene.attach(camera);
  state.x = 0; state.z = 0; state.speed = 0; state.vx = 0; state.vz = 0; state.throttle = 0; state.rpm = 0; state.yawRate = 0; state.yaw = 0; state.air = false;
  state.y = 0; state.vy = 0; plunge = 0; lastPlunge = 0;
  ski.position.set(0, 0, 0);
  if (realRiderGroup) realRiderGroup.visible = true;
  updateCockpitVisibility();
  document.getElementById('menu').classList.remove('hidden');
  document.getElementById('hud').classList.add('hidden');
  touchPad.classList.add('hidden');
  chalPanel.style.display = 'none';
  gate.visible = false;
  hidePickups();
  uwEl.style.opacity = '0';
  setSeaLifeVisible(false);
  setFleetVisible(false);
  // Méta-jeu : ferme le run, masque HUD éco + collectibles, rafraîchit garage.
  runActive = false; runEnding = false; runPaused = false; chaseOn = false;
  police.visible = false; policeFoam.visible = false;
  collectiblesVisible(false);
  document.getElementById('game-coins').classList.add('hidden');
  document.getElementById('fuel-wrap').classList.add('hidden');
  document.getElementById('minimap').classList.add('hidden');
  document.getElementById('runend').classList.add('hidden');
  updateCoinUI(); renderMissions(); refreshSkiCards(); refreshSuitCards();
  // Coupe TOUTES les voix moteur (dont le sifflement de turbine, sa propre
  // branche) : le frame() ne repasse pas dans le bloc audio en mode menu.
  if (audio) { audio.eGain.gain.value = 0; audio.nGain.gain.value = 0; audio.wGain.gain.value = 0; audio.sirGain.gain.value = 0; audio.aiGain.gain.value = 0; }
  // Popup de figure : forcer masquage (sinon reste affiché si on quitte < 1,8 s après un trick).
  if (trickNameEl) { trickNameEl.style.opacity = '0'; trickNameEl.style.transform = 'translateX(-50%) scale(0.7)'; }
  trickHud.until = 0;
}
function toggleCam() {
  // Cycle 3 vues : chase 6 m -> chase 2 m -> FPV -> chase 6 m
  const order = ['chase', 'chaseNear', 'fpv'];
  const wasFpv = camMode === 'fpv';
  const i = order.indexOf(camMode);
  camMode = order[(i + 1) % order.length];
  if (camMode === 'fpv') {
    ski.add(camera);
    camera.position.copy(CAM_BASE);
    camera.rotation.set(-0.17, 0, 0);
  } else if (wasFpv) {
    scene.attach(camera);   // on repasse en caméra monde
  }
  if (riderBody) riderBody.visible = camMode !== 'fpv' && !realModel;
  if (realRiderGroup) realRiderGroup.visible = camMode !== 'fpv';
  updateCockpitVisibility();
}

/* ================= QUALITÉ / POST ================= */
let composer = null, bloomPass = null, bloomOn = true;
function applyQuality() {
  const q = QUALITIES.find(q => q.id === sel.quality);
  pixelRatioCap = q.pr;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
  renderer.shadowMap.enabled = q.shadow > 0;
  if (q.shadow > 0) sun.shadow.mapSize.set(q.shadow, q.shadow);
  sun.castShadow = q.shadow > 0;
  buildOcean(q.segs);
  bloomOn = q.bloom;
  setupComposer();
  resize(true);
}
// Grain argentique + vignette subtils : casse le rendu "trop propre" du temps réel
let filmPass = null;
function setupComposer() {
  // Libère les render targets de la passe précédente (évite la fuite VRAM
  // à chaque cycle garage→ride, qui provoquait un context-lost sur mobile).
  if (composer) composer.dispose();
  if (bloomPass) bloomPass.dispose();
  composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.addPass(new RenderPass(scene, camera));
  if (bloomOn) {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.5, 0.9);
    composer.addPass(bloomPass);
    applyNightBloom();   // réapplique le bloom "nuit" après un changement de qualité
  }
  filmPass = new ShaderPass(FilmShader);
  composer.addPass(filmPass);
}

/* ================= JOUR / CRÉPUSCULE MIAMI =================
   Bascule un grade "nuit" global : exposition, soleil, ambiance, brouillard,
   bloom et le grade uNight (ciel + eau). Le néon des tours et leurs reflets
   dans l'eau prennent alors toute leur ampleur. */
const NIGHT_FOG = new THREE.Color(0x131a30);
let isNight = false;
const dayState = { exposure: 0.95, sunI: sun.intensity, hemiI: hemi.intensity,
  sunC: sun.color.clone(), hemiC: hemi.color.clone(), hemiG: hemi.groundColor.clone() };
/* ---- CYCLE JOUR→COUCHER→NUIT continu (n : 0 = plein jour, 1 = nuit) ---- */
const NIGHT_SUN = new THREE.Color(0x9db4ff), NIGHT_HEMI = new THREE.Color(0x3a4a80), NIGHT_GROUND = new THREE.Color(0x0a1226);
const SUNSET_SUN = new THREE.Color(0xff8a45), SUNSET_FOG = new THREE.Color(0xff9a6a);
const _todSun = new THREE.Color(), _todHemi = new THREE.Color(), _todGround = new THREE.Color(), _todFog = new THREE.Color(), _todTrim = new THREE.Color();
const _ocFog = new THREE.Color();   // couleur de brouillard océan dédiée (ne mute pas FOG_COLOR partagé)
const lerpN = (a, b, t) => a + (b - a) * t;
let todMode = 'auto', todPhase = 0.12, todCur = 0, todApplied = -1, todInit = false;
const TOD_PERIOD = 210;   // durée d'un cycle complet jour+nuit (s)
function applyNightBloom() {
  if (!bloomPass) return;
  bloomPass.strength = lerpN(0.22, 0.5, todCur); bloomPass.threshold = lerpN(0.9, 0.58, todCur); bloomPass.radius = lerpN(0.5, 0.7, todCur);
}
function applyTOD(n) {
  isNight = n > 0.5; uNight.value = n;
  const sunset = Math.max(0, 1 - Math.abs(n - 0.5) * 2.6);   // pic de coucher/lever
  uSunset.value = Math.min(1, sunset * 1.2);                 // dégradé orange/rose/violet + gros soleil
  const winN = smooth01((n - 0.32) / 0.5);                    // lumières qui s'allument au crépuscule
  const reflN = smooth01((n - 0.28) / 0.55);
  renderer.toneMappingExposure = lerpN(dayState.exposure, 0.5, n);
  sun.intensity = lerpN(dayState.sunI, 0.45, n);
  hemi.intensity = lerpN(dayState.hemiI, 0.5, n);
  _todSun.copy(dayState.sunC).lerp(NIGHT_SUN, n).lerp(SUNSET_SUN, sunset * 0.6); sun.color.copy(_todSun);
  _todHemi.copy(dayState.hemiC).lerp(NIGHT_HEMI, n); hemi.color.copy(_todHemi);
  _todGround.copy(dayState.hemiG).lerp(NIGHT_GROUND, n); hemi.groundColor.copy(_todGround);
  _todFog.copy(FOG_COLOR).lerp(NIGHT_FOG, n).lerp(SUNSET_FOG, sunset * 0.5);
  scene.fog.color.copy(_todFog); _ocFog.copy(_todFog); oceanUniforms.uFogColor.value = _ocFog;
  for (const m of towerWindowMats) m.emissiveIntensity = lerpN(WIN_DAY, WIN_NIGHT, winN);
  for (const t of neonTrims) t.mat.color.copy(_todTrim.copy(t.day).lerp(t.night, winN));
  for (const r of towerReflections) r.material.opacity = lerpN(REFL_DAY, REFL_NIGHT, reflN);
  applyNightBloom();
}
function todTarget() {
  if (todMode === 'day') return 0;
  if (todMode === 'night') return 1;
  if (todMode === 'hold') return todCur;   // debug/tests : fige n
  const p = todPhase;                       // auto : jour -> coucher (long) -> nuit -> lever
  if (p < 0.38) return 0;
  if (p < 0.54) return smooth01((p - 0.38) / 0.16);   // coucher cinématique (~34 s)
  if (p < 0.88) return 1;
  return 1 - smooth01((p - 0.88) / 0.12);             // lever (~25 s)
}
function updateTOD(dt) {
  if (todMode === 'auto') todPhase = (todPhase + dt / TOD_PERIOD) % 1;
  // Capture l'état "jour" réel une fois le HDRI chargé (évite un jour délavé au boot).
  if (!todInit) {
    if (simTime < 2) return;
    dayState.exposure = renderer.toneMappingExposure; dayState.sunI = sun.intensity; dayState.hemiI = hemi.intensity;
    dayState.sunC.copy(sun.color); dayState.hemiC.copy(hemi.color); dayState.hemiG.copy(hemi.groundColor); todInit = true;
  }
  const tgt = todTarget();
  todCur += (tgt - todCur) * (1 - Math.exp(-dt * 1.5));
  if (Math.abs(todCur - tgt) < 0.002) todCur = tgt;
  if (Math.abs(todCur - todApplied) > 0.0015) { applyTOD(todCur); todApplied = todCur; }
}
// Compat (touche N + tests) : bascule en mode manuel jour/nuit.
function setNight(on) { todMode = on ? 'night' : 'day'; updateBtnNight(); }
// Bouton HUD : cycle auto -> jour -> nuit -> auto.
function cycleTOD() { todMode = todMode === 'auto' ? 'day' : todMode === 'day' ? 'night' : 'auto'; updateBtnNight(); }
function updateBtnNight() {
  const btn = document.getElementById('btn-night');
  if (!btn) return;
  btn.textContent = todMode === 'auto' ? '🌗' : todMode === 'day' ? '☀️' : '🌙';
  btn.title = todMode === 'auto' ? 'Cycle auto jour/nuit' : todMode === 'day' ? 'Jour (forcé) — clic : nuit' : 'Nuit (forcée) — clic : auto';
}
updateBtnNight();
window.__tod = { setMode: m => { todMode = m; updateBtnNight(); }, setPhase: p => { todPhase = p; }, hold: n => { todMode = 'hold'; todInit = true; todCur = n; todApplied = -1; applyTOD(n); }, get n() { return todCur; }, get mode() { return todMode; } };
setupComposer();

function resize(force) {
  const w = window.innerWidth, h = window.innerHeight;
  const pr = renderer.getPixelRatio();
  if (force || canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) {
    renderer.setSize(w, h, false);
    if (composer) { composer.setPixelRatio(pr); composer.setSize(w, h); }
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}
window.addEventListener('resize', () => resize(true));
resize(true);

/* ================= FPS + auto-qualité ================= */
const fpsEl = document.getElementById('hud-fps');
let frames = 0, fpsTime = 0, fps = 60, lowFpsTime = 0;

/* ================= HUD refs ================= */
const hudSpeed = document.getElementById('hud-speed');
const hudHeading = document.getElementById('hud-heading');
const spFill = document.getElementById('sp-fill');   // arc de vitesse (compteur)
const spThr = document.getElementById('sp-thr');     // arc de gaz (intérieur)
const hudBest = document.getElementById('hud-best');
const hudAir = document.getElementById('hud-air');
const chalPanel = document.getElementById('chal');
const chalScore = document.getElementById('chal-score');
const chalCombo = document.getElementById('chal-combo');
const chalTxt = document.getElementById('chal-txt');
const chalBar = document.getElementById('chal-bar');
const toastEl = document.getElementById('toast');
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 1700);
}
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

/* ================= BOUCLE ================= */
const chaseTarget = new THREE.Vector3();
// Vecteurs de travail réutilisables pour l'IK des bras du pilote (évite le GC/frame).
const _ikS = new THREE.Vector3(), _ikE = new THREE.Vector3(), _ikAxis = new THREE.Vector3(),
  _ikPole = new THREE.Vector3(), _ikPerp = new THREE.Vector3(), _ikRest = new THREE.Vector3(),
  _ikUp = new THREE.Vector3(0, 1, 0), _ikDir = new THREE.Vector3(), _ikMid = new THREE.Vector3();
const _ikQuat = new THREE.Quaternion();
function setBone(mesh, p1, p2) {
  _ikMid.addVectors(p1, p2).multiplyScalar(0.5); mesh.position.copy(_ikMid);
  _ikDir.subVectors(p2, p1).normalize(); mesh.quaternion.setFromUnitVectors(_ikUp, _ikDir);
}
let last = performance.now();
let simTime = 0;
let gaugeTick = 0;

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  let dt = Math.min((now - last) / 1000, 0.05);
  if (dt <= 0) dt = 0.016;
  last = now;
  // Pause pendant une pub CrazyGames OU le panneau de fin de run : on gèle la
  // simulation (son coupé via le master) mais on continue à rendre l'image figée.
  if (adPaused || runPaused) { composer.render(); return; }
  simTime += dt;
  const t = simTime;
  resize(false);
  oceanUniforms.uTime.value = t;
  musicTick();   // séquenceur synthwave (joue au menu comme en jeu)
  updateTOD(dt); // cycle jour/nuit automatique (tourne aussi au menu)

  // FPS
  frames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fps = Math.round(frames / fpsTime);
    fpsEl.textContent = fps + ' fps';
    frames = 0; fpsTime = 0;
    if (mode === 'ride' && fps < 38) {
      lowFpsTime += 0.5;
      if (lowFpsTime >= 4 && renderer.getPixelRatio() > 1) {
        renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() - 0.25));
        resize(true);
        lowFpsTime = 0;
        console.info('Auto-qualité : pixel ratio réduit à', renderer.getPixelRatio());
      }
    } else lowFpsTime = 0;
  }

  if (mode === 'menu') {
    // Garage : plateau tournant. Modèle réel s'il est fourni (enfant de ski), sinon procédural.
    const hw = waveHeight(0, 0, t);
    ski.visible = true;
    ski.position.set(0, hw * 0.4, 0);
    if (contactRing) {
      contactRing.visible = true;
      contactRing.position.y = hw - ski.position.y + 0.05;
      contactRing.material.opacity = 0.28 + 0.06 * Math.sin(t * 2.2);
      contactRing.scale.set(0.85, 1, 0.85);
    }
    if (!window.__camFreeze) {
      ski.rotation.y = t * 0.3;
      ski.rotation.x = Math.sin(t * 0.7) * 0.02;
      ski.rotation.z = Math.sin(t * 0.55) * 0.03;
    }
    if (!window.__camFreeze) {
      const a = t * 0.05;
      camera.position.set(Math.sin(a * 0) * 0 + 3.6 * Math.cos(a), 1.9 + Math.sin(t * 0.2) * 0.15, 3.6 * Math.sin(a) + 3.2);
      camera.lookAt(0, 0.6, 0);
    }
    ocean.position.set(0, 0, 0);
    sky.position.set(0, 0, 0);
    // La cuvette + bourrelet doivent rester SOUS le jet exposé au garage
    // (sinon, au retour d'une session, ils restent au large -> jet posé sur
    // une eau rigide, exactement le look "au-dessus de l'eau").
    oceanUniforms.uHullPos.value.set(0, ski.position.y, 0);
    oceanUniforms.uHullFwd.value.set(0, 0, -1);
    oceanUniforms.uHullSpeed.value = 0;
    sun.position.copy(sunDir).multiplyScalar(40);
    sun.target.position.set(0, 0, 0);
    updateFilm(t, 0, 0);
    composer.render();
    return;
  }

  /* ---- Pilotage ---- */
  const up = keys['w'] || keys['z'] || keys['arrowup'];
  const down = keys['s'] || keys['arrowdown'];
  const left = keys['a'] || keys['q'] || keys['arrowleft'];
  const right = keys['d'] || keys['arrowright'];
  // En l'air, ces touches pilotent les FIGURES (roll/flip) — on gèle donc la barre
  // et les gaz pour ne pas atterrir avec un rudder/throttle bloqué à fond (sinon
  // maintenir gauche pour un barrel roll clouait la barre à -1 -> virage sec à la réception).
  if (!state.air) {
    // Gâchette de gaz vers l'avant, gâchette de marche arrière (iBR façon Sea-Doo) au repos/frein
    if (up) state.throttle += dt * 0.7;
    else if (down) state.throttle -= dt * 0.9;
    else state.throttle *= Math.exp(-dt * 1.5);
    state.throttle = Math.max(-0.28, Math.min(1, state.throttle));
    const steering = left ? -1 : right ? 1 : 0;
    if (steering !== 0) state.rudder = Math.max(-1, Math.min(1, state.rudder + steering * dt * 4));
    else state.rudder *= Math.exp(-dt * 6);
  }

  /* ---- MODÈLE PHYSIQUE PWC À FORCES (vecteur vitesse 2D + turbine + inertie) ----
     On décompose la vitesse monde dans le repère de la coque (avant / latéral),
     on applique poussée du jet + traînées + grip latéral, puis on recompose. */
  const fx = -Math.sin(state.yaw), fz = -Math.cos(state.yaw);   // avant
  const rx = Math.cos(state.yaw), rz = -Math.sin(state.yaw);    // tribord
  let vForward = state.vx * fx + state.vz * fz;
  let vLat = state.vx * rx + state.vz * rz;
  const spd = Math.hypot(state.vx, state.vz);
  const speedF = Math.min(spd / PHYS.max, 1);
  // Planage : au-delà d'un seuil la coque déjauge (moins de surface mouillée).
  const planing = smooth01((spd - PHYS.planeLo) / (PHYS.planeHi - PHYS.planeLo));
  const thrust = state.throttle;                                // consigne signée (arrière < 0)

  // --- Ventilation : la pompe pousse de l'eau seulement si elle est immergée.
  //     En l'air (ou coque très haute), elle ventile -> plus de poussée, et le
  //     moteur s'emballe (régime libre) puis remord à l'impact. ---
  const ventilated = state.air || plunge > 0.14;
  // --- Régime turbine : monte/descend avec inertie ; s'emballe si ventilée. ---
  const rpmTarget = ventilated ? Math.max(0.9, Math.abs(state.throttle)) : Math.abs(state.throttle);
  const spool = rpmTarget > state.rpm ? PHYS.spoolUp : PHYS.spoolDown;
  state.rpm += (rpmTarget - state.rpm) * (1 - Math.exp(-dt * spool));
  // Poussée effective : régime × immersion (nulle si ventilée), sens = signe gaz.
  const jetDir = state.throttle >= 0 ? 1 : -0.5;
  const jetThrust = ventilated ? 0 : state.rpm * jetDir;

  if (!state.air) {
    const aThrust = jetThrust * PHYS.thrust;
    // Traînée longitudinale : quadratique (domine à vitesse) + linéaire (erre
    // longue à basse vitesse). Réduite au planage ; augmentée par le dérapage
    // (coque en travers = plus de surface) et par le labour de proue hors-gaz.
    const dragMul = 1 - 0.45 * planing;
    const slipDragMul = 1 + Math.min(Math.abs(vLat) * 0.14, 1.4);
    const aDragF = -(PHYS.dragQuad * dragMul * slipDragMul * vForward * Math.abs(vForward) + PHYS.dragLin * vForward);
    vForward += (aThrust + aDragF) * dt;
    // Labour de proue : couper les gaz à vitesse enfonce le nez -> décél. accrue.
    const plow = Math.max(0, speedF - Math.abs(state.throttle));
    vForward -= plow * 2.0 * Math.sign(vForward || 1) * dt;
    // Grip latéral : la coque résiste au dérapage (elle suit son nez). Fort à
    // basse vitesse (précis), faible au planage (l'arrière décroche = drift).
    const grip = PHYS.gripLo + (PHYS.gripHi - PHYS.gripLo) * planing;
    vLat += (-grip * vLat - PHYS.dragLatQ * vLat * Math.abs(vLat)) * dt;
  } else {
    // En l'air : plus de poussée ni de grip, quasi que de l'inertie.
    vForward -= PHYS.dragLin * 0.25 * vForward * dt;
    vLat *= Math.exp(-dt * 0.5);
  }

  // Recompose la vitesse monde et avance selon le VECTEUR vitesse (vraie inertie,
  // pas selon le cap) : c'est ce qui donne le momentum et le drift du jet.
  state.vx = fx * vForward + rx * vLat;
  state.vz = fz * vForward + rz * vLat;
  state.speed = vForward;                                       // signé, pour HUD/effets
  state.x += state.vx * dt;
  state.z += state.vz * dt;

  // ---- Direction : vectorisation du jet, pilotée par le RÉGIME (pas la consigne
  //      brute) -> latence de réponse réaliste. Hors-gaz : autorité minime
  //      (assistance). Plein régime : virage franc. Besoin d'un peu d'écoulement. ----
  const steerAuth = PHYS.steerBase + PHYS.steerThrust * (ventilated ? 0 : state.rpm);
  const flow = smooth01(spd / 3.0);
  const turnAuthority = state.air ? 0.14 : 1;
  const revSign = vForward < -0.3 ? -1 : 1;                     // barre inversée en marche arrière
  // Inertie de rotation : la barre vise un taux de lacet, atteint avec inertie
  // (le jet a du poids -> léger retard à l'entrée et sur-virage à la relâche).
  const targetYawRate = state.rudder * PHYS.turn * steerAuth * flow * turnAuthority * revSign;
  state.yawRate += (targetYawRate - state.yawRate) * (1 - Math.exp(-dt * PHYS.yawResp));
  state.yaw -= state.yawRate * dt;

  // Îles : collision + recyclage
  for (const isl of palmIslands) {
    const dx = state.x - isl.g.position.x, dz = state.z - isl.g.position.z;
    const d = Math.hypot(dx, dz);
    const minD = isl.r * 1.2 + 1.5;
    if (d < minD && d > 0.01) {
      state.x = isl.g.position.x + (dx / d) * minD;
      state.z = isl.g.position.z + (dz / d) * minD;
      const kc = Math.exp(-dt * 10); state.vx *= kc; state.vz *= kc; state.speed *= kc;
    }
    if (d > 1400) {
      const ang = Math.atan2(fx, fz) + (Math.random() - 0.5) * 2.2;
      const dist = 350 + Math.random() * 320;
      isl.g.position.set(state.x + Math.sin(ang) * dist, 0, state.z + Math.cos(ang) * dist);
    }
  }
  const skd = Math.hypot(state.x - (skyline.position.x + 950), state.z - skyline.position.z);
  if (skd > 2600) skyline.position.set(state.x + fx * 1000 - 950, 0, state.z + fz * 1000);
  // Feux d'aviation rouges : clignotement lent et décalé par tour.
  for (let b = 0; b < beacons.length; b++) {
    const bl = 0.55 + 0.45 * Math.sin(t * 3.0 + b * 1.7);
    beacons[b].scale.setScalar(0.7 + bl * 0.6);
    beacons[b].material.opacity = bl;
  }

  // Rochers isolés : collision dure + recyclage
  for (const rk of seaRocks) {
    const dx = state.x - rk.m.position.x, dz = state.z - rk.m.position.z;
    const d = Math.hypot(dx, dz);
    const minD = rk.r + 1.2;
    if (d < minD && d > 0.01) {
      state.x = rk.m.position.x + (dx / d) * minD;
      state.z = rk.m.position.z + (dz / d) * minD;
      if (state.speed > 6) {
        spawnSplash(state.x, state.y, state.z, 1.0);
        burstDrops(state.x, state.y, state.z, 20, 0.9, 0, 0);
        audioSplash(0.8);
        camImpact = Math.max(camImpact, 0.25);
      }
      const kc = Math.exp(-dt * 14); state.vx *= kc; state.vz *= kc; state.speed *= kc;
    }
    if (d > 1300) {
      rk.m.position.set(state.x + fx * (400 + Math.random() * 400) + rx * (Math.random() - 0.5) * 600, 0.6, state.z + fz * (400 + Math.random() * 400) + rz * (Math.random() - 0.5) * 600);
    }
  }

  /* ---- Flottaison + sauts : modèle de coque PLANANTE ---- */
  const hw = waveHeight(state.x, state.z, t);
  // Surface PORTANTE ressentie par la coque (~3.4 m) : moyennée sur l'empreinte
  // (avant / centre / arrière). Une coque rigide ne suit pas une vague plus courte
  // qu'elle : elle PONTE les creux. Ce lissage spatial + la suspension temporelle
  // ci-dessous reproduisent le "skim" d'un jetski lancé — il glisse sur le clapot
  // au lieu de sauter de crête en crête ; à basse vitesse il s'assoit dans la houle.
  const HH = TUNING.hull.halfLen;                     // demi-longueur de coque
  const hFwd = waveHeight(state.x + fx * HH, state.z + fz * HH, t);
  const hAft = waveHeight(state.x - fx * HH, state.z - fz * HH, t);
  const hAvg = (hFwd + hw + hAft) / 3;
  const hMax = Math.max(hFwd, hw, hAft);
  // Au planage la coque PONTE davantage (skim sur les crêtes) ; au repos elle
  // s'assoit dans le creux (moyenne de l'empreinte).
  const support = hAvg + (hMax - hAvg) * (TUNING.hull.supportRest + TUNING.hull.supportPlane * planing);
  const draft = DRAFT_REST + planing * TUNING.hull.draftPlane;
  const targetY = support + draft;
  // Agitation locale de la mer : calme près de la côte, formée au large.
  const rough = Math.min(1.5, seaFactor(state.x, state.z));
  // CONTACT ASYMÉTRIQUE (le cœur du réalisme) : l'eau POUSSE la coque (flottabilité
  // + portance de planage, via une suspension masse-ressort AMORTIE) mais ne la TIRE
  // jamais vers le bas. Tant que la coque touche sa surface portante, la suspension
  // suit la houle longue et filtre le clapot court (skim). Dès qu'elle DÉPASSE cette
  // surface — l'eau qui se dérobe en sortie de crête/rampe — seule la GRAVITÉ agit :
  // arc balistique naturel. Résultat SANS aucun seuil de saut arbitraire : le jet ski
  // lisse le petit clapot et ne décolle QUE sur les vraies crêtes, d'autant plus haut
  // que la mer est formée et qu'on va vite (validé : 0 % en l'air sur mer calme,
  // ~20-30 % sur la houle, contre 48-81 % PARTOUT avec l'ancien suivi rigide).
  const stiff = TUNING.hull.stiff, damp = TUNING.hull.damp;
  const ay = (state.y <= targetY) ? (stiff * (targetY - state.y) - damp * state.vy) : -9.8;
  state.vy += ay * dt;
  state.y += state.vy * dt;
  // Butée de flottabilité : la coque ne s'enfonce jamais de plus de ~0.8 m sous sa
  // ligne de flottaison (fini l'effet "coule" sur les chocs/atterrissages).
  if (state.y < targetY - TUNING.hull.sinkLimit) { state.y = targetY - TUNING.hull.sinkLimit; if (state.vy < 0) state.vy = 0; }
  plunge = state.y - targetY;
  // Ré-entrée dans l'eau après un vol : gerbe + secousse caméra ∝ choc.
  if (lastPlunge > 0.06 && plunge <= 0 && state.vy < -1.5) {
    const impact = -state.vy;
    const power = Math.min(impact / 5, 1.8);
    spawnSplash(state.x, hw, state.z, power);
    burstDrops(state.x, hw, state.z, 26 + Math.floor(impact * 10), 0.7 + power * 0.6, fx * state.speed, fz * state.speed);
    lensDrops(4 + Math.floor(impact / 2));
    audioSplash(power);
    /* --- QUALITÉ DE RÉCEPTION → MOMENTUM (couplage assiette/dynamique) ---
       On mesure l'alignement du nez (state.pitch) avec l'angle de la trajectoire
       de chute, dégradé si l'on retombe dans un mur d'eau montant. Réception propre
       (nez piqué dans la pente, choc modéré) : quasi pas de scrub + reconversion
       d'une partie de la chute en glisse avant (la coque plane). Réception vautrée
       (nez haut, chute verticale, face de vague) : gros scrub + grosse secousse. */
    const L = TUNING.hull.land;
    const vh = Math.hypot(state.vx, state.vz);                 // vitesse horizontale
    const descent = Math.atan2(impact, Math.max(vh, 2));       // angle de chute (>0)
    const noseRel = state.pitch + descent;                     // 0 = nez pile dans la pente de chute
    const slopeAhead = waveHeight(state.x + fx * 2, state.z + fz * 2, t) - hw; // >0 : mur d'eau devant
    const align = Math.max(0, 1 - Math.abs(noseRel) / L.alignTol)
                * (1 - Math.min(Math.max(slopeAhead, 0) * L.slopeScrub, 0.7));
    const hardness = Math.min(impact / L.hardnessRef, 1);
    const keep = 1 - (L.scrubBase + L.scrubMax * (1 - align)) * (0.4 + 0.6 * hardness);
    state.vx *= keep; state.vz *= keep; state.speed *= keep;
    // Reconversion du choc vertical en avancée sur une réception propre à vitesse.
    if (align > 0.5 && vh > 6) {
      const carry = Math.min(impact * L.carryGain * align, L.carryMax);
      state.vx += fx * carry; state.vz += fz * carry; state.speed += carry;
    }
    // Retour caméra/objectif proportionnel au RATÉ : lisse si clean, violent si vautré.
    const badness = 0.4 + 0.6 * (1 - align);
    camImpact = Math.min(impact * 0.06 * badness, 0.5);
    camJolt = Math.min(impact * 0.5 * badness, 2.4);
    // "Thunk" de suspension DISTINCT : compression verticale brève, ∝ dureté du choc.
    camLand = Math.max(camLand, Math.min(impact * 0.03, TUNING.cam.landKick));
  }
  lastPlunge = plunge;
  // État "en l'air" (pilotage/effets) : marge pour ignorer les micro-arcs du clapot —
  // un petit rebond n'est pas un saut (ni coupure de direction, ni gros splash).
  const wasAir = state.air;
  state.air = plunge > TUNING.hull.airPlunge;
  if (state.air) {
    state.airTime = wasAir ? state.airTime + dt : dt;
    if (!wasAir) {
      // DÉCOLLAGE : compteurs de figures à zéro + grosse gerbe de lancement.
      trickRoll = 0; trickPitch = 0;
      const lp = Math.min(0.4 + speedF, 1.4);
      spawnSplash(state.x, hw, state.z, lp);
      burstDrops(state.x, hw + 0.15, state.z, 22 + Math.floor(speedF * 26), 0.6 + speedF * 0.8, fx * state.speed * 0.7, fz * state.speed * 0.7);
      audioSplash(0.35 + speedF * 0.4);
    }
    // Pilotage aérien : gauche/droite = barrel roll, haut/espace = backflip, bas = frontflip.
    // On n'accumule la vrille qu'après un vrai temps d'air (>0,35 s) : les micro-sauts
    // de clapot en tournant ne font PLUS rouler le ski (rendu propre).
    if (state.airTime > TUNING.hull.airArmTime) {
      const spin = 4.5 * dt;
      if (left) trickRoll -= spin;
      if (right) trickRoll += spin;
      if (keys[' '] || up) trickPitch += spin * 0.92;
      else if (down) trickPitch -= spin * 0.92;
    }
  } else {
    if (wasAir) {
      if (state.airTime > state.bestAir) state.bestAir = state.airTime;
      state.showAirUntil = t + 1.6;
      scoreTrick(fx, fz);   // ATTERRISSAGE : évalue les figures + grosse gerbe
    }
    state.airTime = 0;
    trickRoll = 0; trickPitch = 0;
  }

  const hBow = waveHeight(state.x + fx * 1.8, state.z + fz * 1.8, t);
  const hStern = waveHeight(state.x - fx * 1.7, state.z - fz * 1.7, t);
  const hRight = waveHeight(state.x + rx * 0.65, state.z + rz * 0.65, t);
  const hLeft = waveHeight(state.x - rx * 0.65, state.z - rz * 0.65, t);
  if (!state.air && state.speed > 10 && t > slamCd && (hBow - state.y) > 0.6) {
    slamCd = t + 0.5;
    spawnSplash(state.x + fx * 2, hBow, state.z + fz * 2, 1.2);
    burstDrops(state.x + fx * 2.2, hBow + 0.2, state.z + fz * 2.2, 16 + Math.floor(speedF * 14), 0.5 + speedF * 0.6, fx * state.speed, fz * state.speed);
    lensDrops(2 + Math.floor(speedF * 4));
    camImpact = Math.max(camImpact, 0.12 + speedF * 0.1);
    camJolt = Math.max(camJolt, 0.5 + speedF * 0.7);
    state.vy -= 0.5 * speedF;                          // la coque encaisse le choc de proue
    audioSplash(0.4 + speedF * 0.4);
    state.vx *= 0.985; state.vz *= 0.985; state.speed *= 0.985;
  }
  // Embruns sur l'objectif : d'autant plus fréquents qu'on va vite et que la
  // mer est formée (le pilote se prend les gerbes en pleine face).
  if (camMode === 'fpv' && !state.air && speedF > 0.35 && Math.random() < dt * (2 + speedF * 6 + rough * speedF * 5)) {
    lensDrops(1 + (Math.random() < speedF * 0.4 ? 1 : 0));
  }

  // Micro-pertes de stabilité sur le clapot : petit lacet erratique + sautillement
  // vertical, proportionnels à l'agitation locale ET à la vitesse (eau calme = lisse).
  if (!state.air) {
    const chopK = rough * speedF;
    state.yaw += Math.sin(t * 4.7 + state.x * 0.8 + state.z * 0.5) * 0.22 * chopK * dt;
    // Léger tremblement vertical sur l'eau formée (subtil : la suspension le lisse).
    state.vy += Math.sin(t * 5.9 + state.z * 0.7) * 0.35 * chopK * dt;
  }

  const fThr = Math.max(0, thrust);
  let targetPitch, targetRoll;
  if (state.air) {
    // En l'air, le nez suit le vecteur vitesse : HAUT en montée, BAS en descente.
    targetPitch = Math.max(-0.45, Math.min(0.45, Math.atan2(state.vy, Math.max(spd, 6)) * 0.8));
    targetRoll = -state.rudder * 0.15;
  } else {
    // ASSIETTE QUI ÉPOUSE LA VAGUE (+pitch = nez HAUT, vérifié en FPV) : proue HAUTE
    // en montant la face (hBow > hStern), proue BASSE en redescendant l'arrière de la
    // vague. + cabrage au hole-shot (le nez se lève quand on remet les gaz) et plongée
    // quand on lâche à vitesse. Le terme (fThr - speedF) fait les deux d'un coup.
    targetPitch = Math.atan2(hBow - hStern, 3.5) * 1.25 + (fThr - speedF) * 0.20 + 0.02;
    // Un jetski se couche DANS le virage (le carre intérieur mord) : roulis dans
    // le sens de la barre, d'autant plus marqué qu'on va vite et qu'on est au gaz.
    // + gîte qui suit la pente latérale de la vague (bord haut = tribord relevé).
    targetRoll = -state.rudder * 0.72 * Math.min(spd / 12, 1) * (0.4 + 0.6 * fThr) * (vForward < 0 ? -1 : 1) + Math.atan2(hRight - hLeft, 1.3) * 0.6;
    // Clapot : roulis/tangage désordonnés à vitesse sur l'eau formée.
    const chop = rough * speedF;
    targetRoll += Math.sin(t * 3.9 + state.x * 0.5) * 0.05 * chop;
    targetPitch += Math.sin(t * 4.6 + state.z * 0.6) * 0.04 * chop;
    // Basse vitesse : comportement flottant (roule/tangue mollement, peu précis).
    const idle = 1 - speedF;
    targetRoll += Math.sin(t * 1.05) * 0.045 * idle;
    targetPitch += Math.sin(t * 0.85 + 1.3) * 0.035 * idle;
  }
  // Suivi RAPIDE de l'assiette : la coque se conforme à la surface en quasi temps réel
  // (sinon le tangage est en retard de phase et paraît "décollé" de l'eau).
  const sFast = 1 - Math.exp(-dt * TUNING.hull.attitudeFollow);
  state.pitch += (targetPitch - state.pitch) * sFast;
  state.roll += (targetRoll - state.roll) * sFast;

  ski.position.set(state.x, state.y, state.z);
  ski.rotation.y = state.yaw;
  ski.rotation.x = state.pitch + trickPitch;
  ski.rotation.z = state.roll + trickRoll + (state.air ? 0 : Math.sin(t * 9) * 0.01 * speedF);
  if (barGroup) barGroup.rotation.y = -state.rudder * 0.5;

  // La main droite serre la gâchette de gaz, la gauche le frein (le cockpit
  // bras+mains reste actif en FPV même avec le modèle réel chargé).
  if (animRefs && barGroup && barGroup.visible) {
    if (animRefs.throttleLever) animRefs.throttleLever.rotation.x = -Math.max(0, state.throttle) * 0.7;
    if (animRefs.brakeLever) animRefs.brakeLever.rotation.x = -(down ? 0.7 : 0);
    // Phalange distale au repos à θ+π/2 = 4.17 rad ; serrer = curl supplémentaire.
    for (const f of animRefs.rFingers) f.rotation.x = 4.17 + Math.max(0, state.throttle) * 0.4;
    for (const f of animRefs.lFingers) f.rotation.x = 4.17 + (down ? 0.4 : 0);
    if (animRefs.rThumb) animRefs.rThumb.position.y = 0.148 - Math.max(0, state.throttle) * 0.012;
  }
  /* ---- PILOTE VIVANT (3e personne) : body english + IK des bras ----
     Le haut du corps pivote aux hanches (penché dans le virage, poids reporté aux
     gaz/freins, ramassé dans les sauts, absorption des chocs), la tête se stabilise
     à l'horizon, et les bras sont résolus en IK pour garder les mains sur le guidon. */
  if (mode === 'ride' && riderBody && riderBody.visible && animRefs && animRefs.torsoPivot) {
    const tp = animRefs.torsoPivot;
    const kf = 1 - Math.exp(-dt * 9);
    const spInside = Math.min(spd / 9, 1);
    const rev = vForward < 0 ? -1 : 1;
    const leanZ = state.rudder * 0.34 * spInside * rev;                   // penche DANS le virage
    // VIE PERMANENTE : respiration + léger roulis d'inactivité TOUJOURS présents
    // (le pilote n'est jamais figé), + absorption de la houle (il encaisse le
    // tangage vertical du jet) + réaction au clapot.
    const breath = Math.sin(t * 1.7) * 0.011;
    const idleRock = (Math.sin(t * 0.9) * 0.03 + Math.sin(t * 2.3 + 1.0) * 0.016) * (1 - speedF * 0.4);
    const chop = rough * (0.35 + speedF) * Math.sin(t * 6.0 + state.z * 0.5) * 0.05;
    const heave = Math.max(-0.16, Math.min(0.16, -state.vy * 0.024));     // encaisse la houle
    const leanX = 0.05 + (fThr - speedF) * 0.18 + heave + chop + (state.air ? -0.22 : 0);
    const twistY = -state.rudder * 0.16 * spInside + Math.sin(t * 1.25) * 0.02;
    tp.rotation.z += (leanZ + idleRock + chop * 0.6 - tp.rotation.z) * kf;
    tp.rotation.x += (leanX - tp.rotation.x) * kf;
    tp.rotation.y += (twistY - tp.rotation.y) * kf;
    const crouch = (state.air ? 0.05 : 0) - Math.min(camJolt * 0.06 + camImpact * 0.13, 0.15) + breath;
    tp.position.y += ((animRefs.torsoBaseY + crouch) - tp.position.y) * (1 - Math.exp(-dt * 12));
    // Tête : se stabilise vers l'horizon (compense gîte/tangage du buste) + regarde le virage
    const hpv = animRefs.headPivot;
    if (hpv) { hpv.rotation.z = -tp.rotation.z * 0.65; hpv.rotation.x = -tp.rotation.x * 0.4 + (state.air ? 0.12 : 0); hpv.rotation.y = -state.rudder * 0.2 * spInside; }
    // Mèches au vent : flottement + rabat vers l'arrière proportionnel à la vitesse
    if (animRefs.hairTufts) {
      const windBack = speedF * 0.5;
      for (const ht of animRefs.hairTufts) {
        const flut = Math.sin(t * (8 + speedF * 12) + ht.ph) * (0.05 + speedF * 0.14);
        ht.mesh.rotation.x = ht.baseX + windBack + flut;
        ht.mesh.rotation.z = ht.z + Math.sin(t * 6.2 + ht.ph) * 0.06 * (0.3 + speedF);
      }
    }
    // --- IK 2 os : épaule (suit le buste, tournée autour des hanches) -> poignée FIXE ---
    _ikRest.set(0, animRefs.torsoBaseY, tp.position.z);                   // point de pivot (hanches)
    for (const a of animRefs.arms) {
      _ikS.copy(a.shAnchor.position).sub(_ikRest).applyEuler(tp.rotation).add(tp.position); // épaule
      const G = a.grip;
      let d = _ikS.distanceTo(G);
      const dmin = Math.abs(a.L1 - a.L2) + 0.002, dmax = a.L1 + a.L2 - 0.002;
      d = Math.max(dmin, Math.min(dmax, d));
      const aLen = (d * d + a.L1 * a.L1 - a.L2 * a.L2) / (2 * d);
      const h = Math.sqrt(Math.max(0, a.L1 * a.L1 - aLen * aLen));
      _ikAxis.subVectors(G, _ikS); if (_ikAxis.lengthSq() < 1e-6) _ikAxis.set(0, -1, 0); _ikAxis.setLength(1);
      _ikPole.set(0.4 * a.s, -1, 0.55).normalize();                       // coude vers le bas-extérieur-arrière
      _ikPerp.copy(_ikPole).addScaledVector(_ikAxis, -_ikPole.dot(_ikAxis));
      if (_ikPerp.lengthSq() < 1e-6) _ikPerp.set(0, -1, 0); _ikPerp.setLength(1);
      _ikE.copy(_ikS).addScaledVector(_ikAxis, aLen).addScaledVector(_ikPerp, h); // coude
      setBone(a.upper, _ikS, _ikE);
      setBone(a.fore, _ikE, G);
      a.biceps.position.lerpVectors(_ikS, _ikE, 0.5).y += 0.015; a.biceps.quaternion.copy(a.upper.quaternion);
      a.elbowB.position.copy(_ikE);
      a.brach.position.lerpVectors(_ikE, G, 0.35); a.brach.quaternion.copy(a.fore.quaternion);
      a.fist.position.copy(G); a.knuck.position.copy(G).addScaledVector(_ikPerp, 0.03);
      a.cuffG.position.lerpVectors(_ikE, G, 0.82); a.cuffG.quaternion.copy(a.fore.quaternion);
    }
  }

  // Soleil + ombre suivent le jetski
  sun.position.set(state.x + sunDir.x * 40, sunDir.y * 40, state.z + sunDir.z * 40);
  sun.target.position.set(state.x, state.y, state.z);

  /* ---- Caméra ---- */
  camImpact *= Math.exp(-dt * TUNING.cam.impactDecay);
  camJolt *= Math.exp(-dt * TUNING.cam.joltDecay);
  camLand *= Math.exp(-dt * TUNING.cam.landKickDecay);   // "thunk" d'atterrissage (canal dédié)
  if (camMode === 'fpv') {
    // === CAMÉRA FPV VIVANTE ===
    // La caméra est enfant du ski : elle hérite déjà de son cap/tangage/roulis.
    // On AJOUTE par-dessus le ressenti humain : vibration moteur, clapot,
    // forces G (accél/virage), coups d'impact, regard dans le virage, flottement.
    const smoothG = 1 - Math.exp(-dt * 8);
    // 1) Vibration : moteur (rpm) + buzz du clapot à vitesse, multi-fréquence,
    //    + grain de bruit organique (casse la périodicité des sinus = moins mécanique).
    const vib = state.air ? 0.0015 : (0.0025 + state.rpm * 0.005 + rough * speedF * 0.012);
    const nz = TUNING.cam.shakeNoise;
    const bobX = (Math.sin(t * 22.0) * 0.6 + Math.sin(t * 38.7) * 0.4 + vnoise(t * 31.0) * nz) * vib;
    const bobY = (Math.sin(t * 26.5) * 0.6 + Math.sin(t * 44.3) * 0.4 + vnoise(t * 27.7 + 9.1) * nz) * vib + Math.sin(t * 12.0) * state.rpm * 0.003;
    // 2) Forces G : accél recule la tête (+z=poupe), décel avance ; le virage
    //    pousse la tête vers l'extérieur ; l'accél cabre légèrement le regard.
    const accel = (state.speed - camPrevSpeed) / Math.max(dt, 0.001);
    camPrevSpeed = state.speed;
    const gLong = Math.max(-1.5, Math.min(1.5, accel * 0.06));
    const gLat = Math.max(-1.2, Math.min(1.2, state.speed * state.yawRate * 0.045));
    camG.z += (gLong * 0.085 - camG.z) * smoothG;
    camG.x += (gLat * 0.05 - camG.x) * smoothG;
    camG.pitch += (-gLong * 0.045 - camG.pitch) * smoothG;
    camG.roll += (gLat * 0.05 - camG.roll) * smoothG;
    camG.yaw += (-state.rudder * 0.05 - camG.yaw) * smoothG; // le regard anticipe le virage
    // 3) En l'air : le regard suit la trajectoire (nez qui monte/descend).
    const airPitch = state.air ? Math.max(-0.28, Math.min(0.22, -Math.atan2(state.vy, Math.max(Math.abs(state.speed), 6)) * 0.45)) : 0;
    camera.position.set(
      CAM_BASE.x + bobX + camG.x,
      CAM_BASE.y + bobY - camImpact - camJolt * 0.12 - camLand,
      CAM_BASE.z + camG.z
    );
    camera.rotation.set(
      -0.17 - camImpact * 0.6 - camJolt * 0.18 + camG.pitch + airPitch + bobY * 0.35,
      camG.yaw,
      camG.roll + bobX * 0.5
    );
  } else {
    // Deux distances de chase : proche (2 m, met le pilote/jet en valeur) ou
    // large (6 m, meilleure lecture de la trajectoire).
    const near = camMode === 'chaseNear';
    const dist = near ? 2.4 : 5.9;
    const rud = near ? 0.6 : 1.15;
    chaseTarget.set(state.x - fx * dist - rx * state.rudder * rud, state.y + (near ? 1.5 : 2.2) - camLand, state.z - fz * dist - rz * state.rudder * rud);
    camera.position.lerp(chaseTarget, 1 - Math.exp(-dt * (near ? 6.5 : 4.5)));
    // Anti-plongée : la caméra ne passe jamais sous la surface (creux de houle au large).
    const camWave = waveHeight(camera.position.x, camera.position.z, t) + TUNING.cam.chaseClearWater;
    if (camera.position.y < camWave) camera.position.y = camWave;
    camera.lookAt(state.x + fx * (near ? 1.1 : 3.6), state.y + (near ? 1.15 : 1.2), state.z + fz * (near ? 1.1 : 3.6));
  }
  // Punch de FOV à l'ACCÉLÉRATION (hole-shot ressenti) : l'accél franche élargit
  // brièvement le champ (montée rapide, relâche lente), en plus du FOV lié à la vitesse.
  const fovAccel = (state.speed - fovPrevSpeed) / Math.max(dt, 0.001);
  fovPrevSpeed = state.speed;
  const kickTgt = Math.max(0, Math.min(TUNING.cam.fovKickMax, fovAccel * TUNING.cam.fovKickGain));
  fovKick += (kickTgt - fovKick) * (1 - Math.exp(-dt * (kickTgt > fovKick ? TUNING.cam.fovKickRise : TUNING.cam.fovKickFall)));
  const targetFov = TUNING.cam.fovBase + TUNING.cam.fovSpeedGain * speedF + fovKick;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * sFast;
    camera.updateProjectionMatrix();
  }

  ocean.position.set(state.x, 0, state.z);
  sky.position.set(state.x, 0, state.z);
  // La coque pousse l'eau : on transmet sa position, son cap et sa vitesse au shader.
  oceanUniforms.uHullPos.value.set(state.x, state.y, state.z);
  oceanUniforms.uHullFwd.value.set(fx, 0, fz);
  oceanUniforms.uHullSpeed.value = state.air ? 0 : Math.max(0, state.speed);

  /* ---- Effets ---- */
  // La coque fend l'eau dès qu'elle bouge : les gerbes montent vite avec la
  // vitesse (avant : quasi rien tant qu'on ne planait pas -> le jet semblait
  // posé sur une surface figée).
  const moving = Math.min(1, speedF * 4);
  for (const sp of sprays) {
    // Petite gerbe LATÉRALE de proue (courte) — surtout pas un long trait devant.
    sp.material.opacity = state.air ? 0 : Math.min(0.55, (0.35 * speedF + 0.6 * planing) * moving) * (0.55 + 0.45 * Math.sin(t * 14 + sp.position.x * 9));
    sp.scale.set(1.0 + planing * 0.35, 0.8 + speedF * 0.4 + planing * 0.3, 1);
  }
  // Anneau d'écume : collé à la ligne de flottaison LOCALE -> il assoit la coque
  // dans l'eau même à l'arrêt (l'eau bouillonne toujours autour d'une coque).
  if (contactRing) {
    contactRing.visible = !state.air;
    contactRing.position.y = hw - state.y + 0.05;
    contactRing.material.opacity = (0.24 + 0.24 * Math.min(state.rpm + speedF, 1)) * (0.85 + 0.15 * Math.sin(t * 6.3));
    const cs = 0.8 + speedF * 0.35 + Math.sin(t * 4.1) * 0.04;
    contactRing.scale.set(cs, 1, cs);
    contactRing.rotation.y = Math.sin(t * 0.7) * 0.25;
  }
  for (const wk of wakes) {
    wk.material.opacity = state.air ? 0 : Math.min(0.9, speedF * 0.7 + 0.12 * moving) * (0.72 + 0.28 * Math.sin(t * 6 + wk.position.x * 5));
    wk.scale.set(1.2 + speedF * 0.9, 1, 1.2 + speedF * 1.1);
  }
  if (sternWash) {
    // Bout dès que la turbine tourne, collé à la flottaison comme l'anneau
    sternWash.position.y = hw - state.y + 0.07;
    sternWash.material.opacity = state.air ? 0 : Math.min(0.95, 0.4 * state.rpm + Math.min(Math.abs(state.speed) / 7, 1) * 0.6) * (0.82 + 0.18 * Math.sin(t * 11));
    const ws = 1 + Math.min(speedF, 1) * 0.8;
    sternWash.scale.set(ws, 1, 1 + speedF * 1.4);
  }
  for (const s of splashes) {
    s.age += dt;
    const life = 0.7;
    if (s.age < life) {
      const p = s.age / life;
      s.m.material.opacity = (1 - p) * 0.85;
      const sc = (0.5 + p * 3.4) * s.power;
      s.m.scale.set(sc, 1, sc);
    } else s.m.material.opacity = 0;
  }
  for (const d of drops) {
    if (d.life > 0) {
      d.life -= dt / 1.3;
      d.top += d.vy * dt;
      d.el.style.top = d.top + '%';
      d.el.style.opacity = Math.max(d.life, 0) * 0.8;
    }
  }
  updateDrops(dt, t);

  /* ---- Traînée persistante + anneaux d'onde depuis la turbine ---- */
  // Position de la turbine dans le monde : environ 1,8 m derrière le centre du ski
  const sternX = state.x - fx * 1.7;
  const sternZ = state.z - fz * 1.7;
  const sternY = waveHeight(sternX, sternZ, t);
  if (!state.air && Math.abs(state.speed) > 0.6) {
    // Émission continue proportionnelle à la vitesse (traînée d'écume dense)
    const emitPerSec = 10 + speedF * 34;
    wakeAccum += emitPerSec * dt;
    while (wakeAccum >= 1) {
      wakeAccum -= 1;
      const jitterX = (Math.random() - 0.5) * 0.5;
      const jitterZ = (Math.random() - 0.5) * 0.5;
      spawnWake(sternX + jitterX, sternY, sternZ + jitterZ, 0.85 + speedF * 1.3, 2.2 + speedF * 1.6);
    }
    // Anneaux d'onde périodiques quand on avance
    if (state.speed > 4) {
      const period = Math.max(0.28, 0.9 - speedF * 0.55);
      if ((t % period) < dt) spawnRing(sternX, sternY, sternZ, 1.4 + speedF * 0.4);
    }
  }
  /* ---- Rooster tail : gerbe de turbine (si pompe immergée et régime) ---- */
  if (!state.air && state.rpm > 0.22 && state.speed > 3.5 && plunge > -0.5) {
    emitRoost(dt, t, fx, fz, rx, rz, speedF);
  }
  updateRoost(dt, t);
  /* ---- Éclaboussure de carving : la coque en travers gicle côté intérieur ---- */
  if (!state.air && Math.abs(vLat) > 2.2 && Math.random() < dt * 18) {
    const side = vLat > 0 ? 1 : -1;
    burstDrops(state.x + rx * side * 0.8, hw, state.z + rz * side * 0.8,
      3 + Math.floor(Math.abs(vLat)), 0.5 + Math.min(Math.abs(vLat) * 0.1, 0.7),
      state.vx * 0.3, state.vz * 0.3);
  }
  updateWake(dt, t);
  updateRings(dt, t);
  updateGulls(dt, t);
  updateFish(dt, t);
  updateYachts(dt, t);

  /* ---- Pilote vivant : body English comme sur un vrai jetski ----
     Repère du corps (ordre YXZ) : rotation.z = penche latéralement (DANS le
     virage), rotation.x = penche avant/arrière. Il jette le poids à l'intérieur
     du virage, se ramasse sur l'avant à vitesse, part en arrière au hole-shot,
     et se casse au-dessus du guidon en l'air. ---- */
  if (realRiderGroup && realRiderGroup.visible) {
    const rg = realRiderGroup;
    const spd = Math.min(Math.abs(state.speed) / 12, 1);
    // Penche dans le virage (torse vers l'intérieur), amplifié par la vitesse.
    const targetLean = -state.rudder * 0.55 * spd;
    // Avant/arrière : arrière au hole-shot (gaz + peu de vitesse), avant à
    // vitesse (position d'attaque / on serre le guidon), ramassé en l'air.
    const targetFB = state.air ? -0.30 : (thrust * 0.16 - speedF * 0.26);
    const k = 1 - Math.exp(-dt * 8);
    rg.rotation.z += (targetLean - rg.rotation.z) * k;
    rg.rotation.x += (targetFB - rg.rotation.x) * k;
  }

  /* ---- Immersion : voile sous-marin + traînée d'eau + son étouffé ---- */
  const camWorldY = camMode === 'fpv' ? state.y + 1.25 : camera.position.y;
  const submerged = camWorldY < hw - 0.1;
  uwEl.style.opacity = submerged ? '1' : '0';
  if (plunge < -0.3) {
    const kc = Math.exp(-dt * (1.2 + Math.min(2.2, -plunge)));
    state.vx *= kc; state.vz *= kc; state.speed *= kc;
  }

  for (const b of buoys) {
    const d = Math.hypot(b.position.x - state.x, b.position.z - state.z);
    if (d > 700) {
      b.position.x = state.x + fx * (300 + Math.random() * 300) + rx * (Math.random() - 0.5) * 400;
      b.position.z = state.z + fz * (300 + Math.random() * 300) + rz * (Math.random() - 0.5) * 400;
    }
    b.position.y = waveHeight(b.position.x, b.position.z, t) + 0.3;
    b.rotation.z = 0.2 * Math.sin(t * 2.1 + b.position.x);
  }

  /* ---- Bouées de course + flotte IA ---- */
  updateAiFleet(dt, t);

  /* ---- Méta-jeu : collectibles, carburant, police, minimap ---- */
  updateMeta(dt, t);

  /* ---- Portes lumineuses & micro-défis ---- */
  gate.position.y = waveHeight(gate.position.x, gate.position.z, t) + 4 + Math.sin(t * 2) * 0.25;
  gateTorus.rotation.z = t * 0.5;
  CH.gateFlash = Math.max(0, CH.gateFlash - dt * 3);
  gateTorus.material.emissiveIntensity = 2.2 + CH.gateFlash * 4;
  gateFlag.scale.setScalar(1 + Math.sin(t * 5) * 0.12);
  const gdx = state.x - gate.position.x, gdz = state.z - gate.position.z;
  const gdist = Math.hypot(gdx, gdz);
  if (gdist < 5.2) {
    CH.gatesPassed++;
    missionAdd('gates', 1);
    gainCoins(15);   // pièces pour chaque porte franchie
    CH.combo = CH.comboTimer > 0 ? CH.combo + 1 : 1;
    CH.comboTimer = 5;
    CH.maxCombo = Math.max(CH.maxCombo, CH.combo);
    CH.score += 100 * (1 + (CH.combo - 1) * 0.5);
    CH.gateFlash = 1;
    burstDrops(gate.position.x, gate.position.y - 3, gate.position.z, 26, 1.0, fx * state.speed, fz * state.speed);
    audioSplash(0.5);
    placeGate(fx, fz);
  } else if (gdist > 280) {
    placeGate(fx, fz);
  }
  if (CH.comboTimer > 0) { CH.comboTimer -= dt; if (CH.comboTimer <= 0) CH.combo = 0; }
  if (state.air) CH.maxAir = Math.max(CH.maxAir, state.airTime);
  const defi = DEFIS[CH.idx];
  /* -- Mini-jeu ANNEAUX : flottent sur l'eau, tournent, se ramassent au passage -- */
  if (defi.type === 'rings') {
    for (const p of pickups) {
      if (p.got) continue;
      p.m.position.y = waveHeight(p.m.position.x, p.m.position.z, t) + 0.25;
      p.m.rotation.z = t * 1.8;
      if (Math.hypot(state.x - p.m.position.x, state.z - p.m.position.z) < 2.8) {
        p.got = true; p.m.visible = false;
        CH.ringsGot++; CH.score += 50;
        burstDrops(p.m.position.x, p.m.position.y, p.m.position.z, 14, 0.8, fx * state.speed, fz * state.speed);
        audioSplash(0.45);
        toast('ANNEAU ' + CH.ringsGot + '/' + defi.target);
      }
    }
  }
  /* -- Mini-jeu DRIFT : cumule le temps passé en travers à vitesse -- */
  if (defi.type === 'drift' && !state.air && Math.abs(vLat) > 2.5 && spd > 8) CH.driftAcc += dt;
  /* -- Mini-jeu SPRINT : la porte contre la montre (échec = on remet une porte) -- */
  if (defi.type === 'sprint') {
    CH.sprintLeft -= dt;
    if (CH.sprintLeft <= 0) {
      toast('TROP TARD — nouvelle porte');
      CH.sprintLeft = defi.target;
      CH.startGates = CH.gatesPassed;
      placeGate(fx, fz);
    }
  }
  // Progression du défi courant
  let prog = 0;
  if (defi.type === 'gates') prog = (CH.gatesPassed - CH.startGates) / defi.target;
  else if (defi.type === 'speed') prog = (state.speed * 3.6) / defi.target;
  else if (defi.type === 'air') prog = CH.maxAir / defi.target;
  else if (defi.type === 'combo') prog = CH.maxCombo / defi.target;
  else if (defi.type === 'rings') prog = CH.ringsGot / defi.target;
  else if (defi.type === 'drift') prog = CH.driftAcc / defi.target;
  else if (defi.type === 'offshore') prog = Math.hypot(state.x, state.z) / defi.target;
  else if (defi.type === 'jumps') prog = CH.jumps / defi.target;
  else if (defi.type === 'sprint') prog = (CH.gatesPassed - CH.startGates) >= 1 ? 1 : 0;
  if (prog >= 1) {
    CH.score += defi.reward;
    toast('DÉFI RÉUSSI  +' + defi.reward);
    enterDefi((CH.idx + 1) % DEFIS.length);
  }
  chalScore.textContent = Math.round(CH.score).toLocaleString('fr-FR');
  chalCombo.textContent = CH.combo > 1 ? 'COMBO x' + CH.combo : '';
  chalTxt.textContent = DEFIS[CH.idx].t + (DEFIS[CH.idx].type === 'sprint' ? '  ·  ' + Math.max(0, CH.sprintLeft).toFixed(1) + ' s' : '');
  // Pour le sprint, la barre montre le TEMPS restant (plus lisible qu'une progression)
  chalBar.style.width = (DEFIS[CH.idx].type === 'sprint'
    ? Math.max(0, CH.sprintLeft / DEFIS[CH.idx].target) * 100
    : Math.min(prog * 100, 100)) + '%';

  /* ---- Audio ---- */
  if (audio) {
    const aT = audio.ctx.currentTime;
    const S = 0.02;                          // constante de lissage anti-zipper (fini les clics)
    // Note moteur pilotée par le RÉGIME turbine : sous charge = grave/plein,
    // et quand la pompe ventile (saut/crête) le moteur s'emballe -> aigu.
    const engHz = 34 + speedF * 56 + state.rpm * 84;
    // BURBLE / cavitation : à bas régime SOUS CHARGE (lugging), le moteur "brape" ->
    // LFO d'amplitude + wobble de filtre, d'autant plus marqués que la charge est
    // haute et la vitesse basse. Au planage (load→0) le son se lisse.
    const load = Math.abs(state.throttle) * (1 - speedF);       // 1 = plein gaz à basse vitesse
    const burbleHz = 5 + state.rpm * 7;
    const burble = 1 + Math.sin(t * burbleHz * TWO_PI) * 0.35 * load;   // ~0.65..1.35 sous charge
    audio.osc1.frequency.setTargetAtTime(engHz, aT, S);
    audio.osc2.frequency.setTargetAtTime(engHz * 0.5, aT, S);
    audio.sub.frequency.setTargetAtTime(engHz * 0.5, aT, S);    // sub sinus : grondement de coque
    audio.osc1.detune.value = Math.sin(t * 9) * 12 * state.rpm; // detune déjà lisse (continu)
    // Sous l'eau : tout est étouffé
    const muffle = plunge < -0.3 ? 0.22 : 1;
    audio.filter.frequency.setTargetAtTime((260 + speedF * 560) * muffle * (0.85 + 0.15 * burble), aT, S);
    audio.eGain.gain.setTargetAtTime(muted ? 0 : (0.02 + Math.abs(state.throttle) * 0.045) * (plunge < -0.3 ? 0.5 : 1) * burble, aT, S);
    audio.nGain.gain.setTargetAtTime(muted || state.air ? 0 : speedF * 0.05 * muffle, aT, S);
    // Sifflement de turbine : monte fort au régime, coupé sous l'eau.
    audio.whine.frequency.setTargetAtTime(900 + state.rpm * 1500 + speedF * 400, aT, S);
    audio.wGain.gain.setTargetAtTime(muted ? 0 : Math.min(0.03, state.rpm * 0.028) * muffle, aT, S);

    // --- SIRÈNE DE POLICE positionnelle (wail deux-tons + pan + doppler) ---
    if (chaseOn && !muted) {
      const fxp = -Math.sin(policeState.yaw), fzp = -Math.cos(policeState.yaw);
      const sp = spatialAudio(policeState.x, policeState.z, fxp * policeState.spd, fzp * policeState.spd, 45, 0.13);
      audio.siren.frequency.setTargetAtTime((720 + 260 * Math.sin(t * 6.0)) * sp.pitch, aT, 0.03);
      audio.sirGain.gain.setTargetAtTime(sp.gain, aT, 0.08);
      audio.sirPan.pan.setTargetAtTime(sp.pan, aT, 0.05);
    } else audio.sirGain.gain.setTargetAtTime(0, aT, 0.15);

    // --- MOTEUR du jet IA le plus proche (doppler quand il te croise) ---
    let near = null, nd = 1e9;
    for (const ai of aiSkis) { if (!ai.g.visible) continue; const d = Math.hypot(ai.x - state.x, ai.z - state.z); if (d < nd) { nd = d; near = ai; } }
    if (near && nd < 90 && !muted) {
      const afx = -Math.sin(near.yaw), afz = -Math.cos(near.yaw);
      const ap = spatialAudio(near.x, near.z, afx * near.spd, afz * near.spd, 30, 0.045);
      audio.aiOsc.frequency.setTargetAtTime((70 + near.spd * 4) * ap.pitch, aT, 0.04);
      audio.aiGain.gain.setTargetAtTime(ap.gain, aT, 0.1);
      audio.aiPan.pan.setTargetAtTime(ap.pan, aT, 0.06);
    } else audio.aiGain.gain.setTargetAtTime(0, aT, 0.2);

    // --- DUCKING musique sous les gros chocs (atterrissage/secousse) : la nappe
    //     synthwave s'efface une fraction de seconde pour laisser claquer l'impact. ---
    const duck = Math.min(camJolt * 0.25 + camLand * 1.2, 0.6);
    audio.musicBus.gain.setTargetAtTime((muted ? 0 : 0.17) * (1 - duck), aT, 0.05);
  }

  /* ---- HUD ---- */
  const kmh = state.speed * 3.6;
  gaugeTick++;
  const skiModel = MODELS.find(m => m.id === sel.ski);
  if (gaugeTick % 2 === 0) drawOdo(Math.abs(kmh), state.throttle, skiModel.brand, kmh < -0.5);
  hudSpeed.textContent = (kmh < -0.5 ? 'R' : '') + Math.round(Math.abs(kmh));
  let hdg = ((-state.yaw * 180 / Math.PI) % 360 + 360) % 360;
  hudHeading.textContent = String(Math.round(hdg)).padStart(3, '0') + '° ' + CARDINALS[Math.round(hdg / 45) % 8];
  // Compteur circulaire : arc de vitesse (0->vitesse max du modèle) + arc de gaz.
  // pathLength=100 => l'arc de 270° vaut 75 unités.
  const sf = Math.min(1, Math.abs(kmh) / ((skiModel && skiModel.top) || 110));
  spFill.style.strokeDasharray = (75 * sf).toFixed(1) + ' 100';
  spFill.style.stroke = sf > 0.82 ? '#ff2f63' : (sf > 0.5 ? '#ff5c8a' : '#ff92b6');
  const tf = Math.min(1, Math.abs(state.throttle));
  spThr.style.strokeDasharray = (75 * tf).toFixed(1) + ' 100';
  spThr.style.stroke = state.throttle < 0 ? 'rgba(255,156,26,0.95)' : 'rgba(53,224,224,0.95)';
  hudBest.textContent = state.bestAir.toFixed(2) + ' s';
  if (state.air) {
    hudAir.style.opacity = '1';
    hudAir.textContent = 'air ' + state.airTime.toFixed(2) + ' s';
  } else if (t < state.showAirUntil) {
    hudAir.style.opacity = '1';
  } else {
    hudAir.style.opacity = '0';
  }
  // Popup de figure : disparaît après sa fenêtre d'affichage.
  if (trickNameEl && trickHud.until && t > trickHud.until) {
    trickNameEl.style.opacity = '0';
    trickNameEl.style.transform = 'translateX(-50%) scale(0.7)';
    trickHud.until = 0;
  }

  // Objectif mouillé : sèche en continu, se remouille à vitesse sur mer formée
  // et se prend une giclée aux impacts (camJolt). Plein effet en FPV.
  lensWet = Math.min(1, Math.max(0, lensWet - dt * 0.4) + camJolt * 0.14 + (state.air ? 0 : speedF * rough * dt * 0.7));
  updateFilm(t, speedF, camMode === 'fpv' ? lensWet : lensWet * 0.4);
  composer.render();
}
requestAnimationFrame(frame);
// Initialise le SDK CrazyGames puis signale que le jeu est prêt (loadingStop).
initCrazyGames().then(() => { cgLoadingStop(); });
