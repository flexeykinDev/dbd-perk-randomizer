"use client";

/* The site's interface sounds.
 *
 * Synthesised with Web Audio rather than shipped as files: nothing to
 * download, nothing to licence, and a cue can be retuned by changing a number
 * instead of re-exporting audio. Ripped SFX would also be a licensing problem
 * in a public repo, which rules out the obvious shortcut.
 *
 * The brief was "pleasant, professional, not loud", which mostly rules things
 * OUT. No square waves, and no oscillator started at full amplitude — a tone
 * switched on instantly clicks, and that click is most of what makes UI audio
 * sound cheap. Everything here fades up over a few milliseconds, decays
 * exponentially, and passes through a low-pass on the way out.
 *
 * The part that actually matters is the room. A dry oscillator is
 * unmistakably a computer making a tone; the same tone with a short dark
 * reverb behind it reads as a designed sound. Every cue sends some of itself
 * to a generated impulse response, and the cues are layered — a transient, a
 * body, and air — because a single oscillator is always a beep no matter how
 * carefully it is enveloped.
 *
 * Intervals are consonant (fourths, fifths, octaves): a roll can fire many
 * times a minute, and anything with an edge on it is unbearable by the
 * twentieth press.
 *
 * Nothing is constructed until the first cue plays. Browsers refuse to start
 * an AudioContext without a user gesture, and building one at load leaves a
 * suspended context lying around for the life of the page.
 */
import { useSyncExternalStore } from "react";
import { safeGet, safeSet } from "./safe-storage";

const MUTED_KEY = "dbd-randomizer:sound-muted";
const VOLUME_KEY = "dbd-randomizer:sound-volume";

export type SoundName = "roll" | "ratchet" | "deal" | "settle" | "toggle";

/* Sound belongs to the slot machine, and nowhere else.
 *
 * It started as a general interface soundscape — a cue on every copy, every
 * pin, every roll, in every presentation — and that was the wrong instinct.
 * A tool someone keeps open for a whole stream should be silent by default;
 * a slot machine that makes no noise is missing the point of being a slot
 * machine. So the engine is gated on the presentation rather than sprinkled
 * through the app, and the volume control only appears where there is
 * something to hear.
 *
 * The gate lives here rather than at each call site so a new cue cannot
 * accidentally reintroduce noise elsewhere: there is exactly one place that
 * decides whether this site is allowed to make a sound at all. */
let surfaceEnabled = false;

export function setSoundSurface(enabled: boolean): void {
  surfaceEnabled = enabled;
}

/** Quiet by default. This plays under whatever the streamer already has on. */
const DEFAULT_VOLUME = 0.35;

interface SoundState {
  muted: boolean;
  volume: number;
}

let state: SoundState = { muted: false, volume: DEFAULT_VOLUME };
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  state = {
    muted: safeGet("local", MUTED_KEY) === "1",
    volume: (() => {
      // The null check is load-bearing: Number(null) is 0, which sails
      // through a finite-and-in-range test and silently hydrated the volume
      // to zero on every first visit. Sound read as "on" in the UI and
      // nothing ever played.
      const raw = safeGet("local", VOLUME_KEY);
      if (raw === null) return DEFAULT_VOLUME;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_VOLUME;
    })(),
  };
  emit();
}

function emit(): void {
  for (const listener of listeners) listener();
}

/* ------------------------------------------------------------------ *
 * The audio graph                                                     *
 * ------------------------------------------------------------------ */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let reverbSend: GainNode | null = null;
let noise: AudioBuffer | null = null;

/** A short, dark room, generated rather than loaded.
 *
 *  Noise under an exponential decay, slightly different per channel so it has
 *  width, and one-pole low-passed so the tail darkens as it fades the way a
 *  real room does instead of staying bright to the end. The decay is
 *  deliberately fast: a long tail on a UI cue turns into a wash the moment
 *  someone presses the roll button twice. */
function impulse(context: AudioContext): AudioBuffer {
  const length = Math.floor(context.sampleRate * 1.1);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const envelope = Math.pow(1 - i / length, 2.6);
      last = (Math.random() * 2 - 1) * 0.32 + last * 0.68;
      data[i] = last * envelope;
    }
  }
  return buffer;
}

