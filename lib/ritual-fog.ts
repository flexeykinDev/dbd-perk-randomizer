/* The Ritual fog, as a shader.
 *
 * Lives here rather than in the stage because two things draw it now: the
 * animated stage, and the still backdrop baked into the export image. One
 * copy, so the picture someone shares is the same fog they were looking at
 * rather than a lookalike that drifts the first time either is touched.
 *
 * It twists per-pixel around the eye, tightening as it goes in, which is why
 * this is a fragment shader and not layered CSS gradients.
 */

export const RITUAL_VERT = "attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }";

export const RITUAL_FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uSpin; uniform vec3 uTint;
uniform vec3 uGround; uniform vec3 uHaze; uniform float uTintAmt;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float r = length(uv);
  float ang = atan(uv.y, uv.x);
  float twist = ang + uSpin * (0.55 / (r + 0.22)) + uTime * 0.05;
  vec2 warp = vec2(cos(twist), sin(twist)) * r;
  float d = fbm(warp * 2.6 + vec2(uTime * 0.06, -uTime * 0.04));
  d = fbm(warp * 3.4 + d * 1.6 + vec2(0.0, uTime * 0.03));
  float funnel = smoothstep(0.02, 0.66, r) * (1.0 - smoothstep(0.9, 1.6, r));
  float dens = pow(d, 1.45) * funnel;
  // Ground and haze come from the page's own tokens, so the fog is light on
  // the light theme and dark on the dark one instead of always near-black.
  vec3 col = mix(uGround, uHaze, clamp(dens * 1.5, 0.0, 1.0));
  col += uTint * uTintAmt * dens * (0.55 + 0.45 * uSpin);
  col += uTint * uTintAmt * 0.5 * smoothstep(0.4, 0.0, r) * (0.4 + 0.6 * uSpin);
  col = mix(col, uGround, 0.4 * smoothstep(0.62, 1.5, r));
  col += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.018;
  gl_FragColor = vec4(col, 1.0);
}`;
