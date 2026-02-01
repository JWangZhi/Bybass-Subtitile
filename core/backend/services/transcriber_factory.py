"""
Transcriber Factory
Creates appropriate transcriber (Local, Groq, or OpenAI) based on config.
"""

from typing import Any, Protocol, Union
from config import TranscriptionMode, settings


class Transcriber(Protocol):
    is_ready: bool
    async def initialize(self) -> None: ...
    async def transcribe(self, audio_input: Union[bytes, str], progress_callback: Any = None) -> dict[str, Any]: ...


class TranscriberFactory:
    _instance: Transcriber | None = None
    _mode: TranscriptionMode | None = None
    
    @classmethod
    async def create(cls) -> Transcriber:
        mode = settings.get_effective_mode()
        
        if cls._instance is not None and cls._mode == mode:
            return cls._instance
        
        print(f"Creating transcriber with mode: {mode.value}")
        
        # If in AUTO mode and we have both keys, use Rotation
        if mode == TranscriptionMode.AUTO or (mode == TranscriptionMode.GROQ and settings.deepgram_api_keys):
             # Try to create both
             groq = await cls._create_groq()
             deepgram = await cls._create_deepgram()
             
             if groq.is_ready and deepgram.is_ready:
                 print("✨ Enabling Rotation Mode: Groq (Primary) -> Deepgram (Fallback)")
                 cls._instance = RotationTranscriberWrapper(primary=groq, secondary=deepgram)
             elif groq.is_ready:
                 cls._instance = groq
             elif deepgram.is_ready:
                 cls._instance = deepgram
             else:
                 cls._instance = await cls._create_local()
                 
        elif mode == TranscriptionMode.GROQ:
            cls._instance = await cls._create_groq()
        elif mode == TranscriptionMode.DEEPGRAM:
            cls._instance = await cls._create_deepgram()
        elif mode == TranscriptionMode.OPENAI:
            cls._instance = await cls._create_openai()
        else:
            cls._instance = await cls._create_local()
        
        cls._mode = mode
        return cls._instance
    
    @classmethod
    async def _create_local(cls) -> Transcriber:
        from services.transcriber import TranscriberService
        transcriber = TranscriberService(
            model_size=settings.whisper_model_size,
            device=settings.whisper_device,
        )
        await transcriber.initialize()
        return transcriber
    
    @classmethod
    async def _create_groq(cls) -> Transcriber:
        if not settings.groq_api_key:
            print("⚠️ GROQ_API_KEY not set, falling back to local")
            return await cls._create_local()
        
        transcriber = GroqTranscriberWrapper(settings.groq_api_key, settings.groq_model)
        await transcriber.initialize()
        return transcriber
    
    @classmethod
    async def _create_openai(cls) -> Transcriber:
        if not settings.openai_api_key:
            print("OPENAI_API_KEY not set, falling back to local")
            return await cls._create_local()
        
        transcriber = OpenAITranscriberWrapper(settings.openai_api_key, settings.openai_model)
        await transcriber.initialize()
        return transcriber
    
    @classmethod
    async def _create_deepgram(cls) -> Transcriber:
        keys = settings.get_deepgram_keys_list()
        if not keys:
            print("DEEPGRAM_API_KEYS not set, falling back to local")
            return await cls._create_local()
        
        transcriber = DeepgramTranscriberWrapper(keys)
        await transcriber.initialize()
        return transcriber


class GroqTranscriberWrapper:
    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model
        self._transcriber = None
        self.is_ready = False
    
    async def initialize(self) -> None:
        from services.cloud_transcriber import GroqTranscriber
        self._transcriber = GroqTranscriber(api_key=self.api_key, model=self.model)
        self.is_ready = await self._transcriber.is_available()
        print("Groq transcriber ready" if self.is_ready else "Groq transcriber not available")
    
    async def transcribe(self, audio_input: Union[bytes, str], progress_callback: Any = None) -> dict[str, Any]:
        if not self._transcriber: return {"error": "Not initialized", "text": ""}
        return await self._transcriber.transcribe(audio_input, progress_callback=progress_callback)


class OpenAITranscriberWrapper:
    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model
        self._transcriber = None
        self.is_ready = False
    
    async def initialize(self) -> None:
        from services.cloud_transcriber import OpenAITranscriber
        self._transcriber = OpenAITranscriber(api_key=self.api_key, model=self.model)
        self.is_ready = await self._transcriber.is_available()
        print("OpenAI transcriber ready" if self.is_ready else "OpenAI transcriber not available")
    
    async def transcribe(self, audio_input: Union[bytes, str], progress_callback: Any = None) -> dict[str, Any]:
        if not self._transcriber: return {"error": "Not initialized", "text": ""}
        return await self._transcriber.transcribe(audio_input, progress_callback=progress_callback)


class DeepgramTranscriberWrapper:
    def __init__(self, api_keys: list[str]):
        self.api_keys = api_keys
        self._transcriber = None
        self.is_ready = False
    
    async def initialize(self) -> None:
        from services.cloud_transcriber import DeepgramTranscriber, KeyPool
        key_pool = KeyPool(self.api_keys)
        self._transcriber = DeepgramTranscriber(key_pool=key_pool)
        self.is_ready = await self._transcriber.is_available()
        print(f"Deepgram transcriber ready ({len(self.api_keys)} keys)" if self.is_ready else "Deepgram transcriber not available")
    
    async def transcribe(self, audio_input: Union[bytes, str], progress_callback: Any = None) -> dict[str, Any]:
        if not self._transcriber: return {"error": "Not initialized", "text": ""}
        return await self._transcriber.transcribe(audio_input, progress_callback=progress_callback)

class RotationTranscriberWrapper:
    """
    Tries primary transcriber, falls back to secondary if it fails.
    """
    def __init__(self, primary: Transcriber, secondary: Transcriber):
        self.primary = primary
        self.secondary = secondary
        self.is_ready = True
    
    async def initialize(self) -> None:
        pass # Already initialized
    
    async def transcribe(self, audio_input: Union[bytes, str], progress_callback: Any = None) -> dict[str, Any]:
        try:
            # Try Primary (Groq)
            res = await self.primary.transcribe(audio_input, progress_callback=progress_callback)
            if res.get("error"):
                raise RuntimeError(res["error"])
            res["provider"] = "groq"
            return res
            
        except Exception as e:
            print(f"⚠️ Primary Transcriber Failed: {e}. Switching to Secondary...")
            try:
                # Try Secondary (Deepgram)
                res = await self.secondary.transcribe(audio_input, progress_callback=progress_callback)
                res["provider"] = "deepgram"
                return res
            except Exception as e2:
                print(f"❌ Secondary Transcriber also failed: {e2}")
                return {"error": f"All providers failed: {e} | {e2}", "text": ""}
