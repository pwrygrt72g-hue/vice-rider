import * as THREE from 'three';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../vendor/jsm/postprocessing/ShaderPass.js';
import { RGBELoader } from '../vendor/jsm/loaders/RGBELoader.js';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from '../vendor/jsm/loaders/DRACOLoader.js';
import { OBJLoader } from '../vendor/jsm/loaders/OBJLoader.js';
import { TWO_PI, smooth01, hex } from './util.js?v=28';
import { MODELS, JETSKIS, PILOTES, SUITS, QUALITIES } from './data.js?v=28';
import { WAVES, seaFactor, waveHeight } from './sea.js?v=28';
import { SKY_FUNC, ENV_FUNC, FilmShader } from './shaders.js?v=28';

const sel = { ski: 'rxpx', pilote: 'sonny', suit: 'rose', quality: 'moyen' };

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
makeCards('cards-ski', JETSKIS, 'ski', cardTpl);
makeCards('cards-pilote', PILOTES, 'pilote', p => `
  <div class="dot" style="background:${hex(p.skin)}"></div><div class="name">${p.name}</div>`);
makeCards('cards-suit', SUITS, 'suit', s => `
  <div class="swatch"><div style="background:${hex(s.c)}"></div><div style="background:${hex(s.c2)}"></div></div>
  <div class="name">${s.name}</div>`);
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

/* ================= CIEL ================= */
function makeSkyMaterial(graded) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSunDir: { value: sunDir }, uNight },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `precision highp float; uniform vec3 uSunDir; uniform float uNight; varying vec3 vDir;
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
    uniforms: { uEnvTex: { value: hdr }, uEnvRot: { value: rot }, uNight, uSunDir: { value: sunDir } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `precision highp float;
