"""
Transcription Merger
Handles merging of overlapping transcription segments.
"""

from typing import Any

class TranscriptionMerger:
    """Utility to merge transcription segments from overlapping chunks."""
    
    @staticmethod
    def merge_segments(all_chunks: list[dict[str, Any]], overlap_seconds: float = 10.0) -> list[dict[str, Any]]:
        """
        Merge segments from multiple chunks.
        all_chunks: List of result dicts from transcribers.
        Each chunk result should have 'segments' and 'text'.
        """
        if not all_chunks:
            return []
            
        merged_segments = []
        global_offset = 0.0
        # Recommended overlap for deduplication logic
        # We usually take the more "complete" version from the middle of the chunk
        
        for i, chunk in enumerate(all_chunks):
            segments = chunk.get("segments", [])
            
            # Simple offset adjustment first
            for seg in segments:
                start = seg.get("start", 0.0) + global_offset
                end = seg.get("end", 0.0) + global_offset
                text = seg.get("text", "").strip()
                
                # Deduplication logic:
                # If this segment starts before the last merged segment ends,
                # it might be an overlap.
                if merged_segments:
                    last_end = merged_segments[-1]["end"]
                    # If this segment is almost entirely within the previous one, skip it
                    if start < last_end - 1.0: # 1s buffer
                        continue
                
                merged_segments.append({
                    "start": start,
                    "end": end,
                    "text": text
                })
            
            # Update global offset for next chunk
            # If chunking was 10m (600s) with 10s overlap, 
            # the next chunk starts at 600s, 1200s, etc.
            # But the transcriber result might have actual duration.
            # We assume a fixed offset based on how we split.
            # However, for 10m chunks, offset is 600 * i
            global_offset += 600.0 # Fixed step based on chunk_duration in _chunk_audio
            
        return merged_segments

    @staticmethod
    def merge_text(all_chunks: list[dict[str, Any]]) -> str:
        """Merge full text from multiple chunks."""
        texts = [c.get("text", "").strip() for c in all_chunks if c.get("text")]
        # Simple join is usually okay for long-form if overlaps are small
        # But for professional SRT, we rely on segments.
        return " ".join(texts)
