"""
FastAPI Server
WebSocket endpoint for real-time audio transcription and translation.
REST endpoints for video upload and processing.
"""

import asyncio
import base64
import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, Optional
import random

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, BackgroundTasks, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from config import settings
from models.job import VideoJob, JobStatus, create_job, get_job, update_job
from services.transcriber_factory import TranscriberFactory
from services.translator import get_translator
from services.transcriber_factory import TranscriberFactory
from services.translator import get_translator
from services.video_processor import get_video_processor
from services.db import db_service
from fastapi.security import APIKeyHeader
from fastapi import Security

# Security Scheme
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

async def verify_api_key(api_key: str = Security(api_key_header)):
    """Validate API Key if enforcing security."""
    if settings.api_secret:
        if not api_key or api_key != settings.api_secret:
            raise HTTPException(
                status_code=403,
                detail="Could not validate credentials"
            )
    return api_key

transcriber: Any = None

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Initialize resources on startup, cleanup on shutdown."""
    global transcriber
    
    print(f"🚀 Starting Backend (mode: {settings.get_effective_mode().value})...")
    transcriber = await TranscriberFactory.create()
    print("✅ Backend ready!")
    
    yield
    
    await get_translator().close()
    print("👋 Shutting down...")


app = FastAPI(
    title="Bypass Subtitles API",
    version="0.2.0",
    lifespan=lifespan,
)

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, job_id: str):
        await websocket.accept()
        if job_id not in self.active_connections:
            self.active_connections[job_id] = []
        self.active_connections[job_id].append(websocket)

    def disconnect(self, websocket: WebSocket, job_id: str):
        if job_id in self.active_connections:
            self.active_connections[job_id].remove(websocket)
            if not self.active_connections[job_id]:
                del self.active_connections[job_id]

    async def broadcast_status(self, job_id: str, status: Dict[str, Any]):
        if job_id in self.active_connections:
            # Create a clean version for WebSocket (no internal paths)
            # Send full status
            clean_status = status
            for connection in self.active_connections[job_id]:
                try:
                    await connection.send_json(clean_status)
                except Exception:
                    # Connection might be closed
                    pass

manager = ConnectionManager()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://sub.qilabs.xyz",
        "https://www.sub.qilabs.xyz",
        # "http://localhost:3000",
        # "http://127.0.0.1:3000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """
    Global exception handler.
    """
    import traceback
    error_id = id(exc)
    print(f"🔥 Internal Error ({error_id}): {str(exc)}")
    # traceback.print_exc()

    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "ref": error_id},
    )








@app.get("/health")
async def health_check() -> dict:
    return {
        "status": "healthy",
        "service": "BypassSubtitles Core",
        # Hide internal state details
    }


@app.get("/config")
async def get_config() -> dict:
    """
    Reveal public configuration and key status.
    """
    return {
        "mode": "auto",
        "version": app.version,
        "keys": {
            "openai": bool(settings.openai_api_key),
            "groq": bool(settings.groq_api_key),
            "deepgram": bool(settings.deepgram_api_key),
            "supabase": bool(settings.supabase_url and settings.supabase_key),
        }
    }


@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket) -> None:
    """
    Real-time transcription.
    Expects JSON: {"audio": "<base64>", "sourceLang": "auto", "targetLang": "vi"}
    """
    await websocket.accept()
    client_id = id(websocket)
    print(f"🔌 Client {client_id} connected")
    
    translator = get_translator()
    
    try:
        while True:
            message = await websocket.receive()
            
            audio_data: bytes
            source_lang: str = "auto"
            target_lang: str = ""
            show_original: bool = True
            
            if "bytes" in message:
                audio_data = message["bytes"]
            elif "text" in message:
                try:
                    data = json.loads(message["text"])
                    audio_data = base64.b64decode(data.get("audio", ""))
                    source_lang = data.get("sourceLang", "auto")
                    target_lang = data.get("targetLang", "")
                    show_original = data.get("showOriginal", True)
                except (json.JSONDecodeError, KeyError) as e:
                    await websocket.send_json({"error": f"Invalid message format: {e}"})
                    continue
            else:
                continue
            
            if not audio_data:
                continue
            
            if transcriber is None or not transcriber.is_ready:
                await websocket.send_json({"error": "Transcriber not ready", "text": ""})
                continue
            
            # Transcribe
            result = await transcriber.transcribe(audio_data)
            
            if result.get("error"):
                await websocket.send_json(result)
                continue
            
            original_text = result.get("text", "")
            
            # Translate
            if target_lang and original_text:
                detected_lang = result.get("language", source_lang)
                
                if detected_lang != target_lang:
                    translation = await translator.translate(
                        text=original_text,
                        target_lang=target_lang,
                        source_lang=detected_lang if detected_lang != "auto" else "auto",
                    )
                    result["translated"] = translation.get("translated", "")
                    result["original"] = original_text
                else:
                    result["translated"] = original_text
                    result["original"] = original_text
            else:
                result["translated"] = ""
                result["original"] = original_text
            
            result["showOriginal"] = show_original

            
            # Sanitize before sending
            # Send full result
            clean_result = result
            await websocket.send_json(clean_result)
            
            if original_text:
                log_text = result.get("translated") or original_text
                print(f"📤 [{result.get('provider', 'local')}] {log_text[:80]}...")
            
    except WebSocketDisconnect:
        print(f"🔌 Client {client_id} disconnected")
    except Exception as e:
        error_msg = str(e)
        if "disconnect" not in error_msg.lower():
            print(f"❌ Error with client {client_id}: {e}")
        try:
            await websocket.close(code=1011, reason=str(e))
        except Exception:
            pass


# ============================================================================
# VIDEO UPLOAD API
# ============================================================================

@app.websocket("/api/video/ws/{job_id}")
async def websocket_job_status(websocket: WebSocket, job_id: str) -> None:
    """WebSocket endpoint for real-time job status updates."""
    await manager.connect(websocket, job_id)
    try:
        # Send initial status immediately
        job = get_job(job_id)
        if job:
            await manager.broadcast_status(job_id, job.model_dump())
        else:
            await websocket.send_json({"error": "Job not found", "status": "error"})
            
        while True:
            # Just keep the connection alive, we primarily push
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, job_id)
    except Exception:
        manager.disconnect(websocket, job_id)

async def update_job_and_broadcast(job_id: str, **kwargs) -> None:
    """Update job and broadcast via WebSocket."""
    update_job(job_id, **kwargs)
    job = get_job(job_id)
    if job:
        await manager.broadcast_status(job_id, job.model_dump())

async def process_video_job(job_id: str) -> None:
    """Background task to process uploaded video."""
    job = get_job(job_id)
    if not job:
        return
    
    processor = get_video_processor()
    translator = get_translator()
    
    try:
        # 1. Extract audio
        audio_path = await processor.extract_audio(job)
        
        # 2. Transcribe
        await update_job_and_broadcast(job_id, status=JobStatus.TRANSCRIBING, progress=30)
        # Sync to DB
        await db_service.save_job(job.model_dump(), job.allow_collection)
        
        if transcriber is None or not transcriber.is_ready:
            raise RuntimeError("Transcriber not ready")
        
        # Pass audio path directly to save memory
        
        async def transcription_progress(current: int, total: int):
            # Map chunk progress (1 to total) to 30%-50% range
            progress = 30 + int((current / total) * 20)
            await update_job_and_broadcast(job_id, progress=progress)
            
        result = await transcriber.transcribe(audio_path, progress_callback=transcription_progress)
        
        if result.get("error"):
            raise RuntimeError(result["error"])
        
        segments = result.get("segments", [])
        detected_lang = result.get("language", job.source_lang)
        
        print(f"🌍 Language Logic: Source={job.source_lang}, Detected={detected_lang}, Target={job.target_lang}")
        
        await update_job_and_broadcast(job_id, progress=50)
        
        # 3. Translate segments
        if job.target_lang and detected_lang != job.target_lang:
            await update_job_and_broadcast(job_id, status=JobStatus.TRANSLATING, progress=55)
            
            texts_to_translate = [seg.get("text", "") for seg in segments]
            
            translated_texts = await translator.translate_batch(
                texts=texts_to_translate,
                target_lang=job.target_lang,
                source_lang=detected_lang if detected_lang != "auto" else "auto"
            )
            
            for i, (seg, translated_text) in enumerate(zip(segments, translated_texts)):
                seg["translated"] = translated_text
                # Update progress periodically
                if i % 20 == 0:
                    progress = 55 + int((i / max(len(segments), 1)) * 20)
                    await update_job_and_broadcast(job_id, progress=progress)
            
            print(f"✨ Translated {len(segments)} segments to {job.target_lang}")
        else:
            print(f"⏭️ Skipping translation: Detected language matches target ({detected_lang})")
            for seg in segments:
                seg["translated"] = seg.get("text", "")
        
        await update_job_and_broadcast(job_id, progress=75)
        
        # 4. Generate SRT
        await processor.generate_srt(job, segments)
        
        # 5. Burn subtitles if requested
        job = get_job(job_id)  # Refresh job
        if job and job.burn_subtitles:
            await processor.burn_subtitles(job)
        
        # Done!
        await update_job_and_broadcast(job_id, status=JobStatus.DONE, progress=100)
        # Final Sync to DB (will also save to training_datasets if done)
        await db_service.save_job(job.model_dump(), job.allow_collection)
        print(f"✅ Job {job_id} completed successfully")
        
    except Exception as e:
        # Log real error but hide it in job status
        print(f"❌ Job {job_id} failed: {e}")
        await update_job_and_broadcast(job_id, status=JobStatus.ERROR, error_message=str(e))


@app.post("/api/video/upload")
async def upload_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    source_lang: str = Form("auto"),
    target_lang: str = Form("vi"),
    burn: bool = Form(False),
    allow_collection: bool = Form(False),
    _auth: str = Security(verify_api_key),
) -> dict:
    """
    Upload a video file for transcription and translation.
    Returns job_id to track progress.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded")
    
    # Validate file type
    allowed_extensions = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v"}
    ext = Path(file.filename).suffix.lower()
    if ext not in allowed_extensions:
        raise HTTPException(status_code=400, detail=f"Invalid file type. Allowed: {allowed_extensions}")
    
    # Create job
    job = create_job(
        filename=file.filename,
        source_lang=source_lang,
        target_lang=target_lang,
        burn=burn,
    )
    job.allow_collection = allow_collection
    
    # Save initial state to DB (if allowed)
    await db_service.save_job(job.model_dump(), allow_collection)
    
    # Save file
    processor = get_video_processor()
    file_content = await file.read()
    await processor.save_uploaded_file(job, file_content, file.filename)
    
    # Start background processing
    background_tasks.add_task(process_video_job, job.id)
    
    print(f"📥 Received video: {file.filename} (job: {job.id})")
    
    return {
        "job_id": job.id,
        "status": job.status.value,
        "message": "Video uploaded, processing started",
    }


