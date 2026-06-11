// COLOR mode globe — port of the "Globe Loader · 3D biome" standalone.
// Procedural shader globe: real land mask (world-atlas), baked mountain
// potential from real ranges, dune fields, instanced Pixar-style foliage,
// atmosphere shell. No external textures.
//
// Differences from the standalone:
//   • OrthographicCamera in PIXEL units, with the globe group scaled to the
//     d3 projection's scale and positioned at its translate — so the 2D HUD
//     overlay (mission pins, halos, particles) lines up exactly on top.
//   • No drag interaction, no tweaks panel — rotation is driven each frame
//     from state.globe (same lambda/rotateLat the d3 projection uses).
//   • REAL day/night: uLight follows the live subsolar point, so the
//     terminator on screen matches where it actually is right now.
//
// three.js is imported lazily by main.js only when color mode activates.

import * as THREE from 'three';
import { feature } from 'topojson-client';
import { geoEquirectangular, geoPath } from 'd3-geo';
import world from 'world-atlas/land-110m.json';

const TWEAKS = {
  spinSpeed: 0.8,        // unused (we drive rotation from state) — kept for parity
  mountainHeight: 0.37,
  duneIntensity: 0.022,
  showFoliage: true,
  sparseAlpha: 0.17,
  denseAlpha: 0.48,
  mtnBoost: 0.6,
  atmoIntensity: 1.06,
};

let renderer, scene, camera;
let tiltGroup, pitchPivot, yawPivot;
let globeUniforms, atmoUniforms, wireSparseUniforms, wireDenseUniforms;
let sunLight, sunAnchor;
let canvasEl = null;
let disposed = false;

// ---------------------------------------------------------------- helpers

function latLonToPos(lat, lon, radius = 1.0) {
  const phi = lat * Math.PI / 180;
  const lam = lon * Math.PI / 180;
  return new THREE.Vector3(
    Math.cos(phi) * Math.cos(lam) * radius,
    Math.sin(phi) * radius,
    -Math.cos(phi) * Math.sin(lam) * radius,
  );
}

// Subsolar point right now. Declination via the standard approximation;
// longitude from UTC time (equation-of-time omitted — ±4° is invisible here).
export function subsolarPoint(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = (date.getTime() - start) / 86400000;
  const decl = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const lng = (12 - utcHours) * 15; // sun overhead at noon UTC on the prime meridian
  return { lat: decl, lng: ((lng + 540) % 360) - 180 };
}

// ---------------------------------------------------------------- bakes

function bakeLandMask() {
  const MASK_W = 2048, MASK_H = 1024;
  const cv = document.createElement('canvas');
  cv.width = MASK_W; cv.height = MASK_H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, MASK_W, MASK_H);
  const land = feature(world, world.objects.land);
  const proj = geoEquirectangular()
    .scale(MASK_W / (2 * Math.PI))
    .translate([MASK_W / 2, MASK_H / 2]);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  geoPath(proj, ctx)(land);
  ctx.fill();
  return cv;
}

function bakeMountains() {
  const W = 2048, H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, W, H);
  x.globalCompositeOperation = 'lighter';

  const ranges = [
    { lat: 28,  lon: 86,   r: 9,  h: 1.00 }, { lat: 35,  lon: 76,   r: 6,  h: 0.95 },
    { lat: 33,  lon: 88,   r: 18, h: 0.62 }, { lat: 38,  lon: 73,   r: 6,  h: 0.78 },
    { lat: 36,  lon: 71,   r: 6,  h: 0.72 }, { lat: 42,  lon: 80,   r: 8,  h: 0.68 },
    { lat: 50,  lon: 88,   r: 7,  h: 0.40 }, { lat: 27,  lon: 96,   r: 6,  h: 0.55 },
    { lat: -10, lon: -76,  r: 5,  h: 0.78 }, { lat: -20, lon: -67,  r: 5,  h: 0.82 },
    { lat: -32, lon: -70,  r: 5,  h: 0.82 }, { lat: -45, lon: -72,  r: 5,  h: 0.55 },
    { lat: 0,   lon: -78,  r: 4,  h: 0.62 }, { lat: 8,   lon: -73,  r: 4,  h: 0.50 },
    { lat: 19,  lon: -99,  r: 4,  h: 0.55 }, { lat: 40,  lon: -106, r: 6,  h: 0.55 },
    { lat: 47,  lon: -114, r: 6,  h: 0.48 }, { lat: 37,  lon: -118, r: 4,  h: 0.50 },
    { lat: 46,  lon: -121, r: 4,  h: 0.45 }, { lat: 63,  lon: -151, r: 5,  h: 0.65 },
    { lat: 60,  lon: -138, r: 5,  h: 0.55 }, { lat: 36,  lon: -82,  r: 6,  h: 0.20 },
    { lat: 46,  lon: 10,   r: 4,  h: 0.55 }, { lat: 42,  lon: 1,    r: 3,  h: 0.40 },
    { lat: 43,  lon: 43,   r: 4,  h: 0.62 }, { lat: 62,  lon: 10,   r: 4,  h: 0.30 },
    { lat: 60,  lon: 60,   r: 4,  h: 0.28 }, { lat: 42,  lon: 20,   r: 3,  h: 0.32 },
    { lat: 41,  lon: 14,   r: 3,  h: 0.28 }, { lat: 32,  lon: -5,   r: 5,  h: 0.42 },
    { lat: -3,  lon: 37,   r: 4,  h: 0.55 }, { lat: 0,   lon: 30,   r: 3,  h: 0.42 },
    { lat: 13,  lon: 39,   r: 5,  h: 0.45 }, { lat: -29, lon: 29,   r: 4,  h: 0.28 },
    { lat: -5,  lon: 144,  r: 5,  h: 0.62 }, { lat: -32, lon: 148,  r: 5,  h: 0.18 },
    { lat: 36,  lon: 138,  r: 3,  h: 0.32 }, { lat: 24,  lon: 121,  r: 2,  h: 0.30 },
    { lat: 72,  lon: -40,  r: 14, h: 0.40 }, { lat: -78, lon: -86,  r: 6,  h: 0.55 },
    { lat: -75, lon: 0,    r: 18, h: 0.35 },
  ];

  for (const rng of ranges) {
    const u = ((rng.lon + 180) / 360) * W;
    const v = ((90 - rng.lat) / 180) * H;
    const rY = (rng.r / 180) * H;
    const cosLat = Math.max(0.18, Math.cos(rng.lat * Math.PI / 180));
    const rX = rY / cosLat;
    for (const dx of [-W, 0, W]) {
      x.save();
      x.translate(u + dx, v);
      x.scale(rX / rY, 1);
      const g = x.createRadialGradient(0, 0, 0, 0, 0, rY);
      const p = Math.round(rng.h * 255), m = Math.round(rng.h * 180), s = Math.round(rng.h * 70);
      g.addColorStop(0.00, `rgba(${p},${p},${p},1)`);
      g.addColorStop(0.35, `rgba(${m},${m},${m},0.75)`);
      g.addColorStop(0.70, `rgba(${s},${s},${s},0.30)`);
      g.addColorStop(1.00, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(-rY * 6, -rY, rY * 12, rY * 2);
      x.restore();
    }
  }
  return cv;
}

