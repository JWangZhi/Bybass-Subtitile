"""
Video Processor Service
Handles video upload, audio extraction, and subtitle burning with FFmpeg.
"""

import asyncio
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from models.job import VideoJob, JobStatus, update_job


# Check FFmpeg availability
def _check_ffmpeg() -> bool:
    """Check if FFmpeg is available in PATH."""
    return shutil.which("ffmpeg") is not None


FFMPEG_AVAILABLE = _check_ffmpeg()

# Temp directory for processing
TEMP_DIR = Path(tempfile.gettempdir()) / "bypass_subtitles"
TEMP_DIR.mkdir(exist_ok=True)


class VideoProcessor:
    """Service for processing video files."""
    
    def __init__(self):
        if not FFMPEG_AVAILABLE:
            print("⚠️ FFmpeg not found in PATH. Video processing will be limited.")
    
    async def save_uploaded_file(self, job: VideoJob, file_content: bytes, filename: str) -> str:
        """Save uploaded video file to temp directory."""
        job_dir = TEMP_DIR / job.id
        job_dir.mkdir(exist_ok=True)
        
        video_path = job_dir / filename
        video_path.write_bytes(file_content)
        
        update_job(job.id, video_path=str(video_path))
        return str(video_path)
    
    async def extract_audio(self, job: VideoJob) -> str:
        """Extract audio from video as WAV (16kHz mono for Whisper)."""
        if not job.video_path:
            raise ValueError("No video path set")
        
        update_job(job.id, status=JobStatus.EXTRACTING, progress=10)
        
        job_dir = TEMP_DIR / job.id
        audio_path = job_dir / "audio.wav"
        
        # FFmpeg command: extract audio, convert to 16kHz mono WAV
        cmd = [
            "ffmpeg", "-y",
            "-i", job.video_path,
            "-vn",  # No video
            "-acodec", "pcm_s16le",  # 16-bit PCM
            "-ar", "16000",  # 16kHz sample rate
            "-ac", "1",  # Mono
            str(audio_path)
        ]
        
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await process.communicate()
        
        if process.returncode != 0:
            error_msg = stderr.decode() if stderr else "Unknown FFmpeg error"
            update_job(job.id, status=JobStatus.ERROR, error_message=error_msg)
            raise RuntimeError(f"FFmpeg failed: {error_msg}")
        
        update_job(job.id, audio_path=str(audio_path), progress=20)
        return str(audio_path)
    
    async def generate_srt(self, job: VideoJob, segments: list[dict]) -> str:
        """Generate SRT file from transcription segments."""
        job_dir = TEMP_DIR / job.id
        srt_path = job_dir / "subtitles.srt"
        
        srt_content = []
        for i, seg in enumerate(segments, 1):
            start = self._seconds_to_srt_time(seg.get("start", 0))
            end = self._seconds_to_srt_time(seg.get("end", 0))
            text = seg.get("translated", seg.get("text", ""))
            
            srt_content.append(f"{i}")
            srt_content.append(f"{start} --> {end}")
            srt_content.append(text)
            srt_content.append("")
        
        srt_path.write_text("\n".join(srt_content), encoding="utf-8")
        update_job(job.id, srt_path=str(srt_path), segments=segments)
        return str(srt_path)
    
    async def burn_subtitles(self, job: VideoJob) -> str:
        """Burn SRT subtitles into video using FFmpeg."""
        if not job.video_path or not job.srt_path:
            raise ValueError("Video or SRT path not set")
        
        update_job(job.id, status=JobStatus.BURNING, progress=80)
        
        job_dir = TEMP_DIR / job.id
        output_path = job_dir / f"output_{Path(job.original_filename).stem}_subtitled.mp4"
        
        # FFmpeg command: burn subtitles
        # Note: Need to escape special chars in path for subtitles filter
        srt_escaped = job.srt_path.replace(":", r"\:").replace("\\", "/")
        
        cmd = [
            "ffmpeg", "-y",
            "-i", job.video_path,
            "-vf", f"subtitles='{srt_escaped}'",
            "-c:a", "copy",  # Copy audio stream
            str(output_path)
        ]
        
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await process.communicate()
        
        if process.returncode != 0:
            error_msg = stderr.decode() if stderr else "Unknown FFmpeg error"
            update_job(job.id, status=JobStatus.ERROR, error_message=error_msg)
            raise RuntimeError(f"FFmpeg burn failed: {error_msg}")
        
        update_job(job.id, burned_video_path=str(output_path), progress=95)
        return str(output_path)
    
    def _seconds_to_srt_time(self, seconds: float) -> str:
        """Convert seconds to SRT timestamp format (HH:MM:SS,mmm)."""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int((seconds % 1) * 1000)
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
    
    async def cleanup_job(self, job_id: str) -> None:
        """Clean up temp files for a job."""
        job_dir = TEMP_DIR / job_id
        if job_dir.exists():
            shutil.rmtree(job_dir)


# Singleton
_processor: VideoProcessor | None = None


def get_video_processor() -> VideoProcessor:
    """Get video processor singleton."""
    global _processor
    if _processor is None:
        _processor = VideoProcessor()
    return _processor
