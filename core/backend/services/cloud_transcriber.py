"""
Cloud Transcription Service - Groq & OpenAI Whisper APIs

Handles speech-to-text via cloud APIs for users without GPU.
"""

import os
import json
import asyncio
import tempfile
from abc import ABC, abstractmethod
from typing import Any, Union


class CloudTranscriberBase(ABC):
    """Base class for cloud transcription services."""
    
    @abstractmethod
    async def transcribe(self, audio_data: Union[bytes, str], progress_callback: Any = None) -> dict[str, Any]:
        """Transcribe audio data."""
        pass
    
    @abstractmethod
    async def is_available(self) -> bool:
        """Check if the service is available."""
        pass

    def _pcm_to_wav(self, pcm_data: bytes, sample_rate: int = 16000) -> bytes:
        """Convert PCM 16-bit data to WAV format."""
        import struct
        
        num_channels = 1
        bits_per_sample = 16
        byte_rate = sample_rate * num_channels * bits_per_sample // 8
        block_align = num_channels * bits_per_sample // 8
        data_size = len(pcm_data)
        
        header = struct.pack(
            '<4sI4s4sIHHIIHH4sI',
            b'RIFF',
            36 + data_size,
            b'WAVE',
            b'fmt ',
            16,
            1,
            num_channels,
            sample_rate,
            byte_rate,
            block_align,
            bits_per_sample,
            b'data',
            data_size,
        )
        
        return header + pcm_data

    async def _get_audio_duration(self, wav_path: str) -> float:
        """Get duration of audio file in seconds using ffprobe."""
        import asyncio
        import json
        
        cmd = [
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_format", wav_path
        ]
        
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await process.communicate()
        
        if process.returncode == 0:
            data = json.loads(stdout)
            return float(data["format"]["duration"])
        return 0.0

    async def _chunk_audio(self, input_wav: str, chunk_duration: int = 600, overlap: int = 10) -> list[str]:
        """
        Chunk audio file into segments with overlap using FFmpeg.
        Returns list of paths to chunk files.
        """
        from pathlib import Path
        
        duration = await self._get_audio_duration(input_wav)
        if duration <= chunk_duration + overlap:
            return [input_wav]
            
        chunks = []
        start_time = 0
        chunk_idx = 0
        
        temp_dir = Path(os.path.dirname(input_wav))
        
        while start_time < duration:
            output_path = str(temp_dir / f"chunk_{chunk_idx}.wav")
            
            # Extract chunk with overlap
            # cmd: ffmpeg -ss [start] -t [duration+overlap] -i [input] [output]
            cmd = [
                "ffmpeg", "-y",
                "-ss", str(start_time),
                "-t", str(chunk_duration + overlap),
                "-i", input_wav,
                "-acodec", "copy",
                output_path
            ]
            
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            await process.communicate()
            
            if os.path.exists(output_path):
                chunks.append(output_path)
            
            start_time += chunk_duration
            chunk_idx += 1
            
            if start_time + overlap >= duration:
                break
                
        return chunks