function bakeDunes() {
  const W = 2048, H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');
  const img = cx.createImageData(W, H);

  function rand(ix, iy, s) {
    let v = (ix * 374761393 + iy * 668265263 + s * 1664525) | 0;
    v = (v ^ (v >>> 13)) | 0;
    v = Math.imul(v, 1274126177) | 0;
    return ((v >>> 0) % 100000) / 100000;
  }
  const smoo = t => t * t * (3 - 2 * t);
  function vnoise(xx, yy, s) {
    const x0 = Math.floor(xx), y0 = Math.floor(yy);
    const fx = xx - x0, fy = yy - y0;
    const a = rand(x0, y0, s), b = rand(x0 + 1, y0, s);
    const c = rand(x0, y0 + 1, s), d = rand(x0 + 1, y0 + 1, s);
    const ux = smoo(fx), uy = smoo(fy);
    return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
  }
  const fbm2 = (xx, yy) =>
    vnoise(xx, yy, 1) * 0.55 + vnoise(xx * 2.1 + 7, yy * 2.1 + 3, 2) * 0.27 + vnoise(xx * 4.3 + 11, yy * 4.3 + 5, 3) * 0.18;

  const fields = [
    { latMin: 16, latMax: 30, lonMin: -12, lonMax: 32,  windDeg: 20, freq: 0.55, intensity: 1.00 },
    { latMin: 13, latMax: 22, lonMin: -8,  lonMax: 25,  windDeg: 50, freq: 0.70, intensity: 0.65 },
    { latMin: 17, latMax: 27, lonMin: 42,  lonMax: 56,  windDeg: 60, freq: 0.55, intensity: 0.95 },
    { latMin: 24, latMax: 30, lonMin: 69,  lonMax: 76,  windDeg: 30, freq: 0.60, intensity: 0.78 },
    { latMin: 38, latMax: 46, lonMin: 53,  lonMax: 68,  windDeg: 85, freq: 0.55, intensity: 0.55 },
    { latMin: 36, latMax: 42, lonMin: 78,  lonMax: 91,  windDeg: 80, freq: 0.55, intensity: 0.85 },
    { latMin: 39, latMax: 47, lonMin: 95,  lonMax: 110, windDeg: 55, freq: 0.55, intensity: 0.50 },
    { latMin: -27, latMax: -20, lonMin: 13,  lonMax: 17,  windDeg: -30, freq: 0.55, intensity: 0.90 },
    { latMin: -26, latMax: -19, lonMin: 18,  lonMax: 23,  windDeg: 5,   freq: 0.55, intensity: 0.55 },
    { latMin: -26, latMax: -19, lonMin: -71, lonMax: -69, windDeg: 0,   freq: 0.75, intensity: 0.70 },
    { latMin: -33, latMax: -22, lonMin: 119, lonMax: 145, windDeg: 60,  freq: 0.55, intensity: 0.85 },
    { latMin: 27, latMax: 37, lonMin: -116, lonMax: -104, windDeg: 35,  freq: 0.55, intensity: 0.55 },
    { latMin: -49, latMax: -41, lonMin: -72, lonMax: -67, windDeg: 0,   freq: 0.60, intensity: 0.35 },
  ];

  for (const f of fields) {
    const u0 = ((f.lonMin + 180) / 360) * W;
    const u1 = ((f.lonMax + 180) / 360) * W;
    const v0 = ((90 - f.latMax) / 180) * H;
    const v1 = ((90 - f.latMin) / 180) * H;
    const cu = (u0 + u1) * 0.5, cv2 = (v0 + v1) * 0.5;
    const halfU = (u1 - u0) * 0.5, halfV = (v1 - v0) * 0.5;
    const baseAng = f.windDeg * Math.PI / 180;
    const x0 = Math.max(0, Math.floor(u0 - 4)), x1 = Math.min(W, Math.ceil(u1 + 4));
    const y0 = Math.max(0, Math.floor(v0 - 4)), y1 = Math.min(H, Math.ceil(v1 + 4));
    const d = img.data;
    for (let y = y0; y < y1; y++) {
      for (let xx = x0; xx < x1; xx++) {
        const du = (xx - cu) / halfU, dv = (y - cv2) / halfV;
        const fieldMask = Math.max(0, 1 - (du * du + dv * dv) * 1.10);
        if (fieldMask < 0.04) continue;
        const ang = baseAng + (fbm2(xx * 0.004, y * 0.004) - 0.5) * 0.85;
        const px = -Math.sin(ang), py = Math.cos(ang);
        const proj = xx * px + y * py;
        const wobble = (fbm2(xx * 0.018, y * 0.018) - 0.5) * 28 + (fbm2(xx * 0.05, y * 0.05) - 0.5) * 8;
        const wave = Math.sin((proj + wobble) * f.freq);
        const ridge = wave > 0 ? Math.pow(wave, 0.62) : 0;
        const modAmp = 0.75 + 0.25 * fbm2(xx * 0.012, y * 0.012);
        const h = ridge * f.intensity * fieldMask * modAmp;
        const i = (y * W + xx) * 4;
        const rNew = Math.min(255, Math.round(h * 255));
        if (rNew > d[i]) d[i] = rNew;
        const gNew = Math.min(255, Math.round(fieldMask * f.intensity * 255));
        if (gNew > d[i + 1]) d[i + 1] = gNew;
        d[i + 3] = 255;
      }
    }
  }
  cx.putImageData(img, 0, 0);
  return cv;
}