uniform sampler2D uEnvTex; uniform float uEnvRot; uniform float uNight; uniform vec3 uSunDir; varying vec3 vDir;
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
    bowV = smoothstep(0.0, 1.4, vShape) * smoothstep(9.0, 2.0, alongF) * min(uHullSpeed / 8.0, 1.4);
    bowV *= exp(-abs(sideF) * abs(sideF) / 12.0);
  }
  // (Le halo de contact coque/eau est calculé PAR PIXEL dans le fragment
  // shader — indépendant de la grille, donc petit et net, sans popping.)
  float hullPush = bowV * 1.05;
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
  float bowFoam = smoothstep(0.15, 0.7, vHullPush) * (0.75 + 0.25 * mottling);
  // Halo de contact coque/eau PER-PIXEL : petite ellipse d'eau churnée qui
  // épouse la coque (~1 m autour), bords rongés par le bruit. Précis quel que
  // soit le pas de la grille (contrairement à un calcul au sommet).
  vec2 relH = vWorldPos.xz - uHullPos.xz;
  vec2 fwdH = normalize(uHullFwd.xz);
  float alongH = dot(relH, fwdH);
  float sideH = relH.x * fwdH.y - relH.y * fwdH.x;
  float eDH = sqrt((alongH * alongH) / 4.84 + sideH * sideH);
  float hullFoam = exp(-eDH * eDH * 0.9) * (0.5 + 0.6 * min(uHullSpeed / 12.0, 1.0)) * (0.55 + 0.45 * mottling);
  float foam = clamp(crestFoam * 0.6 + slopeFoam * 0.5 + jacFoam * 1.2 + bowFoam * 1.4 + hullFoam * 1.15, 0.0, 1.0) * (0.7 + 0.3 * mottling);
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
// Texture de façade : fenêtres allumées, bakée une fois puis clonée par tour
// (repeat variable = densité de fenêtres). Sert de map ET d'emissiveMap.
const towerTex = (() => {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#0b0912'; g.fillRect(0, 0, 64, 128);
  // Grille GROSSES fenêtres 4 col x 9 rangs, marges fines : survit à la
  // minification à distance (ne se moyenne pas en gris). ~62% allumées, néon Miami.
  const lit = ['#ffd39a', '#ffc07a', '#8febff', '#35e0e0', '#ff8fb4', '#fff2d8'];
  const cols = 4, rows = 9, mx = 3, my = 3;
  const cw = (64 - mx * (cols + 1)) / cols, ch = (128 - my * (rows + 1)) / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = mx + c * (cw + mx), y = my + r * (ch + my);
    if (Math.random() < 0.62) {
      g.fillStyle = lit[(Math.random() * lit.length) | 0];
      g.globalAlpha = 0.8 + Math.random() * 0.2;   // allumées ~opaques
    } else { g.fillStyle = '#0a0812'; g.globalAlpha = 1; }
    g.fillRect(x, y, cw, ch);
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
// Corps sombres = silhouette crépusculaire ; les fenêtres émissives portent la
// couleur (et captent le bloom). Teintes pastel Miami à peine perceptibles.
const towerTints = [0x141020, 0x181228, 0x161426, 0x1c1224, 0x121424];
// Traînée verticale douce pour les reflets néon dans l'eau (bright en haut = ligne
// d'eau, s'estompe vers le bas ; bords latéraux adoucis).
const reflStreakTex = (() => {
  const cv = document.createElement('canvas'); cv.width = 32; cv.height = 128;
  const g = cv.getContext('2d');
  for (let y = 0; y < 128; y++) {
    const vy = Math.pow(1 - y / 128, 1.6);            // fort en haut, fondu en bas
    for (let x = 0; x < 32; x++) {
      const vx = 1 - Math.abs(x - 15.5) / 15.5;        // adoucit les bords
      const a = Math.max(0, vy * vx * vx);
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const reflHues = [0xffb060, 0x9be8ff, 0xff6fa6, 0x8fe0ff, 0xffd08a];
const towerReflections = [];
for (let i = 0; i < 16; i++) {
  const w = 26 + Math.random() * 40;
  const h = 46 + Math.random() * 120;
  const tex = towerTex.clone(); tex.needsUpdate = true;
  // Fenêtres LISIBLES à distance : ~1 colonne / 14 m, ~1 rang / 12 m (grosses).
  tex.repeat.set(Math.max(1, Math.round(w / 14)), Math.max(2, Math.round(h / 12)));
  const mat = new THREE.MeshLambertMaterial({
    color: towerTints[i % towerTints.length],
    map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 2.1
  });
  const tw = new THREE.Mesh(new THREE.BoxGeometry(w, h, 24), mat);
  const tx = 950 + Math.random() * 140, tz = -440 + i * 58 + Math.random() * 22;
  tw.position.set(tx, h / 2, tz);
  skyline.add(tw);
  // Reflet néon sur l'eau : sprite additif, sommet à la ligne d'eau, étiré vers le bas.
  const refl = new THREE.Sprite(new THREE.SpriteMaterial({
    map: reflStreakTex, color: reflHues[i % reflHues.length],
    blending: THREE.AdditiveBlending, transparent: true, depthTest: false,
    depthWrite: false, opacity: 0.9
  }));
  const rh = h * 0.55, rw = w * 0.7;
  refl.scale.set(rw, rh, 1);
  refl.position.set(tx, -rh * 0.5 + 1.5, tz);
  refl.renderOrder = 3;
  skyline.add(refl);
  towerReflections.push(refl);
}
scene.add(skyline);

const palmIslands = [];
const sandMat = new THREE.MeshStandardMaterial({ color: 0xd4b488, roughness: 0.95 });
const wetSandMat = new THREE.MeshStandardMaterial({ color: 0xa88a62, roughness: 0.7 });
const grassMat = new THREE.MeshStandardMaterial({ color: 0x3f7a42, roughness: 0.9 });
const rockMat = new THREE.MeshStandardMaterial({ color: 0x6a6560, roughness: 0.85, flatShading: true });
const frondMat = new THREE.MeshStandardMaterial({ color: 0x2c6e35, roughness: 0.85, side: THREE.DoubleSide });
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5c3d, roughness: 0.9 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.9 });

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
for (let i = 0; i < 5; i++) {
  const r = 16 + Math.random() * 26;
  const ang = (i / 5) * TWO_PI + Math.random();
  const dist = 260 + Math.random() * 340;
  const g = makeIsland(r);
  if (i === 0) makeDock(g, r);
  g.position.set(Math.cos(ang) * dist, 0, Math.sin(ang) * dist);
  palmIslands.push({ g, r });
}

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
  { t: 'Franchis 5 portes', type: 'gates', target: 5, reward: 800 }
];
const CH = { score: 0, combo: 0, comboTimer: 0, gatesPassed: 0, idx: 0, startGates: 0, maxAir: 0, maxCombo: 0, gateFlash: 0, driftAcc: 0, ringsGot: 0, sprintLeft: 0 };

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
  CH.driftAcc = 0; CH.ringsGot = 0;
  const d = DEFIS[i];
  CH.sprintLeft = d.type === 'sprint' ? d.target : 0;
  if (d.type === 'rings') placePickups(); else hidePickups();
}

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
const dropSprite = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(16, 16, 1, 16, 16, 15);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.55, 'rgba(235,242,246,0.5)');
  g.addColorStop(1, 'rgba(235,242,246,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();
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
const mistSprite = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.35, 'rgba(244,252,255,0.28)');
  g.addColorStop(0.7, 'rgba(232,244,250,0.08)');
  g.addColorStop(1, 'rgba(232,244,250,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();
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
  const s = new THREE.Shape();
  const w = widthF, L = lengthF;
  s.moveTo(0, -2.05 * L);
  s.quadraticCurveTo(0.32 * w, -1.88 * L, 0.52 * w, -1.3 * L);
  s.quadraticCurveTo(0.69 * w, -0.65 * L, 0.67 * w, 0.15 * L);
  s.quadraticCurveTo(0.66 * w, 0.9 * L, 0.58 * w, 1.5 * L);
  s.lineTo(-0.58 * w, 1.5 * L);
  s.quadraticCurveTo(-0.66 * w, 0.9 * L, -0.67 * w, 0.15 * L);
  s.quadraticCurveTo(-0.69 * w, -0.65 * L, -0.52 * w, -1.3 * L);
  s.quadraticCurveTo(-0.32 * w, -1.88 * L, 0, -2.05 * L);
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
  // Peau bronzée légèrement satinée (reflet mouillé de la course).
  const skinM = new THREE.MeshPhysicalMaterial({ color: skinColor, roughness: 0.5, metalness: 0.0, sheen: 0.5, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xffe4cc), clearcoat: 0.22, clearcoatRoughness: 0.45, envMapIntensity: 0.6 });

  const scaleF = cfg.id === 'spark' ? 0.88 : 1.0;

  // Coque en trois couches extrudées à bords arrondis
  ski.add(hullLayer(1.0 * scaleF, scaleF, 0.3, hullM, 0.0));
  const stripe = hullLayer(1.04 * scaleF, 1.005 * scaleF, 0.045, accM, 0.3);
  ski.add(stripe);
  ski.add(hullLayer(0.94 * scaleF, 0.985 * scaleF, 0.24, deckM, 0.345));
  const hood = hullLayer(0.66 * scaleF, 0.62 * scaleF, 0.15, deckM, 0.585);
  hood.position.z = -0.75 * scaleF;
  ski.add(hood);

  // Selle
  const seat = new THREE.Mesh(new THREE.CapsuleGeometry(0.21 * scaleF, 1.0 * scaleF, 10, 24).rotateX(Math.PI / 2), seatM);
  seat.position.set(0, 0.72, 0.72 * scaleF);
  seat.scale.set(1.25, 0.75, 1);
  seat.castShadow = true;
  ski.add(seat);

  // Tapis de pieds, tuyère, sponsons, poignée arrière
  for (const sx of [-1, 1]) {
    const mat = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 1.3 * scaleF), rubber);
    mat.position.set(0.42 * sx * scaleF, 0.585, 0.55 * scaleF);
    mat.receiveShadow = true;
    ski.add(mat);
    const sponson = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.7 * scaleF), accM);
    sponson.position.set(0.66 * sx * scaleF, 0.16, 1.05 * scaleF);
    ski.add(sponson);
  }
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.3, 14).rotateX(Math.PI / 2), chrome);
  nozzle.position.set(0, 0.14, 1.62 * scaleF);
  ski.add(nozzle);
  const handleRear = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.025, 8, 16), chrome);
  handleRear.rotation.x = Math.PI / 2;
  handleRear.position.set(0, 0.6, 1.42 * scaleF);
  ski.add(handleRear);

  // Décalcos de marque sur les flancs
  const decal = decalTexture(cfg.brand, cfg.name, '#' + cfg.colors.accent.toString(16).padStart(6, '0'));
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.3 * scaleF, 0.32 * scaleF),
      new THREE.MeshBasicMaterial({ map: decal, transparent: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    p.position.set(0.665 * sx * scaleF, 0.32, 0.05);
    p.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    if (sx < 0) p.scale.x = 1;
    ski.add(p);
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
  // === TABLEAU DE BORD DIGITAL (façon Sea-Doo) : écran incliné vers le pilote ===
  const dashHousing = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.155, 0.05), new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.5 }));
  dashHousing.position.set(0, 0.225, 0.0); dashHousing.rotation.x = -0.5; barGroup.add(dashHousing);
  // Écran incliné, décalé LE LONG DE SA NORMALE (sin/cos du tilt) pour éviter le
  // z-fighting avec le boîtier, et double-face par sécurité d'orientation.
  const dashScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.255, 0.12),
    new THREE.MeshBasicMaterial({ map: gaugeTex, side: THREE.DoubleSide, toneMapped: false }));
  dashScreen.position.set(0, 0.225 + Math.sin(0.5) * 0.028, Math.cos(0.5) * 0.028);
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
  }

  /* ---- Corps du pilote (mode 3e personne, style motocross) ---- */
  riderBody = new THREE.Group();
  const helmetMat = new THREE.MeshStandardMaterial({ color: suitCfg.c, roughness: 0.32, metalness: 0.1, envMapIntensity: 0.6 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x0e1014, metalness: 0.75, roughness: 0.12, envMapIntensity: 0.9 });
  const vestMat = new THREE.MeshStandardMaterial({ color: suitCfg.c2, roughness: 0.55 });
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.30), suitM);
  hips.position.set(0, 0.9, 0.82 * scaleF); hips.rotation.x = 0.15; hips.castShadow = true;
  riderBody.add(hips);
  const sp1 = new THREE.Vector3(0, 0.92, 0.80 * scaleF), sp2 = new THREE.Vector3(0, 1.1, 0.56 * scaleF);
  const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, sp1.distanceTo(sp2), 8, 16), suitM);
  back.position.addVectors(sp1, sp2).multiplyScalar(0.5);
  back.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(sp2, sp1).normalize());
  back.castShadow = true; riderBody.add(back);
  const vest = new THREE.Mesh(new THREE.CapsuleGeometry(0.185, 0.22, 8, 16), vestMat);
  vest.position.set(0, 1.0, 0.66 * scaleF); vest.rotation.x = 0.7; vest.castShadow = true;
  riderBody.add(vest);
  const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.22), suitM);
  yoke.position.set(0, 1.08, 0.56 * scaleF); yoke.rotation.x = 0.2; riderBody.add(yoke);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.1, 10), skinM);
  neck.position.set(0, 1.16, 0.53 * scaleF); riderBody.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), skinM);
  head.position.set(0, 1.25, 0.5 * scaleF); riderBody.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.145, 24, 18), helmetMat);
  helmet.position.copy(head.position); helmet.scale.set(1, 1.05, 1.08); helmet.castShadow = true;
  riderBody.add(helmet);
  const helmStripe = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.17, 0.31), vestMat);
  helmStripe.position.set(0, 1.31, 0.5 * scaleF); riderBody.add(helmStripe);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 10, -0.7, 1.4, 1.15, 0.7), visorMat);
  visor.position.copy(head.position); visor.rotation.y = Math.PI; riderBody.add(visor);
  const chin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.075, 0.12), helmetMat);
  chin.position.set(0, 1.19, 0.40 * scaleF); chin.rotation.x = -0.2; riderBody.add(chin);
  const numPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ map: numberTex, transparent: true }));
  numPlate.position.set(0, 1.0, 0.9 * scaleF); riderBody.add(numPlate);
  riderBody.visible = false;
  ski.add(riderBody);

  /* ---- Jambes ---- */
  for (const s of [-1, 1]) {
    const hip = new THREE.Vector3(0.2 * s, 0.72, 0.95 * scaleF);
    const knee = new THREE.Vector3(0.3 * s, 0.86, 0.32 * scaleF);
    const foot = new THREE.Vector3(0.4 * s, 0.62, 0.5 * scaleF);
    const thighL = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, hip.distanceTo(knee), 12), suitM);
    thighL.position.addVectors(hip, knee).multiplyScalar(0.5);
    thighL.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(knee, hip).normalize());
    thighL.castShadow = true;
    ski.add(thighL);
    const kneeB = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), suitM);
    kneeB.position.copy(knee);
    ski.add(kneeB);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, knee.distanceTo(foot), 10), suitM);
    shin.position.addVectors(knee, foot).multiplyScalar(0.5);
    shin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(foot, knee).normalize());
    ski.add(shin);
    const bootie = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.26), new THREE.MeshStandardMaterial({ color: 0x191b20, roughness: 0.9 }));
    bootie.position.set(0.41 * s, 0.615, 0.42 * scaleF);
    ski.add(bootie);
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
    new THREE.PlaneGeometry(4.4, 5.8).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, opacity: 0.7, depthWrite: false })
  );
  contactRing.position.set(0, 0.1, 0.15);
  ski.add(contactRing);
  if (realModel) { ski.add(realModel); alignRideModel(); refreshModelMode(); }
}
function rebuildSki() {
  buildSki();
  if (realModel) realModel.visible = true;
  if (realRiderGroup) realRiderGroup.visible = (typeof camMode !== 'undefined' && camMode === 'chase');
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
  // Priorité au .glb s'il existe, sinon .obj
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
    if (realRiderGroup) realRiderGroup.visible = camMode === 'chase';
    console.info('[Vice Rider] Modèle réel intégré (garage + pilotage) :', label);
  }
  function loadGlb(url) {
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
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
    const osc1 = ctx.createOscillator(); osc1.type = 'sawtooth';
    const osc2 = ctx.createOscillator(); osc2.type = 'square';
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 320;
    const eGain = ctx.createGain(); eGain.gain.value = 0;
    osc1.connect(filter); osc2.connect(filter);
    filter.connect(eGain).connect(ctx.destination);
    osc1.start(); osc2.start();
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = nb.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = nb; noise.loop = true;
    const nFilter = ctx.createBiquadFilter(); nFilter.type = 'bandpass'; nFilter.frequency.value = 700; nFilter.Q.value = 0.6;
    const nGain = ctx.createGain(); nGain.gain.value = 0;
    noise.connect(nFilter).connect(nGain).connect(ctx.destination);
    const sFilter = ctx.createBiquadFilter(); sFilter.type = 'lowpass'; sFilter.frequency.value = 1100;
    const sGain = ctx.createGain(); sGain.gain.value = 0;
    noise.connect(sFilter).connect(sGain).connect(ctx.destination);
    noise.start();
    audio = { ctx, osc1, osc2, filter, eGain, nGain, sGain };
  } catch (e) { audio = null; }
}
function audioSplash(power) {
  if (!audio || muted) return;
  const g = audio.sGain.gain;
  const now = audio.ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(Math.min(0.3 * power, 0.4), now);
  g.exponentialRampToValueAtTime(0.001, now + 0.5);
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
let DRAFT_REST = 0.34;
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
let lastY = 0, slamCd = 0, camImpact = 0;
let plunge = 0, plungeV = 0;
// État caméra FPV : offsets lissés des forces G (la tête/le corps réagit à
// l'accél, aux virages, aux chocs) + suivi de la vitesse pour dériver l'accél.
const camG = { x: 0, z: 0, pitch: 0, roll: 0, yaw: 0 };
let camPrevSpeed = 0, camJolt = 0;
// Objectif mouillé (0..1) : monte aux gerbes/impacts, sèche progressivement.
let lensWet = 0;
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
window.__vice = { state, keys, toggleCam: () => toggleCam(), setNight: v => setNight(v), islands: palmIslands, gate, CH, DEFIS, enterDefi, setDraft: v => { DRAFT_REST = v; return DRAFT_REST; }, getDraft: () => DRAFT_REST };
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
  if (k === 'escape' && mode === 'ride') { toGarage(); return; }
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
if (btnNight) btnNight.addEventListener('click', () => setNight(!isNight));
document.getElementById('btn-garage').addEventListener('click', toGarage);
document.getElementById('btn-ride').addEventListener('click', startRide);

function startRide() {
  computePhys();
  mode = 'ride';
  camMode = 'fpv';
  ski.visible = true;
  ski.add(camera);
  camera.position.copy(CAM_BASE);
  camera.rotation.set(-0.17, 0, 0);
  if (realRiderGroup) realRiderGroup.visible = false;
  updateCockpitVisibility();
  setSeaLifeVisible(true);
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
}
function toGarage() {
  mode = 'menu';
  scene.attach(camera);
  state.x = 0; state.z = 0; state.speed = 0; state.vx = 0; state.vz = 0; state.throttle = 0; state.rpm = 0; state.yawRate = 0; state.yaw = 0; state.air = false;
  plunge = 0; plungeV = 0;
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
  if (audio) { audio.eGain.gain.value = 0; audio.nGain.gain.value = 0; }
}
function toggleCam() {
  if (camMode === 'fpv') {
    camMode = 'chase';
    scene.attach(camera);
  } else {
    camMode = 'fpv';
    ski.add(camera);
    camera.position.copy(CAM_BASE);
    camera.rotation.set(-0.17, 0, 0);
  }
  if (riderBody) riderBody.visible = camMode === 'chase' && !realModel;
  if (realRiderGroup) realRiderGroup.visible = camMode === 'chase';
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
function applyNightBloom() {
  if (!bloomPass) return;
  bloomPass.strength = isNight ? 0.5 : 0.22;
  bloomPass.threshold = isNight ? 0.58 : 0.9;
  bloomPass.radius = isNight ? 0.7 : 0.5;
}
function setNight(on) {
  // Capture l'état "jour" vivant au moment de basculer (le HDRI a pu mettre à
  // jour la couleur du soleil/brouillard après le chargement).
  if (on && !isNight) { dayState.sunC.copy(sun.color); dayState.hemiC.copy(hemi.color); dayState.hemiG.copy(hemi.groundColor); }
  isNight = on;
  uNight.value = on ? 1 : 0;
  renderer.toneMappingExposure = on ? 0.5 : dayState.exposure;
  sun.intensity = on ? 0.45 : dayState.sunI;
  hemi.intensity = on ? 0.5 : dayState.hemiI;
  if (on) { sun.color.set(0x9db4ff); hemi.color.set(0x3a4a80); hemi.groundColor.set(0x0a1226); }
  else { sun.color.copy(dayState.sunC); hemi.color.copy(dayState.hemiC); hemi.groundColor.copy(dayState.hemiG); }
  scene.fog.color.copy(on ? NIGHT_FOG : FOG_COLOR);
  oceanUniforms.uFogColor.value = on ? NIGHT_FOG : FOG_COLOR;
  const btn = document.getElementById('btn-night');
  if (btn) btn.textContent = on ? '☀️' : '🌙';
  applyNightBloom();
}
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
const hudThr = document.getElementById('hud-thr');
const hudThrPct = document.getElementById('hud-thr-pct');
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
let last = performance.now();
let simTime = 0;
let gaugeTick = 0;

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  let dt = Math.min((now - last) / 1000, 0.05);
  if (dt <= 0) dt = 0.016;
  last = now;
  simTime += dt;
  const t = simTime;
  resize(false);
  oceanUniforms.uTime.value = t;

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
      contactRing.material.opacity = 0.45 + 0.08 * Math.sin(t * 2.2);
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
  // Gâchette de gaz vers l'avant, gâchette de marche arrière (iBR façon Sea-Doo) au repos/frein
  if (up) state.throttle += dt * 0.7;
  else if (down) state.throttle -= dt * 0.9;
  else state.throttle *= Math.exp(-dt * 1.5);
  state.throttle = Math.max(-0.28, Math.min(1, state.throttle));
  const steering = left ? -1 : right ? 1 : 0;
  if (steering !== 0) state.rudder = Math.max(-1, Math.min(1, state.rudder + steering * dt * 4));
  else state.rudder *= Math.exp(-dt * 6);

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
  const ventilated = state.air || plunge > 0.06;
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

  /* ---- Flottaison + sauts ---- */
  /* Flottaison réaliste : tirant d'eau + ressort d'enfoncement de coque */
  const hw = waveHeight(state.x, state.z, t);
  // Assiette verticale : le modèle OBJ a le bas de coque à Y≈-0.79 sous l'origine
  // du ski. Pour que la ligne de flottaison tombe sur le tiers/moitié bas de la
  // coque (assis DANS l'eau, pas au-dessus), l'origine doit être ~0.54 AU-DESSUS
  // de la surface. Au planage la coque déjauge encore un peu (tirant réduit).
  // Au planage la coque déjauge ET la cuvette du shader s'estompe : les deux
  // remontent ensemble (+0.34 ici, cuvette -55% côté GPU).
  const draft = DRAFT_REST + planing * 0.34;
  const waterline = hw + draft;
  // Agitation locale de la mer : calme près de la côte, formée au large.
  const rough = Math.min(1.5, seaFactor(state.x, state.z));
  if (!state.air) {
    // Ressort MOU (eau "souple") : la coque s'enfonce franchement sous un choc
    // et la flottabilité la ramène LENTEMENT — c'est l'illusion de poids.
    // Raideur 11 (~0.53 s de période), amortissement 3.2 (rebond visible).
    plungeV += (-plunge * 11 - plungeV * 3.2) * dt;
    plunge += plungeV * dt;
    plunge = Math.max(-2.6, Math.min(0.15, plunge));
    const newY = waterline + plunge;
    state.vy = (newY - lastY) / dt;
    state.y = newY;
    // DÉCOLLAGE : seulement si l'eau SE DÉROBE devant la proue (sortie de
    // crête), pas à chaque oscillation. L'ancien seuil (vy>2.5 seul)
    // confondait la vitesse de suivi des vagues avec un saut : le jet passait
    // sa vie en micro-vols -> LE bug "il flotte au-dessus de l'eau".
    if (state.vy > 3.4 && state.speed > 14 && plunge > -0.15) {
      const hbow = waveHeight(state.x + fx * 2.2, state.z + fz * 2.2, t);
      if (hbow - state.y < -0.35) {
        state.air = true;
        state.airTime = 0;
        state.vy = Math.min(state.vy * 1.25, 7.0);
      }
    }
  } else {
    state.vy -= 9.8 * dt;
    state.y += state.vy * dt;
    state.airTime += dt;
    if (state.y <= waterline) {
      state.air = false;
      if (state.airTime > state.bestAir) state.bestAir = state.airTime;
      state.showAirUntil = t + 1.6;
      const impact = -state.vy;
      // On garde la vitesse verticale : la coque continue à plonger sous l'eau
      // au lieu de s'arrêter net à la surface. La flottabilité (ressort) la
      // ramènera à la ligne de flottaison en 1 à 2 s selon l'impact.
      plunge = state.y - waterline;
      plungeV = state.vy;
      state.y = waterline + plunge;
      if (impact > 1.5) {
        const power = Math.min(impact / 5, 1.8);
        spawnSplash(state.x, hw, state.z, power);
        burstDrops(state.x, hw, state.z, 30 + Math.floor(impact * 10), 0.7 + power * 0.6, fx * state.speed, fz * state.speed);
        lensDrops(4 + Math.floor(impact / 2));
        camImpact = Math.min(impact * 0.06, 0.5);
        camJolt = Math.min(impact * 0.5, 2.2);
        audioSplash(power);
        state.vx *= 0.88; state.vz *= 0.88; state.speed *= 0.88;
      }
      state.vy = 0;
    }
  }
  lastY = state.y;

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
    plungeV -= 0.8 * speedF;
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
    plungeV += Math.sin(t * 5.9 + state.z * 0.7) * 1.2 * chopK * dt;
  }

  const fThr = Math.max(0, thrust);
  let targetPitch, targetRoll;
  if (state.air) {
    targetPitch = Math.max(-0.45, Math.min(0.45, -Math.atan2(state.vy, Math.max(spd, 6)) * 0.8));
    targetRoll = -state.rudder * 0.15;
  } else {
    // Cabrage au hole-shot (proue haute quand on remet les gaz), puis quand on
    // lâche à vitesse la proue pique et la coque laboure l'eau : le terme
    // (fThr - speedF) fait les deux d'un coup, sans état supplémentaire.
    targetPitch = Math.atan2(hStern - hBow, 3.5) * 1.15 - (fThr - speedF) * 0.20 + 0.02;
    // Un jetski se couche DANS le virage (le carre intérieur mord) : roulis dans
    // le sens de la barre, d'autant plus marqué qu'on va vite et qu'on est au gaz.
    targetRoll = -state.rudder * 0.72 * Math.min(spd / 12, 1) * (0.4 + 0.6 * fThr) * (vForward < 0 ? -1 : 1) + Math.atan2(hRight - hLeft, 1.3) * 0.42;
    // Clapot : roulis/tangage désordonnés à vitesse sur l'eau formée.
    const chop = rough * speedF;
    targetRoll += Math.sin(t * 3.9 + state.x * 0.5) * 0.05 * chop;
    targetPitch += Math.sin(t * 4.6 + state.z * 0.6) * 0.04 * chop;
    // Basse vitesse : comportement flottant (roule/tangue mollement, peu précis).
    const idle = 1 - speedF;
    targetRoll += Math.sin(t * 1.05) * 0.045 * idle;
    targetPitch += Math.sin(t * 0.85 + 1.3) * 0.035 * idle;
  }
  const sFast = 1 - Math.exp(-dt * 6);
  state.pitch += (targetPitch - state.pitch) * sFast;
  state.roll += (targetRoll - state.roll) * sFast;

  ski.position.set(state.x, state.y, state.z);
  ski.rotation.y = state.yaw;
  ski.rotation.x = state.pitch;
  ski.rotation.z = state.roll + (state.air ? 0 : Math.sin(t * 9) * 0.01 * speedF);
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
  // Le pilote contre-penche dans les virages et se ramasse dans les sauts (moto)
  if (riderBody && riderBody.visible) {
    riderBody.rotation.z = -state.roll * 0.45;
    riderBody.rotation.x = -state.throttle * 0.05 + (state.air ? -0.12 : 0);
  }

  // Soleil + ombre suivent le jetski
  sun.position.set(state.x + sunDir.x * 40, sunDir.y * 40, state.z + sunDir.z * 40);
  sun.target.position.set(state.x, state.y, state.z);

  /* ---- Caméra ---- */
  camImpact *= Math.exp(-dt * 5);
  camJolt *= Math.exp(-dt * 9);
  if (camMode === 'fpv') {
    // === CAMÉRA FPV VIVANTE ===
    // La caméra est enfant du ski : elle hérite déjà de son cap/tangage/roulis.
    // On AJOUTE par-dessus le ressenti humain : vibration moteur, clapot,
    // forces G (accél/virage), coups d'impact, regard dans le virage, flottement.
    const smoothG = 1 - Math.exp(-dt * 8);
    // 1) Vibration : moteur (rpm) + buzz du clapot à vitesse, multi-fréquence.
    const vib = state.air ? 0.0015 : (0.0025 + state.rpm * 0.005 + rough * speedF * 0.012);
    const bobX = (Math.sin(t * 22.0) * 0.6 + Math.sin(t * 38.7) * 0.4) * vib;
    const bobY = (Math.sin(t * 26.5) * 0.6 + Math.sin(t * 44.3) * 0.4) * vib + Math.sin(t * 12.0) * state.rpm * 0.003;
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
      CAM_BASE.y + bobY - camImpact - camJolt * 0.12,
      CAM_BASE.z + camG.z
    );
    camera.rotation.set(
      -0.17 - camImpact * 0.6 - camJolt * 0.18 + camG.pitch + airPitch + bobY * 0.35,
      camG.yaw,
      camG.roll + bobX * 0.5
    );
  } else {
    chaseTarget.set(state.x - fx * 6.6 - rx * state.rudder * 1.2, state.y + 2.45, state.z - fz * 6.6 - rz * state.rudder * 1.2);
    camera.position.lerp(chaseTarget, 1 - Math.exp(-dt * 4.5));
    camera.lookAt(state.x + fx * 4, state.y + 1.1, state.z + fz * 4);
  }
  const targetFov = 74 + 11 * speedF;
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
  for (const sp of sprays) {
    // Gerbes en V de proue : liées au PLANAGE (une coque déjaugée fend l'eau et
    // projette latéralement ; à basse vitesse, presque rien).
    sp.material.opacity = state.air ? 0 : (0.15 * speedF + 0.55 * planing) * (0.6 + 0.4 * Math.sin(t * 14 + sp.position.x * 9));
    sp.scale.set(1 + planing * 0.5, 1 + speedF * 1.6 + planing * 0.6, 1);
  }
  // Anneau d'écume : collé à la hauteur d'eau LOCALE (pas à la coque) -> il
  // marque la ligne de flottaison même quand la coque plonge ou déjauge.
  if (contactRing) {
    contactRing.visible = !state.air;
    contactRing.position.y = hw - state.y + 0.05;
    contactRing.material.opacity = (0.26 + 0.22 * Math.min(state.rpm + speedF, 1)) * (0.8 + 0.2 * Math.sin(t * 6.3));
    const cs = 1 + speedF * 0.3 + Math.sin(t * 4.1) * 0.05;
    contactRing.scale.set(cs, 1, cs);
    contactRing.rotation.y = Math.sin(t * 0.7) * 0.25;
  }
  for (const wk of wakes) {
    wk.material.opacity = state.air ? 0 : speedF * 0.42 * (0.75 + 0.25 * Math.sin(t * 6 + wk.position.x * 5));
    wk.scale.set(1 + speedF * 0.6, 1, 1 + speedF * 0.8);
  }
  if (sternWash) {
    // Bout dès que la turbine tourne, collé à la flottaison comme l'anneau
    sternWash.position.y = hw - state.y + 0.07;
    sternWash.material.opacity = state.air ? 0 : (0.25 * state.rpm + Math.min(Math.abs(state.speed) / 8, 1) * 0.45) * (0.8 + 0.2 * Math.sin(t * 11));
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
  if (!state.air && Math.abs(state.speed) > 2) {
    // Émission continue proportionnelle à la vitesse (fine traînée d'écume)
    const emitPerSec = 5 + speedF * 20;
    wakeAccum += emitPerSec * dt;
    while (wakeAccum >= 1) {
      wakeAccum -= 1;
      const jitterX = (Math.random() - 0.5) * 0.35;
      const jitterZ = (Math.random() - 0.5) * 0.35;
      spawnWake(sternX + jitterX, sternY, sternZ + jitterZ, 0.6 + speedF * 1.0, 1.8 + speedF * 1.2);
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
    // Note moteur pilotée par le RÉGIME turbine : sous charge = grave/plein,
    // et quand la pompe ventile (saut/crête) le moteur s'emballe -> aigu.
    const engHz = 34 + speedF * 56 + state.rpm * 84;
    audio.osc1.frequency.value = engHz;
    audio.osc2.frequency.value = engHz * 0.5;
    audio.osc1.detune.value = Math.sin(t * 9) * 12 * state.rpm;
    // Sous l'eau : tout est étouffé
    const muffle = plunge < -0.3 ? 0.22 : 1;
    audio.filter.frequency.value = (260 + speedF * 560) * muffle;
    audio.eGain.gain.value = muted ? 0 : (0.02 + Math.abs(state.throttle) * 0.045) * (plunge < -0.3 ? 0.5 : 1);
    audio.nGain.gain.value = muted || state.air ? 0 : speedF * 0.05 * muffle;
  }

  /* ---- HUD ---- */
  const kmh = state.speed * 3.6;
  gaugeTick++;
  if (gaugeTick % 2 === 0) drawOdo(Math.abs(kmh), state.throttle, MODELS.find(m => m.id === sel.ski).brand, kmh < -0.5);
  hudSpeed.textContent = (kmh < -0.5 ? 'R ' : '') + Math.round(Math.abs(kmh)) + ' km/h';
  let hdg = ((-state.yaw * 180 / Math.PI) % 360 + 360) % 360;
  hudHeading.textContent = String(Math.round(hdg)).padStart(3, '0') + '° ' + CARDINALS[Math.round(hdg / 45) % 8];
  hudThrPct.textContent = Math.round(state.throttle * 100) + '%';
  hudThr.style.width = Math.max(0, state.throttle * 100) + '%';
  hudThr.style.background = state.throttle < 0 ? '#ff9c1a' : '#ff5c8a';
  hudBest.textContent = state.bestAir.toFixed(2) + ' s';
  if (state.air) {
    hudAir.style.opacity = '1';
    hudAir.textContent = 'air ' + state.airTime.toFixed(2) + ' s';
  } else if (t < state.showAirUntil) {
    hudAir.style.opacity = '1';
  } else {
    hudAir.style.opacity = '0';
  }

  // Objectif mouillé : sèche en continu, se remouille à vitesse sur mer formée
  // et se prend une giclée aux impacts (camJolt). Plein effet en FPV.
  lensWet = Math.min(1, Math.max(0, lensWet - dt * 0.4) + camJolt * 0.14 + (state.air ? 0 : speedF * rough * dt * 0.7));
  updateFilm(t, speedF, camMode === 'fpv' ? lensWet : lensWet * 0.4);
  composer.render();
}
requestAnimationFrame(frame);
