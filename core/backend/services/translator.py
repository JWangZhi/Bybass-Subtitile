"""
Translation Service - Translate subtitles to target language.

Uses free Google Translate API (unofficial).
"""

from typing import Any

import httpx


class TranslationService:
    """
    Service for translating text between languages.
    
    Uses free Google Translate API by default.
    """
    
    def __init__(self):
        self._client: httpx.AsyncClient | None = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=10.0)
        return self._client
    
    async def translate(
        self,
        text: str,
        target_lang: str,
        source_lang: str = "auto",
    ) -> dict[str, Any]:
        """
        Translate text to target language.
        Prioritizes Groq/OpenAI LLM if available, falls back to Google.
        """
        if not text or not text.strip():
            return {"translated": "", "original": "", "detected_lang": ""}
        
        if not target_lang:
            return {"translated": text, "original": text, "detected_lang": source_lang}
        
        # Try LLM first
        try:
            from config import settings
            if settings.groq_api_key or settings.openai_api_key:
                return await self._translate_llm(text, target_lang, source_lang)
        except Exception as e:
            print(f"⚠️ LLM Translation failed: {e}. Falling back to Google.")
        
        # Fallback to Google
        try:
            result = await self._translate_google(text, target_lang, source_lang)
            return result
        except Exception as e:
            print(f"❌ Translation error: {e}")
            return {
                "translated": text,
                "original": text,
                "detected_lang": source_lang,
                "error": str(e),
            }

    async def _translate_llm(
        self,
        text: str,
        target_lang: str,
        source_lang: str,
    ) -> dict[str, Any]:
        """
        Translate using Groq or OpenAI LLM.
        """
        from config import settings
        
        client = await self._get_client()
        
        if settings.groq_api_key:
            endpoint = "https://api.groq.com/openai/v1/chat/completions"
            api_key = settings.groq_api_key
            model = settings.groq_translation_model
            provider = "groq"
        elif settings.openai_api_key:
            endpoint = "https://api.openai.com/v1/chat/completions"
            api_key = settings.openai_api_key
            model = settings.openai_translation_model
            provider = "openai"
        else:
            raise ValueError("No API key available for LLM translation")
            
        system_prompt = (
            f"You are a professional translator. Translate the following text to {target_lang}. "
            "Maintain the original meaning, tone, and formatting. "
            "Only return the translated text without any explanation, quotes, or markdown."
        )
        
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text}
            ],
            "temperature": 0.3
        }
        
        response = await client.post(
            endpoint,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            json=payload,
            timeout=30.0
        )
        
        response.raise_for_status()
        data = response.json()
        
        translated_text = data["choices"][0]["message"]["content"].strip()
        
        return {
            "translated": translated_text,
            "original": text,
            "detected_lang": source_lang, # LLM doesn't return detected lang easily
            "provider": provider
        }

    async def translate_batch(
        self,
        texts: list[str],
        target_lang: str,
        source_lang: str = "auto",
        batch_size: int = 10, # Reduced size for stability
    ) -> list[str]:
        """
        Translate multiple texts using batched requests.
        Includes retry logic and jitter to avoid rate limits.
        """
        if not texts:
            return []
        
        import asyncio
        import random
        
        results = []
        
        for i in range(0, len(texts), batch_size):
            # Polite delay between batches
            if i > 0:
                await asyncio.sleep(random.uniform(0.5, 1.5))
                
            batch = texts[i:i + batch_size]
            combined_text = "\n\n".join(batch)
            
            # Simple retry loop
            success = False
            for attempt in range(2):
                try:
                    print(f"🌐 Translating batch {i // batch_size + 1} ({len(batch)} segments) [Attempt {attempt+1}]...")
                    res = await self.translate(combined_text, target_lang, source_lang)
                    translated_batch = res.get("translated", combined_text)
                    
                    # Split logic
                    translated_list = translated_batch.split("\n\n")
                    if len(translated_list) != len(batch):
                         translated_list = translated_batch.split("\n")
                         translated_list = [t.strip() for t in translated_list if t.strip()]
                    
                    # Validation
                    if len(translated_list) != len(batch):
                         print(f"⚠️ Batch mismatch. Expected: {len(batch)}, Got: {len(translated_list)}")
                         # Use strict padding if lengths differ
                         if len(translated_list) > len(batch):
                             translated_list = translated_list[:len(batch)]
                         else:
                             translated_list.extend(batch[len(translated_list):])
                    
                    results.extend(translated_list)
                    success = True
                    break
                    
                except Exception as e:
                    print(f"❌ Batch error: {e}")
                    await asyncio.sleep(1 * (attempt + 1))
            
            # Fallback if all attempts fail
            if not success:
                print(f"⛔ Batch failed permanently. Using original text.")
                results.extend(batch)
                
        return results
    
    async def _translate_google(
        self,
        text: str,
        target_lang: str,
        source_lang: str,
    ) -> dict[str, Any]:
        """
        Translate using Google Translate (free, unofficial API).
        Uses POST to avoid URL length limits.
        """
        client = await self._get_client()
        
        # Google Translate API endpoint
        url = "https://translate.googleapis.com/translate_a/single"
        
        params = {
            "client": "gtx",
            "sl": source_lang,  # Source language
            "tl": target_lang,  # Target language
            "dt": "t",  # Return translated text
        }
        
        # Use data for the text content (form-encoded)
        data = {
            "q": text
        }
        
        response = await client.post(url, params=params, data=data)
        response.raise_for_status()
        
        # Parse response
        data = response.json()
        
        # Extract translated text
        translated_parts = []
        if data and len(data) > 0 and data[0]:
            for part in data[0]:
                if part and len(part) > 0:
                    translated_parts.append(part[0])
        
        translated_text = "".join(translated_parts)
        
        # Detect source language
        detected_lang = source_lang
        if len(data) > 2 and data[2]:
            detected_lang = data[2]
        
        return {
            "translated": translated_text,
            "original": text,
            "detected_lang": detected_lang,
        }
    
    async def close(self):
        """Close HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None


# Singleton instance
_translator: TranslationService | None = None


def get_translator() -> TranslationService:
    """Get translator singleton instance."""
    global _translator
    if _translator is None:
        _translator = TranslationService()
    return _translator
