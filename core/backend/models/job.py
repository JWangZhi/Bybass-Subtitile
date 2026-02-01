"""
Video Job Models
Track video processing jobs and their status.
"""

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    PENDING = "pending"
    EXTRACTING = "extracting"
    TRANSCRIBING = "transcribing"
    TRANSLATING = "translating"
    BURNING = "burning"
    DONE = "done"
    ERROR = "error"


class VideoJob(BaseModel):
    """Represents a video processing job."""
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    status: JobStatus = JobStatus.PENDING
    progress: int = 0  # 0-100
    
    # Input
    original_filename: str = ""
    video_path: Optional[str] = None
    
    # Processing options
    source_lang: str = "auto"
    target_lang: str = "vi"
    burn_subtitles: bool = False
    allow_collection: bool = False  # Dynamic Consent Flag
    
    # Output paths
    audio_path: Optional[str] = None
    srt_path: Optional[str] = None
    burned_video_path: Optional[str] = None
    
    # Metadata
    created_at: datetime = Field(default_factory=datetime.now)
    error_message: Optional[str] = None
    
    # Transcription results
    segments: list[dict] = Field(default_factory=list)


# In-memory job storage (for simplicity, can be replaced with Redis/DB later)
_jobs: dict[str, VideoJob] = {}


def create_job(filename: str, source_lang: str = "auto", target_lang: str = "vi", burn: bool = False) -> VideoJob:
    """Create a new video processing job."""
    job = VideoJob(
        original_filename=filename,
        source_lang=source_lang,
        target_lang=target_lang,
        burn_subtitles=burn,
        allow_collection=False,  # Default to False until explicitly enabled
    )
    _jobs[job.id] = job
    return job


def get_job(job_id: str) -> Optional[VideoJob]:
    """Get job by ID."""
    return _jobs.get(job_id)


def update_job(job_id: str, **kwargs) -> Optional[VideoJob]:
    """Update job fields."""
    job = _jobs.get(job_id)
    if job:
        for key, value in kwargs.items():
            if hasattr(job, key):
                setattr(job, key, value)
    return job


def delete_job(job_id: str) -> bool:
    """Delete job and return True if existed."""
    if job_id in _jobs:
        del _jobs[job_id]
        return True
    return False
