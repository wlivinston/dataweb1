import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface VoiceOption {
  name: string;
  lang: string;
  voiceURI: string;
}

const VOICE_STORAGE_KEY = "dataafrik_tts_voice";
const RATE_STORAGE_KEY = "dataafrik_tts_rate";
const PITCH_STORAGE_KEY = "dataafrik_tts_pitch";
const MAX_CHUNK_LENGTH = 1200;
const SPECIALIZED_TTS_ENDPOINT = String(import.meta.env.VITE_TTS_ENDPOINT || "").trim();

const splitTextForSpeech = (input: string): string[] => {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  if (normalized.length <= MAX_CHUNK_LENGTH) {
    return [normalized];
  }

  const sentenceChunks = normalized
    .split(/(?<=[.!?])\s+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (sentenceChunks.length === 0) {
    return [normalized.slice(0, MAX_CHUNK_LENGTH)];
  }

  const merged: string[] = [];
  let current = "";

  for (const sentence of sentenceChunks) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length <= MAX_CHUNK_LENGTH) {
      current = next;
      continue;
    }

    if (current) merged.push(current);

    if (sentence.length <= MAX_CHUNK_LENGTH) {
      current = sentence;
      continue;
    }

    for (let i = 0; i < sentence.length; i += MAX_CHUNK_LENGTH) {
      merged.push(sentence.slice(i, i + MAX_CHUNK_LENGTH).trim());
    }
    current = "";
  }

  if (current) merged.push(current);
  return merged.filter(Boolean);
};

