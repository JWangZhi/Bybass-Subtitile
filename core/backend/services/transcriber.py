"""
Transcriber Service
Handles speech-to-text with Faster Whisper (GPU/CPU).
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Union
import numpy as np

# CPU-bound transcription pool
_executor = ThreadPoolExecutor(max_workers=2)


class TranscriberService:
    """Faster-whisper wrapper with GPU support and CPU fallback."""
    
    def __init__(self, model_size: str = "small", device: str = "auto") -> None:
        self.model_size = model_size
        self.model = None
        self.is_ready = False
        self.device = device
        self.configured_device = device
        
    async def initialize(self) -> None:
        print(f"📦 Loading Whisper model: {self.model_size} (device: {self.configured_device})")
        
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(_executor, self._load_model)
        
        self.is_ready = True
        print(f"✅ Model loaded successfully on {self.device.upper()}")
    
    def _load_model(self) -> None:
        try:
            from faster_whisper import WhisperModel
            
            # Explicit CPU
            if self.configured_device == "cpu":
                print("🖥️ Using CPU for transcription (configured)")
                self.model = WhisperModel(self.model_size, device="cpu", compute_type="int8")
                self.device = "cpu"
                return
            
            # Try GPU
            if self.configured_device in ("auto", "cuda"):
                try:
                    self.model = WhisperModel(self.model_size, device="cuda", compute_type="float16")
                    self.device = "cuda"
                    print("🎮 Using GPU (CUDA) for transcription")
                    return
                except Exception as gpu_error:
                    print(f"⚠️ GPU not available: {gpu_error}")
                    if self.configured_device == "cuda": raise
                    print("🖥️ Falling back to CPU...")
            
            # Fallback
            self.model = WhisperModel(self.model_size, device="cpu", compute_type="int8")
            self.device = "cpu"
            print("🖥️ Using CPU for transcription")
                
        except ImportError as e:
            print(f"❌ Failed to import faster-whisper: {e}")
            raise
    
    async def transcribe(self, audio_input: Union[bytes, str], progress_callback: Any = None) -> dict[str, Any]:
        """Transcribe PCM 16-bit 16kHz mono audio or file path."""
        if not self.is_ready or self.model is None:
            return {"error": "Model not ready", "text": ""}
        
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(_executor, self._transcribe_sync, audio_input)
            return result
        except Exception as e:
            print(f"❌ Transcription error: {e}")
            return {"error": str(e), "text": ""}
    
    def _transcribe_sync(self, audio_input: Union[bytes, str]) -> dict[str, Any]:
        if isinstance(audio_input, str):
            # Pass path directly
            audio_for_model = audio_input
        else:
            # Convert bytes to float32
            audio_for_model = np.frombuffer(audio_input, dtype=np.int16).astype(np.float32) / 32768.0
        
        segments, info = self.model.transcribe(
            audio_for_model,
            beam_size=5,
            language=None,
            vad_filter=True,
        )
        
        segments_list = []
        full_text = []
        
        for segment in segments:
            segments_list.append({
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip(),
            })
            full_text.append(segment.text.strip())
        
        return {
            "text": " ".join(full_text),
            "segments": segments_list,
            "language": info.language,
            "language_probability": info.language_probability,
            "provider": "local",
        }