@app.get("/api/video/status/{job_id}")
async def get_video_status(job_id: str) -> dict:
    """Get processing status for a video job."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return {
        "has_srt": job.srt_path is not None,
        "has_burned_video": job.burned_video_path is not None,
        "allow_collection": job.allow_collection,
    }


@app.patch("/api/video/job/{job_id}")
async def update_job_consent(job_id: str, request: Request) -> dict:
    """
    DYNAMIC REVOCATION: Update data collection consent.
    - allow_collection=True: (Re)-enable saving to Cloud.
    - allow_collection=False: IMMEDIATELY DELETE from Cloud (Hard Delete).
    """
    job = get_job(job_id)
    if not job:
        # Try to fetch from DB if not in memory (restored session)
        db_job = await db_service.get_job(job_id)
        if not db_job:
            raise HTTPException(status_code=404, detail="Job not found")
        # Restore to memory (simplified)
        # In real app, we might just use DB as source of truth
        return {"status": "restored", "message": "Job found in DB"}

    try:
        data = await request.json()
        allow = data.get("allow_collection")
        
        if allow is None:
            raise HTTPException(status_code=400, detail="Missing allow_collection field")
            
        # Update local state
        job.allow_collection = allow
        
        if allow:
            # Sync current state to DB
            await db_service.save_job(job.model_dump(), True)
            msg = "Data collection enabled. Job saved to Cloud."
        else:
            # REVOKE: Delete from DB immediately
            await db_service.delete_job(job_id)
            msg = "Data collection disabled. Job deleted from Cloud."
            
        return {"job_id": job_id, "allow_collection": allow, "message": msg}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/video/download/{job_id}")
async def download_video_result(job_id: str, burned: bool = False) -> FileResponse:
    """
    Download result for a completed job.
    - burned=false: Download SRT file
    - burned=true: Download video with burned-in subtitles
    """
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if job.status != JobStatus.DONE:
        raise HTTPException(status_code=400, detail=f"Job not complete. Status: {job.status.value}")
    
    if burned:
        if not job.burned_video_path or not Path(job.burned_video_path).exists():
            raise HTTPException(status_code=404, detail="Burned video not available")
        return FileResponse(
            job.burned_video_path,
            filename=Path(job.burned_video_path).name,
            media_type="video/mp4",
        )
    else:
        if not job.srt_path or not Path(job.srt_path).exists():
            raise HTTPException(status_code=404, detail="SRT file not available")
        return FileResponse(
            job.srt_path,
            filename=f"{Path(job.original_filename).stem}.srt",
            media_type="text/plain",
        )

@app.post("/api/proxy/process")
async def proxy_process(
    file: UploadFile = File(...),
    source_lang: str = Form("auto"),
    target_lang: str = Form(""),
    context: str = Form("[]"),  # JSON string of previous context
    show_original: bool = Form(True),
    _auth: str = Security(verify_api_key),
) -> dict:
    """
    STEALTH MODE: Proxy endpoint for Extension.
    Client sends audio -> Server transcribes (Rotation) -> Server translates -> Client receives text.
    Keys are kept secure on server.
    """
    if not transcriber:
        raise HTTPException(status_code=503, detail="Server initializing")
        
    try:
        # 1. Transcribe (with Rotation)
        audio_data = await file.read()
        result = await transcriber.transcribe(audio_data)
        
        if result.get("error"):
            raise HTTPException(status_code=500, detail=result["error"])
            
        original_text = result.get("text", "")
        
        # 2. Translate (if needed)
        # We need to parse context from client
        try:
             client_context = json.loads(context)
        except:
             client_context = []
             
        translated_text = ""
        
        if target_lang and original_text:
            detected_lang = result.get("language", source_lang)
            
            # Use server-side translator (Groq/OpenAI)
            translator = get_translator()
            
            # We might want to pass context to translator if supported
            # consistently. For now, basic translation.
            # TODO: Add context support to Translator service for better results.
            
            if detected_lang != target_lang:
                translation = await translator.translate(
                    text=original_text,
                    target_lang=target_lang,
                    source_lang=detected_lang if detected_lang != "auto" else "auto",
                )
                translated_text = translation.get("translated", "")
            else:
                translated_text = original_text
        
        # 3. Return sanitized result
        return {
            "text": original_text,
            "original": original_text,
            "translated": translated_text or original_text,
            "showOriginal": show_original,
            "provider": result.get("provider", "unknown")
        }

    except Exception as e:
        print(f"❌ Proxy Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=True, log_level="info")