// ---------------------------------------------------------------- shaders

const noiseGLSL = /* glsl */ `
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0);
    const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy));
    vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz);
    vec3 l=1.0-g;
    vec3 i1=min(g.xyz,l.zxy);
    vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx;
    vec3 x2=x0-i2+C.yyy;
    vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(
             i.z+vec4(0.0,i1.z,i2.z,1.0))
           + i.y+vec4(0.0,i1.y,i2.y,1.0))
           + i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857;
    vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z);
    vec4 x_=floor(j*ns.z);
    vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy;
    vec4 y=y_*ns.x+ns.yyyy;
    vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy);
    vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0;
    vec4 s1=floor(b1)*2.0+1.0;
    vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
    vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x);
    vec3 p1=vec3(a0.zw,h.y);
    vec3 p2=vec3(a1.xy,h.z);
    vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
    m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }
  float fbm(vec3 p){
    float f=0.0, a=0.5;
    for(int i=0;i<5;i++){ f+=a*snoise(p); p*=2.03; a*=0.5; }
    return f;
  }
  float ridged(vec3 p){
    float f=0.0, a=0.5;
    for(int i=0;i<5;i++){
      float n = 1.0 - abs(snoise(p));
      n = n*n;
      f += a*n; p*=2.05; a*=0.5;
    }
    return f;
  }
`;

const sampleLandGLSL = /* glsl */ `
  float sampleLand(vec2 uv){
    uv.x = fract(uv.x);
    return texture2D(uLand, uv).r;
  }
  float smoothLand(vec2 uv){
    float r = 0.0;
    float w = 0.0;
    for(int i=-1;i<=1;i++){
      for(int j=-1;j<=1;j++){
        vec2 o = vec2(float(i), float(j)) * (1.0/1024.0);
        r += sampleLand(uv + o);
        w += 1.0;
      }
    }
    return r / w;
  }
`;

