"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { animate, stagger } from "animejs";

interface JobStatus {
  job_id: string;
  status: string;
  progress: number;
  error: string | null;
  has_srt: boolean;
  has_burned_video: boolean;
}

const LANGUAGES = [
  { value: "auto", label: "Auto Detect" },
  { value: "en", label: "English" },
  { value: "vi", label: "Vietnamese" },
  { value: "zh", label: "Chinese" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "es", label: "Spanish" },
  { value: "ru", label: "Russian" },
  { value: "th", label: "Thai" },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8765";
const API_SECRET = process.env.NEXT_PUBLIC_API_SECRET || "e3b0c44298fc1c149afbf4c893zfb92427ae41e4649b934ca493991b7852b855";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sourceLang, setSourceLang] = useState("auto");
  const [targetLang, setTargetLang] = useState("vi");
  const [burnSubs, setBurnSubs] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const uploadZoneRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const loaderCoreRef = useRef<HTMLDivElement>(null);
  const loaderRingRef = useRef<HTMLDivElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      if (!isValidVideo(droppedFile)) {
        setError("Invalid file type.");
        return;
      }
      setFile(droppedFile);
      setError(null);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
    }
  };

  const isValidVideo = (file: File) => {
    const validTypes = ["video/mp4", "video/x-matroska", "video/avi", "video/quicktime", "video/webm"];
    return validTypes.includes(file.type) || file.name.match(/\.(mp4|mkv|avi|mov|webm)$/i);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("source_lang", sourceLang);
      formData.append("target_lang", targetLang);
      formData.append("burn", String(burnSubs));

      const res = await fetch(`${API_URL}/api/video/upload`, {
        method: "POST",
        headers: { "X-API-Key": API_SECRET },
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setJobId(data.job_id);
      connectWebSocket(data.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const connectWebSocket = useCallback((id: string) => {
    if (wsRef.current) wsRef.current.close();

    const wsUrl = API_URL.replace("http", "ws") + `/api/video/ws/${id}`;
    const socket = new WebSocket(wsUrl);

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.error) {
          setError(data.error);
          setStatus({ ...status, status: "error", error: data.error } as JobStatus);
          return;
        }
        setStatus(data);
        if (data.status === "done" || data.status === "error") {
          socket.close();
        }
      } catch (err) {
        console.error("WS parse error", err);
      }
    };

    socket.onerror = (err) => {
      console.error("WS error", err);
      setError("CONNECTION_LOST: Remote host terminated session.");
    };

    socket.onclose = (event) => {
      console.log("WS connection closed", event);
      // If closed cleanly by us (code 1000) or job is done, ignore
      if (event.code === 1000 || status?.status === "done" || status?.status === "error") {
        return;
      }
      // Otherwise, assume server crash or network lost
      if (status?.status !== "done") {
        const errorMsg = "CONNECTION_LOST: Server shut down or network failed.";
        setError(errorMsg);
        setStatus((prev) => prev ? { ...prev, status: "error", error: errorMsg } : null);
      }
    };

    wsRef.current = socket;
  }, [status]);

  useEffect(() => {
    animate(".animate-on-mount", {
      y: [20, 0],
      opacity: [0, 1],
      delay: stagger(100),
      easing: "easeOutExpo",
      duration: 1000,
    });

    const titleText = "BYPASS_SUBTITLES";
    if (titleRef.current) {
      titleRef.current.innerHTML = "";
      titleText.split("").forEach((char) => {
        const span = document.createElement("span");
        span.innerText = char;
        span.style.opacity = "0";
        titleRef.current?.appendChild(span);
      });

      const cursor = document.createElement("span");
      cursor.innerText = "_";
      cursor.className = "blink";
      cursor.style.opacity = "0";
      cursor.id = "terminal-cursor";
      titleRef.current?.appendChild(cursor);

      animate(titleRef.current.querySelectorAll("span:not(#terminal-cursor)"), {
        opacity: [0, 1],
        delay: stagger(80),
        duration: 200,
        easing: 'linear',
        complete: () => {
          animate("#terminal-cursor", {
            opacity: [0, 1],
            duration: 100
          });
        }
      });
    }

    if (uploadZoneRef.current) {
      animate(uploadZoneRef.current, {
        scale: [1, 1.01, 1],
        borderColor: ['rgba(220, 220, 198, 0.1)', 'rgba(220, 220, 198, 0.4)', 'rgba(220, 220, 198, 0.1)'],
        duration: 4000,
        direction: 'alternate',
        loop: true,
        easing: 'easeInOutQuad'
      });
    }

    return () => { if (wsRef.current) wsRef.current.close(); };
  }, []);

  // Handle auto-download when status changes to "done"
  const downloadTriggeredRef = useRef<string | null>(null);

  useEffect(() => {
    if (status?.status === "done" && jobId && downloadTriggeredRef.current !== jobId) {
      downloadTriggeredRef.current = jobId;

      if (status.has_burned_video) {
        // Auto-download only Video if burned
        setTimeout(() => downloadBurnedVideo(), 1000);
      } else if (status.has_srt) {
        // Auto-download SRT if no burned video
        setTimeout(() => downloadSRT(), 1000);
      }
    }
  }, [status, jobId]);

  useEffect(() => {
    if (jobId && !status?.status.includes("error") && !status?.status.includes("done")) {
      const coreEl = document.querySelector(".loader-core");
      if (coreEl) {
        animate(".loader-core", {
          scale: [1, 1.4, 1],
          opacity: [0.5, 1, 0.5],
          duration: 1000,
          loop: true,
          easing: "easeInOutSine"
        });
        animate(".loader-bars", {
          rotate: '1turn',
          duration: 3000,
          loop: true,
          easing: "linear"
        });
        animate(".loader-ring", {
          scale: [0.5, 1.5],
          opacity: [0.5, 0],
          duration: 2000,
          loop: true,
          easing: "easeOutExpo",
          delay: stagger(400)
        });
      }
    }
  }, [jobId, status?.status]);

  const resetForm = () => {
    setFile(null);
    setJobId(null);
    setStatus(null);
    setError(null);
    if (wsRef.current) wsRef.current.close();
  };

  const downloadSRT = () => {
    if (jobId) {
      window.open(`${API_URL}/api/video/download/${jobId}`, "_blank");
    }
  };

  const downloadBurnedVideo = () => {
    if (jobId) {
      window.open(`${API_URL}/api/video/download/${jobId}?burned=true`, "_blank");
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-[#0a0a0a] font-retro text-[#f0f0f0] relative selection:bg-transparent selection:text-inherit">
      <div className="crt-overlay pointer-events-none" />
      <div className="noise-overlay pointer-events-none" />

      <section className="flex-1 min-w-0 border-r border-white/5 flex flex-col items-center justify-center p-12 bg-[#050505] relative">
        <header className="absolute top-12 left-12">
          <h1 ref={titleRef} className="text-7xl font-black tracking-tighter" style={{ color: 'var(--accent)', textShadow: '0 0 20px var(--accent-glow)' }}></h1>
          <p className="text-sm tracking-[0.5em] opacity-40 uppercase mt-2 font-bold animate-on-mount">Infrastructure Control Unit</p>
        </header>

        {!jobId ? (
          <div className="w-full max-w-4xl animate-on-mount">
            <div
              ref={uploadZoneRef}
              className={`upload-zone-wow h-[500px] w-full border-2 rounded-[3rem] flex flex-col items-center justify-center cursor-pointer transition-all ${dragOver ? "scale-[1.02] border-[var(--accent)] bg-white/5" : ""}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFileChange} className="hidden" />
              <div className="text-center group">
                {file ? (
                  <>
                    <div className="text-[12rem] mb-8 transition-transform group-hover:scale-110 duration-500">🎞️</div>
                    <h2 className="text-5xl font-black mb-4 text-white uppercase tracking-tighter">{file.name}</h2>
                    <p className="text-2xl opacity-60 font-bold uppercase tracking-[0.3em]">{(file.size / 1024 / 1024).toFixed(2)} MB MOUNTED</p>
                  </>
                ) : (
                  <>
                    <div className="text-[10rem] mb-8 opacity-40 transition-all group-hover:opacity-100 group-hover:scale-110 duration-500">💾</div>
                    <h2 className="text-7xl font-black mb-4 text-white tracking-tighter group-hover:text-[var(--accent)] transition-colors">DRAG_VIDEO_HERE</h2>
                    <p className="text-2xl opacity-40 tracking-[0.4em] uppercase font-black">MP4 / MKV / AVI / MOV / WebM</p>
                  </>
                )}
              </div>
            </div>
            {error && <div className="mt-6 p-5 text-center text-red-500 font-black text-sm tracking-widest uppercase border-2 border-red-500/30 bg-red-500/10 rounded-2xl">{error}</div>}
          </div>
        ) : (
          <div className="text-center w-full max-w-2xl animate-on-mount flex flex-col items-center">
            {/* Custom Loader Component */}
            <div className="tech-loader">
              {status?.status === "done" ? (
                <div className="text-[12rem]">✅</div>
              ) : status?.status === "error" ? (
                <div className="text-[12rem]">❌</div>
              ) : (
                <>
                  <div className="loader-ring"></div>
                  <div className="loader-ring" style={{ animationDelay: '0.4s' }}></div>
                  <div className="loader-bars"></div>
                  <div className="loader-core" ref={loaderCoreRef}></div>
                </>
              )}
            </div>

            <h2 className={`text-8xl font-black mb-10 tracking-tighter uppercase ${status?.status === "error" ? "text-red-500" : ""}`}>
              {status ? status.status : "INITIALIZING"}
            </h2>

            {status && status.status !== "done" && status.status !== "error" && (
              <div className="w-full px-12">
                <div className="h-4 w-full bg-white/5 rounded-full overflow-hidden mb-6 border border-white/10">
                  <div className="h-full bg-[var(--accent)] transition-all duration-700 shadow-[0_0_30px_var(--accent)]" style={{ width: `${status.progress}%` }} />
                </div>
                <p className="text-3xl font-black opacity-50 tracking-[0.4em]">{status.progress}% COMPLETE</p>
              </div>
            )}

            {status?.status === "error" && (
              <div className="px-12 mb-10">
                <div className="p-6 border-2 border-red-500/30 bg-red-500/5 rounded-2xl">
                  <p className="text-xl font-black text-red-500 uppercase tracking-widest leading-relaxed">
                    {status.error || "Execution Interrupted: Unknown Error"}
                  </p>
                </div>
              </div>
            )}

            {status?.status === "done" && (
              <div className="flex gap-8 justify-center mt-16 px-12 w-full">
                {status.has_burned_video ? (
                  <button onClick={downloadBurnedVideo} className="flex-1 bg-[var(--accent)] text-black py-6 rounded-2xl font-black text-3xl hover:bg-white hover:scale-105 active:scale-95 transition-all shadow-[0_0_40px_rgba(220,220,198,0.3)]">DOWNLOAD_VIDEO</button>
                ) : (
                  status.has_srt && <button onClick={downloadSRT} className="flex-1 bg-[var(--accent)] text-black py-6 rounded-2xl font-black text-3xl hover:bg-white hover:scale-105 active:scale-95 transition-all shadow-[0_0_40px_rgba(220,220,198,0.3)]">DOWNLOAD_SRT</button>
                )}
              </div>
            )}

            {(status?.status === "done" || status?.status === "error") && (
              <button onClick={resetForm} className="mt-16 text-sm opacity-30 uppercase tracking-[0.8em] font-black hover:opacity-100 italic transition-all block w-full text-center hover:scale-105">Terminate_Session</button>
            )}
          </div>
        )}

        <footer className="absolute bottom-12 left-12 opacity-30 text-xs tracking-[0.8em] uppercase font-black">
          © 2026 QI LABS · AUTHOR: WANGZHI · v1.0.1
        </footer>
      </section>

      <aside className="w-[320px] h-full bg-[#0d0d0d] flex flex-col justify-between p-8 border-l border-white/5">
        <div className="space-y-10 mt-6">
          <div className="pb-6 border-b border-white/10">
            <p className="text-[10px] font-black tracking-[0.6em] opacity-30 uppercase mb-2">Network_Status</p>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <p className="text-xl font-black tracking-tighter" style={{ color: 'var(--accent)' }}>O P E R A T I O N A L</p>
            </div>
          </div>

          <div className="space-y-8">
            <div className="space-y-3">
              <label className="text-xs tracking-[0.3em] opacity-40 uppercase font-bold ml-1">Source_Language</label>
              <select
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                className="w-full bg-white/5 border border-white/10 p-4 rounded-xl text-2xl font-black text-white outline-none focus:border-[var(--accent)] cursor-pointer transition-colors"
              >
                {LANGUAGES.map(l => <option key={l.value} value={l.value} className="bg-[#1a1a1a]">{l.label.toUpperCase()}</option>)}
              </select>
            </div>

            <div className="space-y-3">
              <label className="text-xs tracking-[0.3em] opacity-40 uppercase font-bold ml-1">Target_Language</label>
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="w-full bg-white/5 border border-white/10 p-4 rounded-xl text-2xl font-black text-white outline-none focus:border-[var(--accent)] cursor-pointer transition-colors"
              >
                {LANGUAGES.filter(l => l.value !== "auto").map(l => <option key={l.value} value={l.value} className="bg-[#1a1a1a]">{l.label.toUpperCase()}</option>)}
              </select>
            </div>

            <div
              className={`flex items-center justify-between p-5 border border-white/10 rounded-xl cursor-pointer transition-all hover:bg-white/5 has-tooltip ${burnSubs ? "border-[var(--accent)] bg-[var(--accent)]/10" : ""}`}
              onClick={() => setBurnSubs(!burnSubs)}
            >
              <div className="tooltip-content shadow-xl">
                Burn translations into the video pixels for offline viewing.
              </div>
              <label className="text-sm font-black tracking-[0.2em] uppercase cursor-pointer">Burn_Subtitles</label>
              <div className={`w-8 h-8 border-2 rounded-lg flex items-center justify-center transition-all ${burnSubs ? "bg-[var(--accent)] border-[var(--accent)]" : "border-white/20"}`}>
                {burnSubs && <span className="text-black text-xl font-black">✓</span>}
              </div>
            </div>
          </div>

          <div className="space-y-5 pt-8">
            <div className="flex items-center gap-4 group cursor-help has-tooltip">
              <div className="tooltip-content shadow-xl">
                Blazing fast inference using Groq LPU hardware acceleration.
              </div>
              <span className="text-3xl filter saturate-0 group-hover:saturate-100 transition-all">⚡</span>
              <p className="text-[11px] font-black tracking-[0.4em] uppercase opacity-30 group-hover:opacity-100 transition-opacity">Groq_Accelerated</p>
            </div>
            <div className="flex items-center gap-4 group cursor-help has-tooltip">
              <div className="tooltip-content shadow-xl">
                Automated stripping of GPS, camera, and user-identifying metadata.
              </div>
              <span className="text-3xl filter saturate-0 group-hover:saturate-100 transition-all">🛡️</span>
              <p className="text-[11px] font-black tracking-[0.4em] uppercase opacity-30 group-hover:opacity-100 transition-opacity">Metadata_Secured</p>
            </div>
            <div className="flex items-center gap-4 group cursor-help has-tooltip">
              <div className="tooltip-content shadow-xl">
                Highest fidelity transcription using OpenAI Whisper-L3-V3.
              </div>
              <span className="text-3xl filter saturate-0 group-hover:saturate-100 transition-all">🎯</span>
              <p className="text-[11px] font-black tracking-[0.4em] uppercase opacity-30 group-hover:opacity-100 transition-opacity">Whisper_L3_V3</p>
            </div>
          </div>
        </div>

        <div className="pb-6">
          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="w-full h-20 bg-[var(--accent)] text-black font-black text-3xl tracking-tighter hover:bg-white active:scale-95 transition-all disabled:opacity-30 flex items-center justify-center shadow-[0_0_50px_rgba(220,220,198,0.2)] rounded-2xl"
          >
            {uploading ? "EXECUTING..." : "START_BYPASS"}
          </button>
        </div>
      </aside>
    </div>
  );
}
