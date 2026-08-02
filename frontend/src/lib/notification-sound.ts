let audioContext: AudioContext | null = null;

function getAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioContextClass =
    window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextClass) return null;
  audioContext ??= new AudioContextClass();
  return audioContext;
}

export async function unlockNotificationSound() {
  const context = getAudioContext();
  if (!context) return false;
  if (context.state === "suspended") {
    await context.resume();
  }
  return context.state === "running";
}

export async function playIncidentAlarm() {
  const context = getAudioContext();
  if (!context) return false;

  try {
    if (context.state === "suspended") {
      await context.resume();
    }
    if (context.state !== "running") return false;

    const start = context.currentTime;
    playTone(context, 880, start, 0.16);
    playTone(context, 660, start + 0.21, 0.2);
    return true;
  } catch {
    return false;
  }
}

function playTone(
  context: AudioContext,
  frequency: number,
  startsAt: number,
  duration: number,
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startsAt);
  gain.gain.setValueAtTime(0.0001, startsAt);
  gain.gain.exponentialRampToValueAtTime(0.18, startsAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startsAt);
  oscillator.stop(startsAt + duration + 0.02);
}