const vertexShader = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosL;
  varying vec2 vUv;
  varying float vLand;
  varying float vElev;
  varying float vMoist;
  varying float vMountain;
  varying float vDuneR;
  varying float vDuneF;

  uniform sampler2D uLand;
  uniform sampler2D uMtn;
  uniform sampler2D uDune;
  uniform float uTime;
  uniform float uMtnAmp;
  uniform float uDuneAmp;

  ${noiseGLSL}
  ${sampleLandGLSL}

  vec2 sphereUV(vec3 p){
    float u = atan(-p.z, p.x) / (2.0 * 3.14159265) + 0.5;
    float v = asin(clamp(p.y, -1.0, 1.0)) / 3.14159265 + 0.5;
    return vec2(u, v);
  }

  void main(){
    vec3 n = normalize(position);
    vec2 uvS = sphereUV(n);
    vUv = uvS;

    float land = smoothLand(uvS);
    float landSharp = smoothstep(0.30, 0.55, land);
    vLand = landSharp;

    float warp = fbm(n * 2.3 + vec3(11.0));
    float potential = texture2D(uMtn, uvS).r;
    float ridge = ridged(n * 5.2 + vec3(3.7, 1.1, 9.3));
    float ridgeShape = mix(0.55, 1.0, smoothstep(0.25, 0.85, ridge));
    float mountainMask = potential * ridgeShape;
    vMountain = mountainMask;

    float hills = fbm(n * 6.0 + vec3(22.0));
    float moist = fbm(n * 2.1 + vec3(57.0)) * 0.5 + 0.5;
    float lat = abs(asin(n.y) / 1.5707963);
    float desertBand = smoothstep(0.20, 0.32, lat) * (1.0 - smoothstep(0.35, 0.55, lat));
    moist = clamp(moist - desertBand * 0.45, 0.0, 1.0);
    vMoist = moist;

    float ocean   = -0.012 * (0.5 + 0.5 * warp);
    float plain   =  0.014 + 0.010 * hills;
    float mtns    =  uMtnAmp * mountainMask;

    vec2 duneSamp = texture2D(uDune, uvS).rg;
    vDuneR = duneSamp.r;
    vDuneF = duneSamp.g;
    float duneSuppress = 1.0 - smoothstep(0.30, 0.65, mountainMask);
    float duneBase  = duneSamp.g * 0.006 * duneSuppress;
    float duneRidge = duneSamp.r * uDuneAmp * duneSuppress;

    float elev = mix(ocean, plain + mtns + duneBase + duneRidge, landSharp);
    vElev = elev;

    vec3 displaced = position + n * elev;
    vec4 wpos = modelMatrix * vec4(displaced, 1.0);
    vPosL = wpos.xyz;
    vNormalW = normalize(mat3(modelMatrix) * n);
    gl_Position = projectionMatrix * viewMatrix * wpos;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosL;
  varying vec2 vUv;
  varying float vLand;
  varying float vElev;
  varying float vMoist;
  varying float vMountain;
  varying float vDuneR;
  varying float vDuneF;

  uniform vec3 uLight;
  uniform float uTime;

  ${noiseGLSL}

  vec3 paletteOcean(float depth, vec2 uv){
    vec3 deep    = vec3(0.04, 0.13, 0.27);
    vec3 mid     = vec3(0.07, 0.27, 0.46);
    vec3 shallow = vec3(0.20, 0.55, 0.66);
    float d = clamp(-depth * 60.0, 0.0, 1.0);
    vec3 c = mix(shallow, mid, smoothstep(0.0, 0.3, d));
    c = mix(c, deep, smoothstep(0.3, 1.0, d));
    float ripple = fbm(vec3(uv * 30.0, 0.0)) * 0.04;
    return c + ripple;
  }

  vec3 paletteLand(float elev, float moist, float lat, float mountain, vec2 uv){
    vec3 beach    = vec3(0.88, 0.80, 0.55);
    vec3 grass    = vec3(0.38, 0.58, 0.22);
    vec3 forest   = vec3(0.16, 0.39, 0.18);
    vec3 jungle   = vec3(0.08, 0.32, 0.13);
    vec3 desert   = vec3(0.86, 0.71, 0.41);
    vec3 savanna  = vec3(0.72, 0.66, 0.32);
    vec3 tundra   = vec3(0.55, 0.58, 0.50);
    vec3 rock     = vec3(0.47, 0.41, 0.34);
    vec3 snow     = vec3(0.95, 0.96, 0.98);

    vec3 base;
    if (lat > 0.78) {
      base = mix(tundra, snow, smoothstep(0.78, 0.95, lat));
    } else if (lat > 0.55) {
      base = mix(tundra, forest, smoothstep(0.55, 0.72, moist));
    } else if (lat > 0.32) {
      base = mix(desert, mix(grass, forest, smoothstep(0.45, 0.75, moist)), smoothstep(0.25, 0.55, moist));
    } else {
      if (moist < 0.35) base = mix(desert, savanna, smoothstep(0.15, 0.4, moist));
      else if (moist < 0.6) base = mix(savanna, forest, smoothstep(0.35, 0.6, moist));
      else base = mix(forest, jungle, smoothstep(0.55, 0.85, moist));
    }

    float beachMix = 1.0 - smoothstep(0.015, 0.04, elev);
    base = mix(base, beach, beachMix * 0.85);

    float snowLine = mix(0.16, 0.05, smoothstep(0.40, 0.85, lat));
    float rockMix = smoothstep(snowLine * 0.45, snowLine, elev);
    base = mix(base, rock, rockMix * 0.75);
    float snowMix = smoothstep(snowLine, snowLine + 0.05, elev);
    base = mix(base, snow, snowMix);

    float grain = fbm(vec3(uv * 80.0, 0.0)) * 0.07;
    base += (grain - 0.035) * 0.5;
    return base;
  }

  void main(){
    float lat = clamp(abs(vUv.y - 0.5) * 2.0, 0.0, 1.0);

    float coast = smoothstep(0.30, 0.65, vLand);
    vec3 oceanC = paletteOcean(vElev, vUv);
    vec3 landC  = paletteLand(max(vElev, 0.0), vMoist, lat, vMountain, vUv);
    vec3 color = mix(oceanC, landC, coast);

    float duneFieldFade = smoothstep(0.08, 0.45, vDuneF)
                        * (1.0 - smoothstep(0.30, 0.65, vMountain));
    if (duneFieldFade > 0.001) {
      vec3 sandShade = vec3(0.78, 0.66, 0.42);
      vec3 sandLight = vec3(0.94, 0.84, 0.58);
      vec3 sandColor = mix(sandShade, sandLight, smoothstep(0.0, 0.8, vDuneR));
      color = mix(color, sandColor, duneFieldFade);
    }

    vec3 N = normalize(vNormalW);
    vec3 L = normalize(uLight);
    vec3 V = normalize(cameraPosition - vPosL);

    float ndl  = dot(N, L);
    float wrap = ndl * 0.5 + 0.5;
    float diff = pow(clamp(wrap, 0.0, 1.0), 1.4);

    float sky    = N.y * 0.5 + 0.5;
    vec3  keyCol = vec3(1.06, 0.97, 0.84);
    vec3  fillCol= vec3(0.40, 0.50, 0.66);
    vec3  ambient= mix(vec3(0.19, 0.21, 0.26), fillCol * 0.62, sky);

    vec3 lit = color * (ambient + keyCol * diff * 0.95);

    float term = smoothstep(-0.28, 0.32, ndl);
    vec3 nightTint = color * 0.15 + vec3(0.03, 0.035, 0.06);
    color = mix(nightTint, lit, term);

    if (vLand < 0.5) {
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), 64.0);
      color += keyCol * spec * 0.55 * term;
    }

    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.6);
    vec3 rimCol = mix(vec3(0.98, 0.74, 0.46), vec3(0.42, 0.64, 0.94), 0.45);
    color += rimCol * fres * 0.40;

    color = color / (color + vec3(0.85)) * 1.85;
    float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(lum), color, 1.18);
    color = pow(max(color, 0.0), vec3(0.92));

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ---------------------------------------------------------------- foliage