const AccessibilityControls: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState("");
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [status, setStatus] = useState("Ready");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const queueRef = useRef<string[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const manualStopRef = useRef(false);

  const speechSupported =
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof window.SpeechSynthesisUtterance !== "undefined";
  const canReadAloud = speechSupported || Boolean(SPECIALIZED_TTS_ENDPOINT);

  const selectedVoice = useMemo(() => {
    if (!selectedVoiceURI) return null;
    const synthVoices = speechSupported ? window.speechSynthesis.getVoices() : [];
    return synthVoices.find((voice) => voice.voiceURI === selectedVoiceURI) || null;
  }, [selectedVoiceURI, speechSupported]);

  const resetSpeechState = useCallback(() => {
    queueRef.current = [];
    utteranceRef.current = null;
    audioRef.current = null;
    setIsSpeaking(false);
    setIsPaused(false);
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (!speechSupported) {
      resetSpeechState();
      setStatus("Stopped");
      return;
    }
    manualStopRef.current = true;
    window.speechSynthesis.cancel();
    resetSpeechState();
    setStatus("Stopped");
  }, [resetSpeechState, speechSupported]);

  const speakNext = useCallback(() => {
    if (!speechSupported) return;

    const next = queueRef.current.shift();
    if (!next) {
      resetSpeechState();
      setStatus("Finished reading");
      return;
    }

    const utterance = new SpeechSynthesisUtterance(next);
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.lang = selectedVoice?.lang || "en-US";
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    utterance.onstart = () => {
      setIsSpeaking(true);
      setIsPaused(false);
      setStatus("Reading");
    };

    utterance.onend = () => {
      utteranceRef.current = null;
      if (manualStopRef.current) {
        manualStopRef.current = false;
        return;
      }
      speakNext();
    };

    utterance.onerror = () => {
      utteranceRef.current = null;
      setStatus("Speech failed for this segment");
      speakNext();
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [pitch, rate, resetSpeechState, selectedVoice, speechSupported]);

  const startSpeech = useCallback(
    (rawText: string) => {
      if (!speechSupported) {
        setStatus("Speech not supported in this browser");
        return;
      }

      const text = rawText.trim();
      if (!text) {
        setStatus("No readable text found");
        return;
      }

      stop();
      manualStopRef.current = false;
      queueRef.current = splitTextForSpeech(text);
      if (queueRef.current.length === 0) {
        setStatus("No readable text found");
        return;
      }
      speakNext();
    },
    [speakNext, speechSupported, stop]
  );

  const playSpecializedSpeech = useCallback(
    async (rawText: string): Promise<boolean> => {
      if (!SPECIALIZED_TTS_ENDPOINT) return false;
      const text = rawText.trim();
      if (!text) return false;

      try {
        setStatus("Requesting specialized speech");
        const response = await fetch(SPECIALIZED_TTS_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            voice: selectedVoice?.name || undefined,
            language: selectedVoice?.lang || "en-US",
            rate,
            pitch,
          }),
        });

        if (!response.ok) {
          throw new Error(`Specialized TTS endpoint failed (${response.status})`);
        }

        const payload = (await response.json().catch(() => ({}))) as {
          audioUrl?: string;
          audioBase64?: string;
          mimeType?: string;
        };

        const rawAudioUrl = String(payload.audioUrl || "").trim();
        const rawAudioBase64 = String(payload.audioBase64 || "").trim();
        const mimeType = String(payload.mimeType || "audio/mpeg").trim();
        const source =
          rawAudioUrl ||
          (rawAudioBase64 ? `data:${mimeType};base64,${rawAudioBase64}` : "");

        if (!source) {
          throw new Error("Specialized TTS response did not include audio");
        }

        stop();
        manualStopRef.current = false;

        const audio = new Audio(source);
        audioRef.current = audio;

        audio.onplay = () => {
          setIsSpeaking(true);
          setIsPaused(false);
          setStatus("Reading with specialized voice");
        };

        audio.onpause = () => {
          if (audio.ended) return;
          setIsPaused(true);
          setStatus("Paused");
        };

        audio.onended = () => {
          resetSpeechState();
          setStatus("Finished reading");
        };

        audio.onerror = () => {
          resetSpeechState();
          setStatus("Specialized audio playback failed");
        };

        await audio.play();
        return true;
      } catch {
        setStatus("Specialized speech unavailable, using browser voice");
        return false;
      }
    },
    [pitch, rate, resetSpeechState, selectedVoice, stop]
  );

  const getSelectionText = useCallback(() => {
    if (typeof window === "undefined") return "";
    return window.getSelection()?.toString().trim() || "";
  }, []);

  const getPageText = useCallback(() => {
    if (typeof document === "undefined") return "";
    const target = document.querySelector("main") || document.body;
    return target?.textContent?.replace(/\s+/g, " ").trim() || "";
  }, []);

  const readSelection = useCallback(() => {
    const text = getSelectionText();
    if (!text) {
      setStatus("Select text first, then tap Read Selection");
      return;
    }
    void (async () => {
      const playedSpecialized = await playSpecializedSpeech(text);
      if (!playedSpecialized) {
        startSpeech(text);
      }
    })();
  }, [getSelectionText, playSpecializedSpeech, startSpeech]);

  const readPage = useCallback(() => {
    const text = getPageText();
    void (async () => {
      const playedSpecialized = await playSpecializedSpeech(text);
      if (!playedSpecialized) {
        startSpeech(text);
      }
    })();
  }, [getPageText, playSpecializedSpeech, startSpeech]);

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      return;
    }
    if (!speechSupported) return;
    if (!window.speechSynthesis.speaking) return;
    window.speechSynthesis.pause();
    setIsPaused(true);
    setStatus("Paused");
  }, [speechSupported]);

  const resume = useCallback(() => {
    if (audioRef.current) {
      void audioRef.current.play().catch(() => {
        setStatus("Unable to resume playback");
      });
      return;
    }
    if (!speechSupported) return;
    if (!window.speechSynthesis.paused) return;
    window.speechSynthesis.resume();
    setIsPaused(false);
    setStatus("Reading");
  }, [speechSupported]);

  // Close panel on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!speechSupported) return;

    const parseStoredNumber = (key: string, fallback: number) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    setRate(parseStoredNumber(RATE_STORAGE_KEY, 1));
    setPitch(parseStoredNumber(PITCH_STORAGE_KEY, 1));
    setSelectedVoiceURI(window.localStorage.getItem(VOICE_STORAGE_KEY) || "");

    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      const mapped = available
        .map((voice) => ({
          name: voice.name,
          lang: voice.lang,
          voiceURI: voice.voiceURI,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      setVoices(mapped);

      if (!selectedVoiceURI && mapped.length > 0) {
        const englishVoice = mapped.find((voice) => voice.lang.toLowerCase().startsWith("en"));
        const fallback = englishVoice || mapped[0];
        setSelectedVoiceURI(fallback.voiceURI);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
      window.speechSynthesis.cancel();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    };
  }, [selectedVoiceURI, speechSupported]);

  useEffect(() => {
    if (!speechSupported) return;
    window.localStorage.setItem(RATE_STORAGE_KEY, String(rate));
  }, [rate, speechSupported]);

  useEffect(() => {
    if (!speechSupported) return;
    window.localStorage.setItem(PITCH_STORAGE_KEY, String(pitch));
  }, [pitch, speechSupported]);

  useEffect(() => {
    if (!speechSupported) return;
    if (!selectedVoiceURI) return;
    window.localStorage.setItem(VOICE_STORAGE_KEY, selectedVoiceURI);
  }, [selectedVoiceURI, speechSupported]);

  const isActive = isSpeaking || isPaused;

  // --- Inline playback bar (shown when speaking/paused and panel is closed) ---
  const renderPlaybackBar = () => {
    if (!isActive || open) return null;
    return (
      <div className="flex items-center gap-2 rounded-full bg-slate-900/90 backdrop-blur-sm text-white px-3 py-1.5 shadow-lg">
        <span className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${isPaused ? 'bg-amber-400' : 'bg-green-400 animate-pulse'}`} />
        <span className="text-[11px] truncate max-w-[100px] sm:max-w-[160px]">{status}</span>
        {isPaused ? (
          <button onClick={resume} className="p-1 hover:bg-white/20 rounded-full transition-colors" aria-label="Resume">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
          </button>
        ) : (
          <button onClick={pause} className="p-1 hover:bg-white/20 rounded-full transition-colors" aria-label="Pause">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
          </button>
        )}
        <button onClick={stop} className="p-1 hover:bg-red-500/40 rounded-full transition-colors" aria-label="Stop">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
        </button>
      </div>
    );
  };

  return (
    <>
      {/* --- Mobile: slim bottom bar trigger --- */}
      <div
        ref={panelRef}
        className="fixed bottom-0 left-0 right-0 z-50 sm:bottom-4 sm:right-4 sm:left-auto flex flex-col items-end pointer-events-none"
      >
        {/* Expanded panel */}
        {open && (
          <div
            id="accessibility-controls-panel"
            role="dialog"
            aria-label="Speech accessibility controls"
            className="
              pointer-events-auto w-full rounded-t-2xl border-t border-slate-200 bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.12)]
              sm:w-80 sm:rounded-xl sm:border sm:shadow-2xl sm:mb-2
              animate-in slide-in-from-bottom-4 fade-in duration-200
            "
          >
            {/* Header bar — drag-handle on mobile */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              {/* Mobile drag indicator */}
              <div className="sm:hidden absolute top-1.5 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-slate-300" />
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
                <span className="text-sm font-semibold text-slate-800">Speech Reader</span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                aria-label="Close speech controls"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 1l12 12M13 1L1 13" /></svg>
              </button>
            </div>

            <div className="p-4 space-y-3">
              {/* Quick actions — large touch targets for mobile */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm h-11 sm:h-9 rounded-lg"
                  onClick={() => { readPage(); }}
                  disabled={!canReadAloud || isSpeaking}
                >
                  <svg className="w-4 h-4 mr-1.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
                  Read Page
                </Button>
                <Button
                  type="button"
                  className="bg-slate-700 hover:bg-slate-800 text-white text-xs sm:text-sm h-11 sm:h-9 rounded-lg"
                  onClick={() => { readSelection(); }}
                  disabled={!canReadAloud || isSpeaking}
                >
                  <svg className="w-4 h-4 mr-1.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 10H3M21 6H3M21 14H3M17 18H3"/></svg>
                  Read Selection
                </Button>
              </div>

              {/* Playback controls — only when active */}
              {isActive && (
                <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5">
                  <div className="flex-1 flex items-center gap-1.5 min-w-0">
                    <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${isPaused ? 'bg-amber-400' : 'bg-green-500 animate-pulse'}`} />
                    <span className="text-xs text-slate-600 truncate">{status}</span>
                  </div>
                  {isPaused ? (
                    <button
                      onClick={resume}
                      className="rounded-lg bg-white border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 transition-colors active:scale-95"
                      aria-label="Resume reading"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
                    </button>
                  ) : (
                    <button
                      onClick={pause}
                      className="rounded-lg bg-white border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 transition-colors active:scale-95"
                      aria-label="Pause reading"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                    </button>
                  )}
                  <button
                    onClick={stop}
                    className="rounded-lg bg-white border border-red-200 p-2 text-red-500 hover:bg-red-50 transition-colors active:scale-95"
                    aria-label="Stop reading"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
                  </button>
                </div>
              )}

              {/* Status when idle */}
              {!isActive && status !== "Ready" && (
                <p className="text-xs text-slate-500 px-0.5" role="status" aria-live="polite">
                  {canReadAloud ? status : "Speech not supported in this browser"}
                </p>
              )}

              {/* Settings toggle */}
              <button
                type="button"
                onClick={() => setShowSettings((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors w-full py-1"
                aria-expanded={showSettings}
              >
                <svg className={`w-3 h-3 transition-transform ${showSettings ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
                Voice settings
              </button>

              {showSettings && (
                <div className="space-y-3 pt-1 border-t border-slate-100">
                  <div className="space-y-1.5">
                    <Label htmlFor="tts-voice" className="text-xs">Voice</Label>
                    <select
                      id="tts-voice"
                      className="h-9 sm:h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
                      value={selectedVoiceURI}
                      onChange={(event) => setSelectedVoiceURI(event.target.value)}
                      disabled={!speechSupported || voices.length === 0}
                    >
                      {voices.length === 0 && <option value="">No voice available</option>}
                      {voices.map((voice) => (
                        <option key={voice.voiceURI} value={voice.voiceURI}>
                          {voice.name} ({voice.lang})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="tts-rate" className="text-xs">Speed ({rate.toFixed(1)}x)</Label>
                      <input
                        id="tts-rate"
                        type="range"
                        min={0.6}
                        max={1.6}
                        step={0.1}
                        value={rate}
                        onChange={(event) => setRate(Number(event.target.value))}
                        disabled={!canReadAloud}
                        className="w-full h-2 accent-blue-600"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="tts-pitch" className="text-xs">Pitch ({pitch.toFixed(1)})</Label>
                      <input
                        id="tts-pitch"
                        type="range"
                        min={0.6}
                        max={1.6}
                        step={0.1}
                        value={pitch}
                        onChange={(event) => setPitch(Number(event.target.value))}
                        disabled={!canReadAloud}
                        className="w-full h-2 accent-blue-600"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Safe area padding for phones with gesture bars */}
            <div className="h-[env(safe-area-inset-bottom,0px)] sm:hidden" />
          </div>
        )}

        {/* Trigger area: FAB on desktop, inline mini-bar on mobile */}
        <div className="pointer-events-auto flex items-center justify-end gap-2 p-2 sm:p-0">
          {/* Playback mini-bar when panel is closed */}
          {renderPlaybackBar()}

          {/* FAB button */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="accessibility-controls-panel"
            aria-label={open ? "Close speech controls" : "Open speech controls"}
            className={`
              flex items-center justify-center rounded-full shadow-lg transition-all duration-200
              focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2
              ${isActive
                ? 'h-11 w-11 sm:h-12 sm:w-12 bg-blue-600 text-white hover:bg-blue-700 ring-2 ring-blue-300 ring-offset-1'
                : open
                  ? 'h-10 w-10 sm:h-11 sm:w-11 bg-slate-700 text-white hover:bg-slate-800'
                  : 'h-10 w-10 sm:h-11 sm:w-11 bg-slate-800 text-white hover:bg-slate-700'
              }
            `}
          >
            {isActive && !open ? (
              /* Animated speaking indicator */
              <div className="flex items-end gap-[3px] h-4">
                <span className="w-[3px] bg-white rounded-full animate-[speaking_0.8s_ease-in-out_infinite]" style={{ height: '40%' }} />
                <span className="w-[3px] bg-white rounded-full animate-[speaking_0.8s_ease-in-out_0.15s_infinite]" style={{ height: '70%' }} />
                <span className="w-[3px] bg-white rounded-full animate-[speaking_0.8s_ease-in-out_0.3s_infinite]" style={{ height: '100%' }} />
                <span className="w-[3px] bg-white rounded-full animate-[speaking_0.8s_ease-in-out_0.45s_infinite]" style={{ height: '55%' }} />
              </div>
            ) : (
              /* Speaker icon */
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Keyframe for speaking animation */}
      <style>{`
        @keyframes speaking {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </>
  );
};

export default AccessibilityControls;
