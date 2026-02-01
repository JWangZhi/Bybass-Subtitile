"""
Configuration settings.
Supports .env file and environment variables.
"""

from enum import Enum
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class TranscriptionMode(str, Enum):
    LOCAL = "local"
    GROQ = "groq"
    OPENAI = "openai"
    DEEPGRAM = "deepgram"
    AUTO = "auto"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )
    
    # Server
    host: str = "0.0.0.0"
    port: int = 8765
    
    # Mode
    transcription_mode: TranscriptionMode = TranscriptionMode.AUTO
    
    # Local Whisper
    whisper_model_size: str = "small"
    whisper_device: str = "auto"
    
    # Groq API
    groq_api_key: Optional[str] = None
    groq_model: str = "whisper-large-v3"
    groq_translation_model: str = "llama-3.3-70b-versatile"
    
    # OpenAI API
    openai_api_key: Optional[str] = None
    openai_model: str = "whisper-1"
    openai_translation_model: str = "gpt-3.5-turbo"
    
    # Deepgram API (comma-separated keys for rotation)
    deepgram_api_keys: Optional[str] = None
    
    # Performance
    max_audio_duration_seconds: int = 1200  # 20 minutes
    enable_vad: bool = True
    
    # Supabase
    supabase_url: Optional[str] = None
    supabase_key: Optional[str] = None
    supabase_project_name: Optional[str] = None
    supabase_project_id: Optional[str] = None

    # Security
    api_secret: Optional[str] = None  # If set, requires X-API-KEY header
    
    def get_effective_mode(self) -> TranscriptionMode:
        """
        Determine effective mode.
        AUTO prioritizes: Groq > Deepgram > OpenAI > Local.
        """
        if self.transcription_mode != TranscriptionMode.AUTO:
            return self.transcription_mode
        
        if self.groq_api_key: return TranscriptionMode.GROQ
        if self.deepgram_api_keys: return TranscriptionMode.DEEPGRAM
        if self.openai_api_key: return TranscriptionMode.OPENAI
        
        return TranscriptionMode.LOCAL
    
    def get_deepgram_keys_list(self) -> list[str]:
        """Parse comma-separated Deepgram keys into a list."""
        if not self.deepgram_api_keys:
            return []
        return [k.strip() for k in self.deepgram_api_keys.split(",") if k.strip()]


settings = Settings()