function mergeGeoms(list) {
  const geos = list.map(g => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  geos.forEach(g => { total += g.attributes.position.count; });
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  let o = 0;
  geos.forEach(g => {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  });
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return m;
}

function bakeFoliageGeoms() {
  const TE = 0.014;
  const eTrunk = new THREE.CylinderGeometry(0.0022, 0.0034, TE, 8);
  eTrunk.translate(0, TE * 0.5, 0);
  const t1 = new THREE.ConeGeometry(0.019, 0.024, 16);  t1.translate(0, TE + 0.009, 0);
  const t2 = new THREE.ConeGeometry(0.0145, 0.022, 16); t2.translate(0, TE + 0.024, 0);
  const t3 = new THREE.ConeGeometry(0.0095, 0.020, 16); t3.translate(0, TE + 0.039, 0);
  const tip = new THREE.SphereGeometry(0.0052, 12, 10); tip.translate(0, TE + 0.050, 0);
  const c1 = new THREE.SphereGeometry(0.006, 10, 8);    c1.translate(0, TE + 0.021, 0);
  const c2 = new THREE.SphereGeometry(0.005, 10, 8);    c2.translate(0, TE + 0.035, 0);
  const everCanopy = mergeGeoms([t1, c1, t2, c2, t3, tip]);

  const TC = 0.020;
  const cTrunk = new THREE.CylinderGeometry(0.0034, 0.0048, TC, 8);
  cTrunk.translate(0, TC * 0.5, 0);
  const b1 = new THREE.IcosahedronGeometry(0.020, 2); b1.translate(0, TC + 0.012, 0);
  const b2 = new THREE.IcosahedronGeometry(0.014, 2); b2.translate(0.014, TC + 0.007, 0.005);
  const b3 = new THREE.IcosahedronGeometry(0.013, 2); b3.translate(-0.012, TC + 0.009, -0.006);
  const b4 = new THREE.IcosahedronGeometry(0.011, 2); b4.translate(0.004, TC + 0.021, -0.004);
  const canCanopy = mergeGeoms([b1, b2, b3, b4]);
  canCanopy.scale(1.0, 0.92, 1.0);

  return { everCanopy, everTrunk: eTrunk, canCanopy, canTrunk: cTrunk };
}

const foliageVert = /* glsl */ `
  varying vec3 vWN;
  varying vec3 vWP;
  varying vec3 vICol;
  varying float vLocalY;
  void main(){
    vec3 transformed = position;
    vec3 objNormal   = normal;
    #ifdef USE_INSTANCING
      transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
      objNormal   = mat3(instanceMatrix) * objNormal;
    #endif
    vec3 icol = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      icol = instanceColor;
    #endif
    vICol = icol;
    vLocalY = position.y;
    vec4 wp = modelMatrix * vec4(transformed, 1.0);
    vWP = wp.xyz;
    vWN = normalize(mat3(modelMatrix) * objNormal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const foliageFrag = /* glsl */ `
  varying vec3 vWN;
  varying vec3 vWP;
  varying vec3 vICol;
  varying float vLocalY;
  uniform vec3 uLight;
  uniform vec3 uBase;
  uniform vec3 uRim;
  void main(){
    vec3 N = normalize(vWN);
    vec3 L = normalize(uLight);
    vec3 V = normalize(cameraPosition - vWP);
    float wrap = dot(N, L) * 0.5 + 0.5;
    float diff = pow(clamp(wrap, 0.0, 1.0), 1.5);
    float sky  = N.y * 0.5 + 0.5;
    vec3  fill = vec3(0.40, 0.50, 0.66) * mix(0.22, 0.50, sky);
    vec3  key  = vec3(1.05, 0.97, 0.86);
    vec3  base = uBase * vICol;
    float ao = mix(0.5, 1.0, smoothstep(0.0, 0.04, vLocalY));
    vec3 lit = base * (fill + key * diff) * ao;
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.4);
    rim *= clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
    lit += uRim * rim * 0.45;
    lit = lit / (lit + vec3(0.9)) * 1.9;
    float lum = dot(lit, vec3(0.2126, 0.7152, 0.0722));
    lit = mix(vec3(lum), lit, 1.16);
    gl_FragColor = vec4(lit, 1.0);
  }
