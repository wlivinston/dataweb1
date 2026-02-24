import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState("");
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [status, setStatus] = useState("Ready");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

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
      setStatus("Select text first, then choose Read Selection");
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

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(92vw,22rem)]">
      <Button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full bg-slate-900 text-white hover:bg-slate-800"
        aria-expanded={open}
        aria-controls="accessibility-controls-panel"
      >
        Accessibility and Speech
      </Button>

      {open && (
        <Card
          id="accessibility-controls-panel"
          className="mt-2 border-slate-300 bg-white/95 shadow-xl backdrop-blur-sm"
        >
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Braille and TTS Support</CardTitle>
            <p className="text-xs text-slate-600">
              Screen-reader and refreshable-braille users benefit from this semantic content mode. Use controls below to read content aloud.
            </p>
            {SPECIALIZED_TTS_ENDPOINT && (
              <p className="text-xs text-emerald-700">
                Specialized speech endpoint detected.
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tts-voice">Voice</Label>
              <select
                id="tts-voice"
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
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
              <div className="space-y-2">
                <Label htmlFor="tts-rate">Rate ({rate.toFixed(2)})</Label>
                <Input
                  id="tts-rate"
                  type="range"
                  min={0.6}
                  max={1.6}
                  step={0.05}
                  value={rate}
                  onChange={(event) => setRate(Number(event.target.value))}
                  disabled={!canReadAloud}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tts-pitch">Pitch ({pitch.toFixed(2)})</Label>
                <Input
                  id="tts-pitch"
                  type="range"
                  min={0.6}
                  max={1.6}
                  step={0.05}
                  value={pitch}
                  onChange={(event) => setPitch(Number(event.target.value))}
                  disabled={!canReadAloud}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" onClick={readSelection} disabled={!canReadAloud}>
                Read Selection
              </Button>
              <Button type="button" variant="secondary" onClick={readPage} disabled={!canReadAloud}>
                Read Page
              </Button>
              <Button type="button" variant="outline" onClick={pause} disabled={!isSpeaking || isPaused}>
                Pause
              </Button>
              <Button type="button" variant="outline" onClick={resume} disabled={!isPaused}>
                Resume
              </Button>
            </div>

            <Button type="button" variant="destructive" className="w-full" onClick={stop} disabled={!isSpeaking && !isPaused}>
              Stop
            </Button>

            <p className="text-xs text-slate-700" role="status" aria-live="polite">
              Status: {canReadAloud ? status : "Speech not supported in this browser"}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AccessibilityControls;