function audio(): { ctx: AudioContext; master: GainNode; send: GainNode } | null {
  if (typeof window === "undefined") return null;
  if (ctx && master && reverbSend) {
    // Browsers suspend the context when a tab is hidden, and it does not
    // always come back on its own.
    if (ctx.state === "suspended") void ctx.resume();
    return { ctx, master, send: reverbSend };
  }
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }

  master = ctx.createGain();
  master.gain.value = state.volume;

  /* A ceiling for overlapping cues — deliberately NOT a DynamicsCompressor.
   *
   * The obvious node for this job is unusable here. Chrome's compressor was
   * measured applying 14dB of gain reduction to a signal sitting 17dB BELOW
   * its own threshold, at every setting tried: a roll that summed to 0.15
   * arrived at the destination at 0.05. It was not limiting peaks, it was
   * quietly turning everything down and rounding off the attacks, which is
   * most of why these cues sounded thin.
   *
   * A tanh curve does the actual job instead. It is linear to within a
   * fraction of a percent at the levels a single cue reaches, so nothing is
   * touched in normal use, and it bends only as several cues stack toward
   * full scale — soft clipping rather than the hard, buzzy clip that
   * arriving at the destination above 1.0 would otherwise produce. */
  const limiter = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    curve[i] = Math.tanh((i / (curve.length - 1)) * 2 - 1);
  }
  limiter.curve = curve;
  limiter.oversample = "4x";

  const convolver = ctx.createConvolver();
  convolver.buffer = impulse(ctx);
  const wetTone = ctx.createBiquadFilter();
  wetTone.type = "lowpass";
  wetTone.frequency.value = 2200;
  const wet = ctx.createGain();
  wet.gain.value = 0.5;

  reverbSend = ctx.createGain();
  reverbSend.gain.value = 1;
  reverbSend.connect(convolver);
  convolver.connect(wetTone);
  wetTone.connect(wet);
  wet.connect(master);

  master.connect(limiter);
  limiter.connect(ctx.destination);
  return { ctx, master, send: reverbSend };
}