`;

// ---------------------------------------------------------------- setup

export function mountGlobe3D(container) {
  disposed = false;
  const landCanvas = bakeLandMask();

  canvasEl = document.createElement('canvas');
  canvasEl.id = 'globe3d-canvas';
  container.appendChild(canvasEl);

  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  scene = new THREE.Scene();
  // Pixel-unit orthographic camera. Frustum updated in syncGlobe3D on resize.
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
  camera.position.set(0, 0, 1000);
  camera.lookAt(0, 0, 0);

  const landTexture = new THREE.CanvasTexture(landCanvas);
  landTexture.wrapS = THREE.RepeatWrapping;
  landTexture.wrapT = THREE.ClampToEdgeWrapping;
  landTexture.minFilter = THREE.LinearMipMapLinearFilter;
  landTexture.magFilter = THREE.LinearFilter;
  landTexture.anisotropy = 8;

  const mtnTexture = new THREE.CanvasTexture(bakeMountains());
  mtnTexture.wrapS = THREE.RepeatWrapping;
  mtnTexture.wrapT = THREE.ClampToEdgeWrapping;
  mtnTexture.minFilter = THREE.LinearFilter;
  mtnTexture.magFilter = THREE.LinearFilter;

  const duneTexture = new THREE.CanvasTexture(bakeDunes());
  duneTexture.wrapS = THREE.RepeatWrapping;
  duneTexture.wrapT = THREE.ClampToEdgeWrapping;
  duneTexture.minFilter = THREE.LinearFilter;
  duneTexture.magFilter = THREE.LinearFilter;

  globeUniforms = {
    uLand:    { value: landTexture },
    uMtn:     { value: mtnTexture },
    uDune:    { value: duneTexture },
    uTime:    { value: 0 },
    uLight:   { value: new THREE.Vector3(0.55, 0.7, 0.9).normalize() },
    uMtnAmp:  { value: TWEAKS.mountainHeight },
    uDuneAmp: { value: TWEAKS.duneIntensity },
  };

  const globeGeom = new THREE.IcosahedronGeometry(1.0, 96);
  const globeMat = new THREE.ShaderMaterial({ uniforms: globeUniforms, vertexShader, fragmentShader });
  const globe = new THREE.Mesh(globeGeom, globeMat);

  // Hierarchy: scene → tiltGroup → pitchPivot → yawPivot → globe.
  // No axial tilt — north must point straight up to match the d3 overlay.
  tiltGroup = new THREE.Group();
  pitchPivot = new THREE.Group();
  yawPivot = new THREE.Group();
  tiltGroup.add(pitchPivot);
  pitchPivot.add(yawPivot);
  yawPivot.add(globe);
  scene.add(tiltGroup);

  // Wireframe overlays (sparse=ocean, dense=land).
  const wireFragSparse = /* glsl */ `
    varying vec3 vNormalW;
    varying float vLand;
    uniform vec3 uLight;
    uniform float uSparseAlpha;
    void main(){
      float ndl = dot(normalize(vNormalW), normalize(uLight));
      float lit = smoothstep(-0.20, 0.45, ndl);
      vec3 col = mix(vec3(0.08, 0.14, 0.28), vec3(0.90, 0.96, 1.00), lit);
      float oceanMask = 1.0 - smoothstep(0.30, 0.65, vLand);
      float a = uSparseAlpha * (0.42 + 0.58 * lit) * oceanMask;
      gl_FragColor = vec4(col, a);
    }
  `;
  const wireFragDense = /* glsl */ `
    varying vec3 vNormalW;
    varying float vLand;
    varying float vMountain;
    uniform vec3 uLight;
    uniform float uDenseAlpha;
    uniform float uMtnBoost;
    void main(){
      float ndl = dot(normalize(vNormalW), normalize(uLight));
      float lit = smoothstep(-0.20, 0.45, ndl);
      vec3 col = mix(vec3(0.10, 0.18, 0.32), vec3(0.92, 0.97, 1.00), lit);
      float landMask = smoothstep(0.30, 0.65, vLand);
      float mtnBoost = smoothstep(0.20, 0.65, vMountain);
      float a = landMask * (uDenseAlpha * (0.42 + 0.58 * lit) + mtnBoost * uMtnBoost);
      gl_FragColor = vec4(col, a);
    }
  `;
  wireSparseUniforms = Object.assign({}, globeUniforms, { uSparseAlpha: { value: TWEAKS.sparseAlpha } });
  wireDenseUniforms  = Object.assign({}, globeUniforms, { uDenseAlpha: { value: TWEAKS.denseAlpha }, uMtnBoost: { value: TWEAKS.mtnBoost } });

  function makeWireMesh(detail, radius, frag, order, uniforms) {
    const mat = new THREE.ShaderMaterial({
      uniforms, vertexShader, fragmentShader: frag,
      transparent: true, depthWrite: false, wireframe: true,
      blending: THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, detail), mat);
    mesh.renderOrder = order;
    return mesh;
  }
  yawPivot.add(makeWireMesh(10, 1.0018, wireFragSparse, 1, wireSparseUniforms));
  yawPivot.add(makeWireMesh(28, 1.0030, wireFragDense, 2, wireDenseUniforms));

  // Sun + ambient.
  sunLight = new THREE.DirectionalLight(0xfff3e0, 1.05);
  sunLight.position.copy(globeUniforms.uLight.value).multiplyScalar(8);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  // Sun anchor inside the rotating frame: placed at the live subsolar point,
  // its WORLD direction then gives us the true light vector after rotation.
  sunAnchor = new THREE.Object3D();
  yawPivot.add(sunAnchor);

  // Atmosphere shell.
  atmoUniforms = { uLight: globeUniforms.uLight, uAtmoAmp: { value: TWEAKS.atmoIntensity } };
  const atmoMat = new THREE.ShaderMaterial({
    transparent: true, side: THREE.BackSide, depthWrite: false,
    uniforms: atmoUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vP;
      void main(){
        vN = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vP = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vP;
      uniform vec3 uLight;
      uniform float uAtmoAmp;
      void main(){
        vec3 V = normalize(cameraPosition - vP);
        float rim = pow(1.0 - abs(dot(vN, V)), 3.0);
        vec3 col = mix(vec3(0.30, 0.55, 0.90), vec3(0.55, 0.75, 1.0), rim);
        float lit = clamp(dot(normalize(vN), normalize(uLight)) * 0.5 + 0.6, 0.0, 1.0);
        gl_FragColor = vec4(col, rim * 0.55 * lit * uAtmoAmp);
      }
    `,
  });
  tiltGroup.add(new THREE.Mesh(new THREE.SphereGeometry(1.14, 64, 64), atmoMat));

  // Foliage.
  if (TWEAKS.showFoliage) buildFoliage(landCanvas);

  return canvasEl;
}

