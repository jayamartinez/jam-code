/**
 * The sounds a chat can make, synthesised with Web Audio so no sound files
 * ship. Each is a few short tones; all stay quiet and under a second.
 */
export type SoundId = 'chime' | 'glass' | 'pop' | 'bell' | 'marimba' | 'blip';

export const SOUNDS: { id: SoundId; label: string }[] = [
  { id: 'chime', label: 'Chime' },
  { id: 'glass', label: 'Glass' },
  { id: 'pop', label: 'Pop' },
  { id: 'bell', label: 'Bell' },
  { id: 'marimba', label: 'Marimba' },
  { id: 'blip', label: 'Blip' },
];

interface Tone {
  frequency: number;
  /** Seconds after the sound starts. */
  at: number;
  /** Seconds until it has faded out. */
  decay: number;
  gain: number;
  wave?: OscillatorType;
  /** A pitch the tone slides to over its decay. */
  slideTo?: number;
}

const TONES: Record<SoundId, Tone[]> = {
  chime: [
    { frequency: 659.25, at: 0, decay: 0.5, gain: 0.12 },
    { frequency: 987.77, at: 0.11, decay: 0.5, gain: 0.12 },
  ],
  glass: [
    { frequency: 1318.5, at: 0, decay: 0.9, gain: 0.07 },
    { frequency: 1975.5, at: 0, decay: 0.6, gain: 0.035 },
    { frequency: 2637, at: 0.005, decay: 0.35, gain: 0.02 },
  ],
  pop: [{ frequency: 720, at: 0, decay: 0.12, gain: 0.16, slideTo: 260 }],
  bell: [
    { frequency: 880, at: 0, decay: 1, gain: 0.1 },
    { frequency: 880 * 2.76, at: 0, decay: 0.45, gain: 0.03 },
    { frequency: 880 * 5.4, at: 0, decay: 0.2, gain: 0.015 },
  ],
  marimba: [
    { frequency: 523.25, at: 0, decay: 0.28, gain: 0.14, wave: 'triangle' },
    { frequency: 659.25, at: 0.09, decay: 0.28, gain: 0.14, wave: 'triangle' },
    { frequency: 783.99, at: 0.18, decay: 0.36, gain: 0.14, wave: 'triangle' },
  ],
  blip: [
    { frequency: 1046.5, at: 0, decay: 0.08, gain: 0.08, wave: 'square' },
    { frequency: 1396.9, at: 0.1, decay: 0.1, gain: 0.08, wave: 'square' },
  ],
};

export const isSoundId = (value: unknown): value is SoundId =>
  SOUNDS.some((sound) => sound.id === value);

let context: AudioContext | null = null;

/** Plays a sound; silent where there is no audio device or Web Audio. */
export function playSound(id: SoundId) {
  try {
    context ??= new AudioContext();
    const audio = context;
    if (audio.state === 'suspended') void audio.resume();
    const start = audio.currentTime + 0.01;
    for (const tone of TONES[id]) {
      const at = start + tone.at;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = tone.wave ?? 'sine';
      oscillator.frequency.setValueAtTime(tone.frequency, at);
      if (tone.slideTo)
        oscillator.frequency.exponentialRampToValueAtTime(tone.slideTo, at + tone.decay);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(tone.gain, at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + tone.decay);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(at);
      oscillator.stop(at + tone.decay + 0.05);
    }
  } catch {
    // No audio: the chat stays silent.
  }
}