class GroqTranscriber(CloudTranscriberBase):
    """
    Transcription using Groq Whisper API.
    
    Groq offers very fast Whisper inference with a generous free tier.
    """
    
    def __init__(self, api_key: str, model: str = "whisper-large-v3"):
        self.api_key = api_key
        self.model = model
        self._client = None
        
    async def _get_client(self):
        """Get or create Groq client."""
        if self._client is None:
            from groq import AsyncGroq
            self._client = AsyncGroq(api_key=self.api_key)
        return self._client
    
    async def is_available(self) -> bool:
        """Check if Groq API is available."""
        try:
            await self._get_client()
            return True
        except Exception as e:
            print(f"⚠️ Groq not available: {e}")
            return False
    
    async def transcribe(self, audio_data: Union[bytes, str], progress_callback: Any = None) -> dict[str, Any]:
        """
        Transcribe audio using Groq Whisper API, with automatic chunking.
        """
        try:
            temp_path = None
            should_cleanup = False
            
            if isinstance(audio_data, str):
                temp_path = audio_data
            else:
                # 1. Convert to WAV
                wav_data = self._pcm_to_wav(audio_data)
                
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
                    temp_file.write(wav_data)
                    temp_path = temp_file.name
                    should_cleanup = True
            
            try:
            
            try:
                size_mb = os.path.getsize(temp_path) / (1024 * 1024)
                duration = await self._get_audio_duration(temp_path)
                
                # Chunk if size > 25MB or duration > 15m (900s)
                if size_mb > 25 or duration > 900:
                    print(f"📦 Audio is large ({size_mb:.1f}MB, {duration:.1f}s). Enabling chunking...")
                    chunks = await self._chunk_audio(temp_path, chunk_duration=600, overlap=10)
                    chunk_results = []
                    
                    for i, chunk_path in enumerate(chunks):
                        if progress_callback:
                            await progress_callback(i + 1, len(chunks))
                        print(f"🎙️ Transcribing chunk {i+1}/{len(chunks)}...")
                        with open(chunk_path, "rb") as f:
                            chunk_data = f.read()
                        
                        # Note: _transcribe_single expects PCM bytes if we are calling it like this,
                        # but it's easier to just call the API directly for chunks.
                        res = await self._transcribe_file(chunk_path)
                        if res.get("error"):
                            return res
                        chunk_results.append(res)
                        
                        # Cleanup temp chunk if it's not the original
                        if chunk_path != temp_path:
                            try:
                                os.remove(chunk_path)
                            except Exception:
                                pass
                    
                    # Merge results
                    from services.transcription_merger import TranscriptionMerger
                    merged_segments = TranscriptionMerger.merge_segments(chunk_results)
                    full_text = TranscriptionMerger.merge_text(chunk_results)
                    
                    return {
                        "text": full_text,
                        "segments": merged_segments,
                        "language": chunk_results[0].get("language", "unknown"),
                        "provider": "groq",
                    }
                else:
                    # Single file transcription
                    return await self._transcribe_file(temp_path)
                    
            finally:
                if os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except Exception:
                        pass
                    
        except Exception as e:
            print(f"❌ Groq transcription error: {e}")
            return {"error": str(e), "text": "", "provider": "groq"}

    async def _transcribe_file(self, wav_path: str) -> dict[str, Any]:
        """Low-level API call for a single file."""
        client = await self._get_client()
        with open(wav_path, "rb") as audio_file:
            transcription = await client.audio.transcriptions.create(
                file=audio_file,
                model=self.model,
                response_format="verbose_json",
            )
        
        segments = []
        if hasattr(transcription, 'segments') and transcription.segments:
            for seg in transcription.segments:
                segments.append({
                    "start": seg.get("start", 0),
                    "end": seg.get("end", 0),
                    "text": seg.get("text", "").strip(),
                })
        
        return {
            "text": transcription.text.strip() if transcription.text else "",
            "segments": segments,
            "language": getattr(transcription, 'language', 'unknown'),
            "provider": "groq",
        }