function buildFoliage(landCanvas) {
  const MASK_W = landCanvas.width, MASK_H = landCanvas.height;
  const maskData = landCanvas.getContext('2d').getImageData(0, 0, MASK_W, MASK_H).data;
  function isLand(lat, lon) {
    const lonN = ((lon + 540) % 360) - 180;
    const u = ((lonN + 180) / 360) * MASK_W;
    const v = ((90 - lat) / 180) * MASK_H;
    const px = Math.max(0, Math.min(MASK_W - 1, Math.floor(u)));
    const py = Math.max(0, Math.min(MASK_H - 1, Math.floor(v)));
    return maskData[(py * MASK_W + px) * 4] > 128;
  }

  const geoms = bakeFoliageGeoms();
  function makeFoliageMat(baseHex, rimHex) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uLight: globeUniforms.uLight,
        uBase: { value: new THREE.Color(baseHex) },
        uRim: { value: new THREE.Color(rimHex) },
      },
      vertexShader: foliageVert,
      fragmentShader: foliageFrag,
    });
  }
  const mats = {
    everCanopy: makeFoliageMat(0xffffff, 0xc6e892),
    everTrunk:  makeFoliageMat(0x5a3a20, 0x9c7a4e),
    canCanopy:  makeFoliageMat(0xffffff, 0xa6f2a4),
    canTrunk:   makeFoliageMat(0x6f4827, 0xb89058),
  };

  const regions = {
    evergreen: [
      { latMin: 40, latMax: 60, lonMin: -130, lonMax: -118, count: 45 },
      { latMin: 50, latMax: 65, lonMin: -125, lonMax: -60,  count: 65 },
      { latMin: 42, latMax: 52, lonMin: -78,  lonMax: -62,  count: 18 },
      { latMin: 58, latMax: 68, lonMin: 5,    lonMax: 30,   count: 32 },
      { latMin: 52, latMax: 68, lonMin: 40,   lonMax: 145,  count: 115 },
      { latMin: 44, latMax: 50, lonMin: 6,    lonMax: 26,   count: 12 },
    ],
    canopy: [
      { latMin: -12, latMax: 5,  lonMin: -75, lonMax: -50,  count: 65 },
      { latMin: -6,  latMax: 8,  lonMin: 8,   lonMax: 32,   count: 42 },
      { latMin: -10, latMax: 18, lonMin: 95,  lonMax: 150,  count: 65 },
      { latMin: 8,   latMax: 20, lonMin: -92, lonMax: -77,  count: 18 },
      { latMin: -25, latMax: -10, lonMin: -50, lonMax: -40, count: 16 },
    ],
  };

  const dummy = new THREE.Object3D();
  const UP = new THREE.Vector3(0, 1, 0);
  function buildMatrices(regionList, opts) {
    const out = [];
    const offset = opts.surfaceOffset;
    for (const r of regionList) {
      let placed = 0, tries = 0;
      const maxTries = r.count * 40;
      while (placed < r.count && tries < maxTries) {
        tries++;
        const lat = r.latMin + Math.random() * (r.latMax - r.latMin);
        const lon = r.lonMin + Math.random() * (r.lonMax - r.lonMin);
        if (!isLand(lat, lon)) continue;
        if (!isLand(lat + 0.6, lon) && !isLand(lat - 0.6, lon) &&
            !isLand(lat, lon + 0.6) && !isLand(lat, lon - 0.6)) continue;
        const normal = latLonToPos(lat, lon, 1.0).normalize();
        dummy.position.copy(normal).multiplyScalar(1.0 + offset);
        const q = new THREE.Quaternion().setFromUnitVectors(UP, normal);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.random() * Math.PI * 2));
        dummy.quaternion.copy(q);
        const s = (opts.scaleMin ?? 0.8) + Math.random() * ((opts.scaleMax ?? 1.25) - (opts.scaleMin ?? 0.8));
        dummy.scale.set(s, s * (0.9 + Math.random() * 0.25), s);
        dummy.updateMatrix();
        out.push(dummy.matrix.clone());
        placed++;
      }
    }
    return out;
  }

  function buildInstanced(geom, mat, matrices, colorFn) {
    const m = new THREE.InstancedMesh(geom, mat, matrices.length);
    const c = new THREE.Color();
    for (let i = 0; i < matrices.length; i++) {
      m.setMatrixAt(i, matrices[i]);
      if (colorFn) { colorFn(c); m.setColorAt(i, c); }
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.frustumCulled = false;
    return m;
  }

  const rnd = (a, b) => a + Math.random() * (b - a);
  const everMats = buildMatrices(regions.evergreen, { surfaceOffset: 0.026, scaleMin: 0.7, scaleMax: 1.3 });
  const canMats = buildMatrices(regions.canopy, { surfaceOffset: 0.026, scaleMin: 0.85, scaleMax: 1.45 });

  yawPivot.add(buildInstanced(geoms.everTrunk, mats.everTrunk, everMats));
  yawPivot.add(buildInstanced(geoms.everCanopy, mats.everCanopy, everMats,
    c => c.setHSL(rnd(0.28, 0.40), rnd(0.50, 0.80), rnd(0.24, 0.38))));
  yawPivot.add(buildInstanced(geoms.canTrunk, mats.canTrunk, canMats));
  yawPivot.add(buildInstanced(geoms.canCanopy, mats.canCanopy, canMats,
    c => c.setHSL(rnd(0.22, 0.37), rnd(0.55, 0.92), rnd(0.34, 0.50))));
}

