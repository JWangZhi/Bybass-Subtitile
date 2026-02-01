import pytest
import asyncio
from unittest.mock import MagicMock, patch
from services.transcriber import TranscriberService

@pytest.fixture
def mock_faster_whisper():
    with patch("faster_whisper.WhisperModel") as mock_class:
        mock_instance = MagicMock()
        mock_class.return_value = mock_instance
        yield mock_class, mock_instance

@pytest.mark.asyncio
async def test_transcriber_initialization_cpu(mock_faster_whisper):
    mock_class, mock_instance = mock_faster_whisper
    
    service = TranscriberService(device="cpu")
    await service.initialize()
    
    assert service.is_ready is True
    assert service.device == "cpu"
    mock_class.assert_called_with("small", device="cpu", compute_type="int8")

@pytest.mark.asyncio
async def test_transcriber_transcribe_success(mock_faster_whisper):
    _, mock_instance = mock_faster_whisper
    
    # Mock transcribe result
    mock_segment = MagicMock()
    mock_segment.start = 0.0
    mock_segment.end = 1.0
    mock_segment.text = "Hello world"
    
    mock_info = MagicMock()
    mock_info.language = "en"
    mock_info.language_probability = 0.99
    
    mock_instance.transcribe.return_value = ([mock_segment], mock_info)
    
    service = TranscriberService(device="cpu")
    await service.initialize()
    
    # Dummy audio data (needs to be valid byte structure for numpy)
    dummy_audio = bytes([0] * 32000) # 1 sec of silence at 16kHz 16-bit
    
    result = await service.transcribe(dummy_audio)
    
    assert result["text"] == "Hello world"
    assert result["language"] == "en"
    assert result["provider"] == "local"