class OpenAITranscriber(CloudTranscriberBase):
    """
    Transcription using OpenAI Whisper API.
    """
    
    def __init__(self, api_key: str, model: str = "whisper-1"):
        self.api_key = api_key
        self.model = model
        self._client = None
        
    async def _get_client(self):
        """Get or create OpenAI client."""
        if self._client is None:
            from openai import AsyncOpenAI
            self._client = AsyncOpenAI(api_key=self.api_key)
        return self._client
    
    async def is_available(self) -> bool:
        """Check if OpenAI API is available."""
        try:
            await self._get_client()
            return True
        except Exception as e:
            print(f"⚠️ OpenAI not available: {e}")
            return False
    
    async def transcribe(self, audio_data: Union[bytes, str], progress_callback: Any = None) -> dict[str, Any]:
        """
        Transcribe audio using OpenAI Whisper API, with automatic chunking.
        """
        try:
            temp_path = None
            should_cleanup = False

            if isinstance(audio_data, str):
                temp_path = audio_data
            else:
                wav_data = self._pcm_to_wav(audio_data)
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
                    temp_file.write(wav_data)
                    temp_path = temp_file.name
                    should_cleanup = True
            
            try:
            
            try:
                size_mb = os.path.getsize(temp_path) / (1024 * 1024)
                duration = await self._get_audio_duration(temp_path)
                
                if size_mb > 25 or duration > 900:
                    print(f"📦 Audio is large ({size_mb:.1f}MB, {duration:.1f}s). Enabling chunking...")
                    chunks = await self._chunk_audio(temp_path, chunk_duration=600, overlap=10)
                    chunk_results = []
                    
                    for i, chunk_path in enumerate(chunks):
                        if progress_callback:
                            await progress_callback(i + 1, len(chunks))
                        print(f"🎙️ Transcribing chunk {i+1}/{len(chunks)}...")
                        res = await self._transcribe_file(chunk_path)
                        if res.get("error"):
                            return res
                        chunk_results.append(res)
                        if chunk_path != temp_path:
                            try:
                                os.remove(chunk_path)
                            except Exception:
                                pass
                    
                    from services.transcription_merger import TranscriptionMerger
                    merged_segments = TranscriptionMerger.merge_segments(chunk_results)
                    full_text = TranscriptionMerger.merge_text(chunk_results)
                    
                    return {
                        "text": full_text,
                        "segments": merged_segments,
                        "language": chunk_results[0].get("language", "unknown"),
                        "provider": "openai",
                    }
                else:
                    return await self._transcribe_file(temp_path)
                    
            finally:
                if os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except Exception:
                        pass
                    
        except Exception as e:
            print(f"❌ OpenAI transcription error: {e}")
            return {"error": str(e), "text": "", "provider": "openai"}

    async def _transcribe_file(self, wav_path: str) -> dict[str, Any]:
        """Low-level API call for a single file."""
        client = await self._get_client()
        with open(wav_path, "rb") as audio_file:
            transcription = await client.audio.transcriptions.create(
                file=audio_file,
                model=self.model,
                response_format="verbose_json",
            )
        
        segments = []
        if hasattr(transcription, 'segments') and transcription.segments:
            for seg in transcription.segments:
                segments.append({
                    "start": seg.start,
                    "end": seg.end,
                    "text": seg.text.strip(),
                })
        
        return {
            "text": transcription.text.strip() if transcription.text else "",
            "segments": segments,
            "language": getattr(transcription, 'language', 'unknown'),
            "provider": "openai",
        }


class KeyPool:
    """
    Round-robin key rotation for API rate limit distribution.
    Thread-safe for concurrent requests.
    """
    
    def __init__(self, keys: list[str]):
        self._keys = keys
        self._index = 0
        self._lock = None  # Will be created on first use
    
    def _get_lock(self):
        if self._lock is None:
            import asyncio
            self._lock = asyncio.Lock()
        return self._lock
    
    async def get_next_key(self) -> str | None:
        """Get next key in rotation. Returns None if no keys available."""
        if not self._keys:
            return None
        
        async with self._get_lock():
            key = self._keys[self._index]
            self._index = (self._index + 1) % len(self._keys)
            return key
    
    @property
    def size(self) -> int:
        return len(self._keys)