// Per-frame sync from the 2D pipeline. Mirrors the d3 orthographic camera:
//   yaw   = λ0 - 90°   (so lng = -λ0 faces the viewer)
//   pitch = -rotateLat (rotateLat is stored as -lat)
// Globe group scaled to the projection's pixel radius and positioned at its
// pixel translate, in a pixel-unit ortho frustum.
let lastSunUpdate = 0;
export function syncGlobe3D({ lambda, rotateLat, scalePx, cx, cy, w, h, now }) {
  if (!renderer || disposed) return;

  // Resize frustum + canvas if needed.
  if (canvasEl.width !== Math.round(w * renderer.getPixelRatio()) ||
      canvasEl.height !== Math.round(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    canvasEl.style.width = w + 'px';
    canvasEl.style.height = h + 'px';
  }
  camera.left = -w / 2; camera.right = w / 2;
  camera.top = h / 2; camera.bottom = -h / 2;
  camera.updateProjectionMatrix();

  // Position + scale: pixel coords, y flipped (screen y-down → world y-up).
  tiltGroup.position.set(cx - w / 2, h / 2 - cy, 0);
  tiltGroup.scale.setScalar(scalePx);

  yawPivot.rotation.y = THREE.MathUtils.degToRad(lambda - 90);
  pitchPivot.rotation.x = THREE.MathUtils.degToRad(-rotateLat);

  // Real day/night — update the sun direction once a minute.
  if (now - lastSunUpdate > 60_000 || lastSunUpdate === 0) {
    lastSunUpdate = now;
    const sub = subsolarPoint();
    sunAnchor.position.copy(latLonToPos(sub.lat, sub.lng, 2));
  }
  const sunWorld = new THREE.Vector3();
  sunAnchor.getWorldPosition(sunWorld);
  sunWorld.sub(tiltGroup.getWorldPosition(new THREE.Vector3())).normalize();
  globeUniforms.uLight.value.copy(sunWorld);
  sunLight.position.copy(sunWorld).multiplyScalar(8);

  globeUniforms.uTime.value = now / 1000;
  renderer.render(scene, camera);
}

export function disposeGlobe3D() {
  disposed = true;
  if (renderer) {
    renderer.dispose();
    renderer.forceContextLoss?.();
  }
  canvasEl?.remove();
  renderer = scene = camera = canvasEl = null;
  tiltGroup = pitchPivot = yawPivot = null;
  globeUniforms = atmoUniforms = wireSparseUniforms = wireDenseUniforms = null;
  sunLight = sunAnchor = null;
}
