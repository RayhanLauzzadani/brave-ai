const INCIDENT_NOTIFICATION_URL = "/audio/incident-notification.wav";
const INCIDENT_NOTIFICATION_VOLUME = 0.85;

let audioContext: AudioContext | null = null;
let incidentAudioBufferPromise: Promise<AudioBuffer> | null = null;
let activeIncidentSource: AudioBufferSourceNode | null = null;

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
  if (context.state !== "running") return false;

  void getIncidentAudioBuffer(context).catch(() => undefined);
  return true;
}

export async function playIncidentAlarm() {
  const context = getAudioContext();
  if (!context) return false;

  try {
    if (context.state === "suspended") {
      await context.resume();
    }
    if (context.state !== "running") return false;

    const buffer = await getIncidentAudioBuffer(context);
    stopActiveIncidentSource();

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = INCIDENT_NOTIFICATION_VOLUME;
    source.connect(gain);
    gain.connect(context.destination);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      if (activeIncidentSource === source) activeIncidentSource = null;
    };
    activeIncidentSource = source;
    source.start();
    return true;
  } catch {
    return false;
  }
}

function getIncidentAudioBuffer(context: AudioContext) {
  if (!incidentAudioBufferPromise) {
    incidentAudioBufferPromise = fetch(INCIDENT_NOTIFICATION_URL, {
      cache: "force-cache",
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Audio notifikasi tidak tersedia.");
        }
        return response.arrayBuffer();
      })
      .then((data) => context.decodeAudioData(data))
      .catch((error) => {
        incidentAudioBufferPromise = null;
        throw error;
      });
  }

  return incidentAudioBufferPromise;
}

function stopActiveIncidentSource() {
  if (!activeIncidentSource) return;
  try {
    activeIncidentSource.stop();
  } catch {
    // The previous sound already ended between the check and stop call.
  }
  activeIncidentSource = null;
}