class DeepgramTranscriber(CloudTranscriberBase):
    """
    Transcription using Deepgram Nova-2 API with key rotation.
    """
    
    DEEPGRAM_API_URL = "https://api.deepgram.com/v1/listen"
    
    def __init__(self, key_pool: KeyPool):
        self.key_pool = key_pool
        
    async def is_available(self) -> bool:
        """Check if Deepgram API is available (has keys)."""
        return self.key_pool.size > 0
    
    async def transcribe(self, audio_data: Union[bytes, str], progress_callback: Any = None) -> dict[str, Any]:
        """
        Transcribe audio using Deepgram Nova-2 API, with automatic chunking.
        """
        try:
            temp_path = None
            should_cleanup = False

            if isinstance(audio_data, str):
                temp_path = audio_data
            else:
                wav_data = self._pcm_to_wav(audio_data)
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
                    temp_file.write(wav_data)
                    temp_path = temp_file.name
                    should_cleanup = True
            
            try:
            
            try:
                size_mb = os.path.getsize(temp_path) / (1024 * 1024)
                duration = await self._get_audio_duration(temp_path)
                
                # Deepgram limit is much higher but for consistency we chunk similarly if needed
                if size_mb > 50 or duration > 1200:
                    print(f"📦 Audio is very large ({size_mb:.1f}MB, {duration:.1f}s). Enabling chunking for stability...")
                    chunks = await self._chunk_audio(temp_path, chunk_duration=600, overlap=10)
                    chunk_results = []
                    
                    for i, chunk_path in enumerate(chunks):
                        if progress_callback:
                            await progress_callback(i + 1, len(chunks))
                        print(f"🎙️ Transcribing chunk {i+1}/{len(chunks)}...")
                        res = await self._transcribe_file(chunk_path)
                        if res.get("error"):
                            return res
                        chunk_results.append(res)
                        if chunk_path != temp_path:
                            try:
                                os.remove(chunk_path)
                            except Exception:
                                pass
                    
                    from services.transcription_merger import TranscriptionMerger
                    merged_segments = TranscriptionMerger.merge_segments(chunk_results)
                    full_text = TranscriptionMerger.merge_text(chunk_results)
                    
                    return {
                        "text": full_text,
                        "segments": merged_segments,
                        "language": chunk_results[0].get("language", "unknown"),
                        "provider": "deepgram",
                    }
                else:
                    return await self._transcribe_file(temp_path)
                    
            finally:
                if os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except Exception:
                        pass
                    
        except Exception as e:
            print(f"Deepgram transcription error: {e}")
            return {"error": str(e), "text": "", "provider": "deepgram"}

    async def _transcribe_file(self, wav_path: str) -> dict[str, Any]:
        """Low-level API call for a single file."""
        import aiohttp
        api_key = await self.key_pool.get_next_key()
        if not api_key:
            return {"error": "No Deepgram keys available", "text": "", "provider": "deepgram"}
        
        with open(wav_path, "rb") as audio_file:
            wav_data = audio_file.read()
            
        headers = {
            "Authorization": f"Token {api_key}",
            "Content-Type": "audio/wav",
        }
        
        params = {
            "model": "nova-2",
            "language": "en",
            "punctuate": "true",
            "smart_format": "true",
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                self.DEEPGRAM_API_URL,
                headers=headers,
                params=params,
                data=wav_data,
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    return {"error": f"HTTP {response.status}: {error_text}", "text": "", "provider": "deepgram"}
                
                result = await response.json()
        
        # Parse response
        transcript = ""
        segments = []
        if "results" in result and "channels" in result["results"]:
            channel = result["results"]["channels"][0]
            if "alternatives" in channel and channel["alternatives"]:
                alternative = channel["alternatives"][0]
                transcript = alternative.get("transcript", "")
                if "words" in alternative:
                    words = alternative["words"]
                    if words:
                        current_segment = {"start": words[0]["start"], "end": 0, "text": ""}
                        for word in words:
                            current_segment["end"] = word["end"]
                            current_segment["text"] += word["word"] + " "
                            if word["end"] - current_segment["start"] >= 3.0:
                                current_segment["text"] = current_segment["text"].strip()
                                segments.append(current_segment)
                                current_segment = {"start": word["end"], "end": 0, "text": ""}
                        if current_segment["text"].strip():
                            current_segment["text"] = current_segment["text"].strip()
                            segments.append(current_segment)
        
        return {
            "text": transcript.strip(),
            "segments": segments,
            "language": result.get("metadata", {}).get("language", "unknown"),
            "provider": "deepgram",
        }
