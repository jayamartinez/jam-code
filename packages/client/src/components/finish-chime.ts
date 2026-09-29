let context: AudioContext | null = null;

/**
 * A short, soft two-note chime for a finished agent turn, synthesised so no
 * sound file ships. Fails silently where audio is unavailable.
 */
export function playFinishChime() {
  try {
    context ??= new AudioContext();
    const audio = context;
    if (audio.state === 'suspended') void audio.resume();
    const start = audio.currentTime + 0.01;
    [659.25, 987.77].forEach((frequency, index) => {
      const at = start + index * 0.11;
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      tone.type = 'sine';
      tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.12, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      tone.connect(gain).connect(audio.destination);
      tone.start(at);
      tone.stop(at + 0.55);
    });
  } catch {
    // No audio device or no Web Audio: finishing stays silent.
  }
}
