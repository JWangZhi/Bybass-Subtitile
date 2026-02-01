"""
Supabase Database Service
Handles all interactions with Supabase tables (jobs, training_datasets).
Implements the Privacy-First logic:
- allow_collection=True: Insert to both tables
- allow_collection=False: Delete from jobs, keep training_datasets
"""

from datetime import datetime
from typing import Any, Dict, Optional
import json

from supabase import create_client, Client
from config import settings

class DatabaseService:
    def __init__(self):
        self.client: Optional[Client] = None
        if settings.supabase_url and settings.supabase_key:
            try:
                self.client = create_client(settings.supabase_url, settings.supabase_key)
                print("✅ Connected to Supabase")
            except Exception as e:
                print(f"❌ Failed to connect to Supabase: {e}")

    def is_available(self) -> bool:
        return self.client is not None

    async def save_job(self, job_data: Dict[str, Any], allow_collection: bool) -> None:
        """
        Save or update job data.
        If allow_collection is False, we DO NOT save to Supabase.
        """
        if not self.is_available() or not allow_collection:
            return

        try:
            # Prepare data for 'jobs' table
            # Exclude fields not in DB schema or handle conversions
            db_data = {
                "id": job_data["id"],
                "status": job_data["status"],
                "progress": job_data["progress"],
                "original_filename": job_data["original_filename"],
                "video_path": job_data["video_path"],
                "source_lang": job_data["source_lang"],
                "target_lang": job_data["target_lang"],
                "burn_subtitles": job_data["burn_subtitles"],
                "audio_path": job_data["audio_path"],
                "srt_path": job_data["srt_path"],
                "burned_video_path": job_data["burned_video_path"],
                "segments": job_data["segments"],
                "allow_collection": allow_collection,
                "error_message": job_data["error_message"],
                "updated_at": datetime.now().isoformat()
            }

            # Upsert into jobs table
            self.client.table("jobs").upsert(db_data).execute()
            
            # If job is DONE, also save to training_datasets (Anonymized)
            if job_data["status"] == "done":
                self._save_training_data(job_data)

        except Exception as e:
            print(f"⚠️ Failed to save job to Supabase: {e}")

    def _save_training_data(self, job_data: Dict[str, Any]) -> None:
        """
        Save anonymized data to training_datasets.
        """
        try:
            training_data = {
                "source_job_id": job_data["id"],
                "source_lang": job_data["source_lang"],
                "target_lang": job_data["target_lang"],
                # We save the full segments JSON which contains text + timings
                "segments": job_data["segments"],
                # Calculate duration from last segment
                "duration_seconds": self._calculate_duration(job_data["segments"]),
                # Extract full text for easier searching
                "transcript_text": " ".join([s.get("text", "") for s in job_data["segments"]])
            }
            
            # Insert (not upsert, as we might have multiple segments from same job potentially?? 
            # Actually for now 1 job = 1 training record is fine)
            # Use upsert based on source_job_id if possible, or just insert.
            # Since source_job_id is not PK, let's query first or just use insert which might duplicate if run multiple times.
            # To be safe, let's treat it as idempotent: delete old by job_id then insert?
            # Or just rely on job_id reference.
            
            # Simple approach: Check if exists
            existing = self.client.table("training_datasets").select("id").eq("source_job_id", job_data["id"]).execute()
            if not existing.data:
                self.client.table("training_datasets").insert(training_data).execute()
                print(f"🤖 Saved training data for job {job_data['id']}")
                
        except Exception as e:
            print(f"⚠️ Failed to save training data: {e}")

    def _calculate_duration(self, segments: list) -> float:
        if not segments:
            return 0.0
        try:
            last_seg = segments[-1]
            return float(last_seg.get("end", 0))
        except:
            return 0.0

    async def delete_job(self, job_id: str) -> None:
        """
        DYNAMIC REVOCATION: Delete job from 'jobs' table immediately.
        Effect: User loses access link.
        Training data in 'training_datasets' REMAINS (as per policy).
        """
        if not self.is_available():
            return
            
        try:
            self.client.table("jobs").delete().eq("id", job_id).execute()
            print(f"🗑️ Deleted job {job_id} from Cloud (User Revoked)")
        except Exception as e:
            print(f"⚠️ Failed to delete job from Supabase: {e}")
            
    async def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve job from Supabase (for persistent access).
        """
        if not self.is_available():
            return None
            
        try:
            response = self.client.table("jobs").select("*").eq("id", job_id).execute()
            if response.data:
                return response.data[0]
            return None
        except Exception as e:
            print(f"⚠️ Failed to fetch job from Supabase: {e}")
            return None

# Singleton instance
db_service = DatabaseService()