/** One second of white noise, reused by every cue that needs air. */
function noiseBuffer(context: AudioContext): AudioBuffer {
  if (noise) return noise;
  const length = context.sampleRate;
  noise = context.createBuffer(1, length, context.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

interface Voice {
  at: number;
  peak: number;
  decay: number;
  attack?: number;
  /** How much of this voice reaches the room. */
  space?: number;
  /** -1 left, 1 right. Small offsets stop layered cues sounding flat. */
  pan?: number;
}

/** Dry mix plus a room send, shared by every voice. */
function outputChain(
  context: AudioContext,
  out: AudioNode,
  send: AudioNode,
  { space = 0.25, pan = 0 }: Pick<Voice, "space" | "pan">,
): GainNode {
  const gain = context.createGain();
  const tail = context.createGain();
  tail.gain.value = space;
  const panner = context.createStereoPanner?.();
  if (panner) {
    panner.pan.value = pan;
    gain.connect(panner);
    panner.connect(out);
    panner.connect(tail);
  } else {
    // Safari versions without StereoPanner still get the sound, just centred.
    gain.connect(out);
    gain.connect(tail);
  }
  tail.connect(send);
  return gain;
}

function tone(
  context: AudioContext,
  out: AudioNode,
  send: AudioNode,
  {
    at,
    freq,
    endFreq,
    peak,
    attack = 0.008,
    decay,
    type = "sine",
    cutoff = 2600,
    space,
    pan,
    detune = 0,
  }: Voice & {
    freq: number;
    endFreq?: number;
    type?: OscillatorType;
    cutoff?: number;
    detune?: number;
  },
): void {
  const osc = context.createOscillator();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(freq, at);
  if (endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(endFreq, at + decay);

  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cutoff;

  const env = context.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(peak, at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + decay);

  osc.connect(filter);
  filter.connect(env);
  env.connect(outputChain(context, out, send, { space, pan }));
  osc.start(at);
  osc.stop(at + decay + 0.05);
}

function air(
  context: AudioContext,
  out: AudioNode,
  send: AudioNode,
  {
    at,
    peak,
    decay,
    cutoff,
    sweepTo,
    q = 0.7,
    type = "lowpass",
    space,
    pan,
  }: Voice & {
    cutoff: number;
    sweepTo?: number;
    q?: number;
    type?: BiquadFilterType;
  },
): void {
  const src = context.createBufferSource();
  src.buffer = noiseBuffer(context);
  // A little variation per hit, so repeated cues are not literally identical.
  src.playbackRate.value = 0.85 + Math.random() * 0.3;

  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(cutoff, at);
  if (sweepTo !== undefined) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + decay);

  const env = context.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(peak, at + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, at + decay);

  src.connect(filter);
  filter.connect(env);
  env.connect(outputChain(context, out, send, { space, pan }));
  src.start(at);
  src.stop(at + decay + 0.05);
}

export function playSound(name: SoundName): void {
  hydrate();
  if (!surfaceEnabled || state.muted || state.volume <= 0) return;
  const nodes = audio();
  if (!nodes) return;
  const { ctx: context, master: out, send } = nodes;
  const t = context.currentTime + 0.001;

  switch (name) {
    /* A shuffle and a drop. Three layers, because one layer is always a
       beep: a resonant sweep for the movement, a sub for the weight, and a
       bright transient at the front so it has an attack worth noticing. */
    case "roll":
      /* The lever.
       *
       * Three things in sequence, because a slot machine's opening sound is
       * mechanical and then electrical: the throw (a hard, short transient),
       * the weight behind it (a sub dropping), and the reels picking up
       * speed (a filter opening upward rather than the downward sweep this
       * used to have). The old version swept DOWN throughout, which read as
       * something powering off at the exact moment the reels start. */
      air(context, out, send, {
        at: t, peak: 0.22, decay: 0.06, cutoff: 2100, sweepTo: 700,
        q: 1.4, type: "bandpass", space: 0.2,
      });
      tone(context, out, send, {
        at: t, freq: 260, endFreq: 78, peak: 0.17, decay: 0.28, attack: 0.004,
        type: "sine", space: 0.25,
      });
      air(context, out, send, {
        at: t + 0.05, peak: 0.12, decay: 0.42, cutoff: 420, sweepTo: 2600,
        q: 2.2, type: "bandpass", space: 0.45,
      });
      break;

    /* The near miss: the last reel ratcheting down to its stop.
     *
     * Scheduled here as one burst rather than fired per frame from the draw
     * loop. Two reasons, and the first is the important one. Musically, the
     * drama is entirely in the RHYTHM -- ticks that start fast and pull
     * apart -- and a frame-driven tick inherits the frame rate, so it
     * stutters exactly where it should be tightening. Practically, ticking on
     * symbol crossings tied the count to how far that reel happened to have
     * left to travel, which is random: measured, it produced one tick most
     * rolls and none the rest.
     *
     * The gaps widen geometrically and the level falls with them, so it
     * settles rather than stopping. Everything is placed on the audio clock,
     * so it is sample-accurate no matter what the main thread is doing. */
    case "ratchet": {
      let at = t;
      let gap = 0.055;
      for (let i = 0; i < 9; i++) {
        air(context, out, send, {
          at,
          peak: 0.075 * (1 - i * 0.06),
          decay: 0.024,
          cutoff: 3200 - i * 90,
          q: 3,
          type: "bandpass",
          space: 0.1 + i * 0.02,
          pan: (i % 2 === 0 ? 1 : -1) * 0.12,
        });
        at += gap;
        gap *= 1.19;
      }
      break;
    }

    /* A card set down: a short knock with air on it. Panned slightly at
       random so four in a row do not stack into one identical sound. */
    case "deal":
      air(context, out, send, {
        at: t, peak: 0.16, decay: 0.07, cutoff: 1900, sweepTo: 620,
        q: 1.6, type: "bandpass", space: 0.3, pan: (Math.random() - 0.5) * 0.5,
      });
      tone(context, out, send, {
        at: t, freq: 168, endFreq: 96, peak: 0.11, decay: 0.09,
        type: "triangle", cutoff: 1100, space: 0.2,
      });
      break;

    /* The hand is complete: root, fifth, octave, struck a few milliseconds
       apart so it arpeggiates rather than lands as a block. Two slightly
       detuned voices per note give it body a single sine cannot have. */
    case "settle":
      [
        { f: 293.66, d: 0, p: 0.08 },
        { f: 440, d: 0.045, p: 0.065 },
        { f: 587.33, d: 0.09, p: 0.05 },
      ].forEach(({ f, d, p }, i) => {
        tone(context, out, send, {
          at: t + d, freq: f, peak: p, decay: 0.85 - i * 0.12, attack: 0.014,
          type: "sine", cutoff: 2600, space: 0.7, pan: (i - 1) * 0.18,
        });
        tone(context, out, send, {
          at: t + d, freq: f, detune: 7, peak: p * 0.5, decay: 0.7 - i * 0.1,
          attack: 0.02, type: "triangle", cutoff: 1800, space: 0.7, pan: (1 - i) * 0.18,
        });
      });
      break;

    /* The quietest cue in the set. It fires when sound is switched on, so it
       has to demonstrate the level without being the loudest thing here. */
    case "toggle":
      tone(context, out, send, {
        at: t, freq: 523.25, peak: 0.06, decay: 0.1, type: "sine", space: 0.4,
      });
      tone(context, out, send, {
        at: t + 0.04, freq: 783.99, peak: 0.045, decay: 0.16, type: "sine", space: 0.5,
      });
      break;
  }
}

/* ------------------------------------------------------------------ *
 * Settings                                                            *
 * ------------------------------------------------------------------ */

export function setMuted(muted: boolean): void {
  hydrate();
  state = { ...state, muted };
  safeSet("local", MUTED_KEY, muted ? "1" : "0");
  emit();
  // Switching sound ON should demonstrate what that means.
  if (!muted) playSound("toggle");
}

export function setVolume(volume: number): void {
  hydrate();
  const clamped = Math.min(1, Math.max(0, volume));
  state = { ...state, volume: clamped };
  safeSet("local", VOLUME_KEY, String(clamped));
  if (master) master.gain.value = clamped;
  emit();
}

function subscribe(listener: () => void): () => void {
  hydrate();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const SERVER_STATE: SoundState = { muted: false, volume: DEFAULT_VOLUME };

/** useSyncExternalStore rather than state-in-an-effect, matching
 *  lib/daily-count.ts — the settings live outside React because the draw
 *  loops in the presentation stages play cues without a hook. */
export function useSoundSettings(): SoundState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE,
  );
}
