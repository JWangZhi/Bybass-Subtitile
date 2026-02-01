/**
 * Detects videos, captures audio, and displays subtitles with translation.
 */

const CONFIG = {
    BACKEND_WS_URL: 'ws://localhost:8765/ws/transcribe',
    AUDIO_CHUNK_DURATION_MS: 3000, // Matches Groq free tier limit (20 req/min)
    SAMPLE_RATE: 16000, // Whisper requirement
    SUBTITLE_DISPLAY_DURATION_MS: 5000,
};

let isEnabled = false;
let activeVideo = null;
let audioContext = null;
let mediaStreamSource = null;
let audioProcessor = null;
let websocket = null;
let audioChunks = [];
let subtitleOverlay = null;
let sendInterval = null;

// Adaptive chunk sizing
let currentChunkDuration = CONFIG.AUDIO_CHUNK_DURATION_MS;
let lastProcessingTime = 0;
let lagAccumulator = 0;
const MAX_LAG_MS = 5000;

let currentSettings = {
    sourceLang: 'auto',
    targetLang: 'vi',
    showOriginal: true,
    apiMode: 'groq',
    groqApiKey: '',
};

function init() {
    console.log('🎬 Bypass Subtitles: Content script loaded');

    chrome.runtime.onMessage.addListener(handleMessage);
    loadSettings();
    detectVideos();
    observeDOM();
}

async function loadSettings() {
    try {
        const result = await chrome.storage.sync.get({
            sourceLang: 'auto',
            targetLang: 'vi',
            showOriginal: true,
            apiMode: 'groq',
            groqApiKey: '',
        });
        currentSettings = result;
        console.log('⚙️ Loaded settings:', {
            apiMode: result.apiMode,
            hasApiKey: !!result.groqApiKey,
            sourceLang: result.sourceLang,
            targetLang: result.targetLang,
        });
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

function handleMessage(message, sender, sendResponse) {
    console.log('📨 Received message:', message);

    switch (message.action) {
        case 'enable':
            if (message.settings) currentSettings = message.settings;
            enableSubtitles();
            sendResponse({ success: true });
            break;

        case 'disable':
            disableSubtitles();
            sendResponse({ success: true });
            break;

        case 'getStatus':
            const videos = document.querySelectorAll('video');
            const existingSubs = activeVideo ? detectExistingSubtitles(activeVideo) :
                (videos.length > 0 ? detectExistingSubtitles(videos[0]) : []);
            sendResponse({
                isEnabled,
                hasVideo: activeVideo !== null || videos.length > 0,
                isConnected: websocket?.readyState === WebSocket.OPEN,
                existingSubtitles: existingSubs,
                hasExistingSubtitles: existingSubs.length > 0,
                backendUrl: CONFIG.BACKEND_WS_URL,
            });
            break;

        case 'updateSettings':
            if (message.settings) {
                currentSettings = message.settings;
                console.log('⚙️ Settings updated:', currentSettings);
            }
            sendResponse({ success: true });
            break;

        case 'selectVideo':
            selectVideoByIndex(message.index);
            sendResponse({ success: true });
            break;

        case 'redetect':
            console.log('🔄 Re-detecting videos...');
            const detectedVideos = detectVideos();
            sendResponse({
                success: true,
                videoCount: detectedVideos.length,
                hasVideo: detectedVideos.length > 0
            });
            break;

        default:
            sendResponse({ error: 'Unknown action' });
    }

    return true; // Async response
}

function detectVideos() {
    const videos = document.querySelectorAll('video');
    console.log(`🔍 Found ${videos.length} video(s) on page`);

    videos.forEach((video, index) => {
        highlightVideo(video, index);
        const existingSubs = detectExistingSubtitles(video);
        if (existingSubs.length > 0) {
            console.log(`📝 Video ${index} has existing subtitles:`, existingSubs);
        }
    });

    if (videos.length === 1) {
        activeVideo = videos[0];
        console.log('📺 Auto-selected single video');
    }

    return videos;
}

/**
 * Check for existing tracks, YouTube captions, or known player containers.
 */
function detectExistingSubtitles(video) {
    const subtitles = [];

    // HTML5 <track>
    const tracks = video.querySelectorAll('track');
    tracks.forEach((track) => {
        subtitles.push({
            type: 'track',
            kind: track.kind || 'subtitles',
            label: track.label || 'Unknown',
            language: track.srclang || 'unknown',
            src: track.src,
        });
    });

    // video.textTracks API
    if (video.textTracks && video.textTracks.length > 0) {
        for (let i = 0; i < video.textTracks.length; i++) {
            const track = video.textTracks[i];
            const isDuplicate = subtitles.some(s => s.label === track.label && s.language === track.language);
            if (!isDuplicate) {
                subtitles.push({
                    type: 'textTrack',
                    kind: track.kind || 'subtitles',
                    label: track.label || 'Unknown',
                    language: track.language || 'unknown',
                    mode: track.mode,
                });
            }
        }
    }

    // YouTube container
    if (document.querySelector('.ytp-caption-window-container')) {
        subtitles.push({ type: 'youtube', label: 'YouTube Captions', language: 'auto' });
    }

    // Common player containers
    const selectors = [
        '.vjs-text-track-display', '.jw-captions', '.plyr__captions',
        '.mejs-captions-layer', '[class*="subtitle"]', '[class*="caption"]'
    ];

    selectors.forEach((selector) => {
        const container = document.querySelector(selector);
        if (container && container.textContent.trim()) {
            if (!subtitles.some(s => s.type === 'player')) {
                subtitles.push({ type: 'player', label: 'Player Captions', language: 'auto' });
            }
        }
    });

    return subtitles;
}

function highlightVideo(video, index) {
    if (video.dataset.bypassSubtitlesIndex !== undefined) return;

    video.dataset.bypassSubtitlesIndex = index;

    video.addEventListener('mouseenter', () => {
        if (!isEnabled) video.style.outline = '3px solid rgba(99, 102, 241, 0.7)';
    });

    video.addEventListener('mouseleave', () => {
        if (!isEnabled) video.style.outline = '';
    });

    // Ctrl+Click to select
    video.addEventListener('click', (e) => {
        if (!isEnabled && e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            activeVideo = video;
            console.log(`📺 Selected video ${index}`);
            showNotification(`Video ${index + 1} selected`);
        }
    }, true);
}

function observeDOM() {
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeName === 'VIDEO') handleNewVideoDetected(node);
                if (node.querySelectorAll) {
                    node.querySelectorAll('video').forEach(handleNewVideoDetected);
                }
            });

            // Detect source changes (e.g. YouTube next video)
            if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
                const target = mutation.target;
                if (target.nodeName === 'VIDEO' || target.nodeName === 'SOURCE') {
                    const video = target.nodeName === 'VIDEO' ? target : target.closest('video');
                    if (video && video === activeVideo && isEnabled) {
                        console.log('🔄 Video source changed - resetting state');
                        resetTranscriptionState();
                    }
                }
            }
        });
    });

    observer.observe(document.body, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['src']
    });
}

function handleNewVideoDetected(video) {
    const videos = document.querySelectorAll('video');
    const index = Array.from(videos).indexOf(video);
    highlightVideo(video, index);
    console.log('🆕 New video detected');

    if (isEnabled && videos.length === 1) {
        console.log('📺 Auto-switching to new video');
        switchToVideo(video);
    }
}

function switchToVideo(newVideo) {
    stopAudioCapture();
    resetTranscriptionState();

    activeVideo = newVideo;
    setupVideoEventListeners();

    if (isEnabled) {
        startAudioCapture();
        showNotification('Switched to new video');
    }
}

function resetTranscriptionState() {
    audioChunks = [];
    lagAccumulator = 0;
    currentChunkDuration = CONFIG.AUDIO_CHUNK_DURATION_MS;
    if (subtitleOverlay) subtitleOverlay.innerHTML = '';

    // Reset background context for translation consistency
    chrome.runtime.sendMessage({ action: 'resetContext' }).catch(() => { });
    console.log('[State] Transcription state reset');
}

function selectVideoByIndex(index) {
    const videos = document.querySelectorAll('video');
    if (index >= 0 && index < videos.length) {
        activeVideo = videos[index];
        console.log(`📺 Selected video ${index}`);
    }
}

async function enableSubtitles() {
    if (!activeVideo) {
        const videos = detectVideos();
        if (videos.length === 0) {
            showNotification('No video found on this page', 'error');
            return;
        }
        activeVideo = videos[0];
    }

    console.log('🟢 Enabling subtitles...');
    console.log(`📡 Mode: ${currentSettings.apiMode}`);
    isEnabled = true;

    setupVideoEventListeners();

    if (currentSettings.apiMode === 'local') {
        await connectWebSocket();
    } else {
        console.log('⚡ Using Groq API - no WebSocket needed');
    }

    await startAudioCapture();
    createSubtitleOverlay();

    const modeText = currentSettings.apiMode === 'groq' ? 'Groq API' : 'Local Backend';
    showNotification(`Subtitles enabled (${modeText})`);
}

function setupVideoEventListeners() {
    if (!activeVideo) return;

    activeVideo.addEventListener('seeking', () => {
        console.log('⏩ Video seeking - clearing audio buffer');
        audioChunks = [];
        if (subtitleOverlay) subtitleOverlay.innerHTML = '';
    });

    activeVideo.addEventListener('pause', () => console.log('⏸️ Video paused'));
    activeVideo.addEventListener('play', () => console.log('▶️ Video playing'));

    activeVideo.addEventListener('ratechange', () => {
        handlePlaybackRateChange(activeVideo.playbackRate);
    });

    console.log('✅ Video event listeners setup');
}

function handlePlaybackRateChange(rate) {
    console.log(`⚡ Playback rate changed to: ${rate}x`);

    if (rate > 2.0) {
        showNotification('⚠️ Speed too high! Subtitles may not work at >2x', 'warning');
    } else if (rate > 1.5) {
        showNotification(`⚠️ Speed: ${rate}x - Accuracy may be reduced`, 'warning');
    } else if (rate < 0.5) {
        showNotification(`Speed: ${rate}x - Subtitles will be slower`, 'info');
    }
}

function disableSubtitles() {
    console.log('🔴 Disabling subtitles...');
    isEnabled = false;

    stopAudioCapture();

    if (websocket) {
        websocket.close();
        websocket = null;
    }

    if (sendInterval) {
        clearInterval(sendInterval);
        sendInterval = null;
    }

    removeSubtitleOverlay();
    showNotification('Subtitles disabled');
}

async function connectWebSocket() {
    return new Promise((resolve, reject) => {
        console.log('🔌 Connecting to backend...');
        websocket = new WebSocket(CONFIG.BACKEND_WS_URL);

        websocket.onopen = () => {
            console.log('✅ Connected to backend');
            resolve();
        };

        websocket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleTranscription(data);
        };

        websocket.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            showNotification('Failed to connect to backend', 'error');
            reject(error);
        };

        websocket.onclose = () => {
            console.log('🔌 Disconnected from backend');
            if (isEnabled) {
                // Retry in 3s
                setTimeout(() => {
                    if (isEnabled) connectWebSocket();
                }, 3000);
            }
        };
    });
}

/**
 * Uses captureStream() to capture audio without muting video.
 */
async function startAudioCapture() {
    if (!activeVideo) return;
    console.log('🎤 Starting audio capture...');

    try {
        let stream;
        if (activeVideo.captureStream) {
            stream = activeVideo.captureStream();
        } else if (activeVideo.mozCaptureStream) {
            stream = activeVideo.mozCaptureStream();
        }

        if (!stream) {
            console.error('❌ captureStream not supported');
            showNotification('Audio capture not supported in this browser', 'error');
            return;
        }

        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
            console.error('❌ No audio tracks found');
            showNotification('No audio found in video', 'error');
            return;
        }

        audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: CONFIG.SAMPLE_RATE,
        });

        // Don't connect to destination to avoid feedback loop, unless needed for specific browser quirks
        const audioStream = new MediaStream(audioTracks);
        mediaStreamSource = audioContext.createMediaStreamSource(audioStream);

        const bufferSize = 4096;
        audioProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);

        audioProcessor.onaudioprocess = (event) => {
            if (!isEnabled) return;
            const inputData = event.inputBuffer.getChannelData(0);
            const int16Data = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                int16Data[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
            }
            audioChunks.push(int16Data);
        };

        mediaStreamSource.connect(audioProcessor);
        // Required for script processor to run in some browsers
        audioProcessor.connect(audioContext.destination);

        sendInterval = setInterval(() => {
            if (audioChunks.length > 0) {
                if (currentSettings.apiMode === 'groq' || websocket?.readyState === WebSocket.OPEN) {
                    sendAudioChunks();
                }
            }
        }, CONFIG.AUDIO_CHUNK_DURATION_MS);

        console.log('✅ Audio capture started');

    } catch (error) {
        console.error('❌ Failed to start audio capture:', error);
        showNotification('Failed to capture audio. Try refreshing the page.', 'error');
    }
}

function sendAudioChunks() {
    if (audioChunks.length === 0 || !activeVideo) return;

    const videoTime = activeVideo.currentTime;
    const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const mergedData = new Int16Array(totalLength);

    let offset = 0;
    audioChunks.forEach((chunk) => {
        mergedData.set(chunk, offset);
        offset += chunk.length;
    });

    audioChunks = [];
    const base64Audio = arrayBufferToBase64(mergedData.buffer);

    if (currentSettings.apiMode === 'groq') {
        sendToGroqAPI(base64Audio, videoTime);
    } else {
        sendToLocalBackend(base64Audio, videoTime);
    }
}

async function sendToGroqAPI(base64Audio, videoTime) {
    const startTime = Date.now();

    try {
        const chunkAge = Date.now() - (videoTime * 1000);
        if (chunkAge > MAX_LAG_MS) {
            console.warn(`⏭️ Skipping chunk: too far behind (${Math.round(chunkAge / 1000)}s lag)`);
            lagAccumulator = 0;
            return;
        }

        console.log(`📤 Sending to Groq API @ ${formatTime(videoTime)}`);

        const response = await chrome.runtime.sendMessage({
            action: 'transcribe',
            audio: base64Audio,
            apiKey: currentSettings.groqApiKey,
            sourceLang: currentSettings.sourceLang,
            targetLang: currentSettings.targetLang,
            showOriginal: currentSettings.showOriginal,
        });

        // Adaptive sizing
        const processingTime = Date.now() - startTime;
        lastProcessingTime = processingTime;
        adaptChunkSize(processingTime);

        if (response.error) {
            console.error('❌ Groq API error:', response.error);
            return;
        }

        handleTranscription(response);

    } catch (error) {
        console.error('❌ Failed to send to Groq API:', error);
    }
}

function adaptChunkSize(processingTime) {
    const threshold = currentChunkDuration * 0.8;

    if (processingTime > threshold && currentChunkDuration < 6000) {
        currentChunkDuration = Math.min(6000, currentChunkDuration + 500);
        console.warn(`⏱️ Processing slow (${processingTime}ms). Increasing chunk to ${currentChunkDuration}ms`);
        restartSendInterval();
    } else if (processingTime < currentChunkDuration * 0.3 && currentChunkDuration > 2000) {
        currentChunkDuration = Math.max(2000, currentChunkDuration - 500);
        console.log(`⚡ Processing fast (${processingTime}ms). Decreasing chunk to ${currentChunkDuration}ms`);
        restartSendInterval();
    }
}

function restartSendInterval() {
    if (sendInterval) clearInterval(sendInterval);
    sendInterval = setInterval(() => {
        if (audioChunks.length > 0) {
            if (currentSettings.apiMode === 'groq' || websocket?.readyState === WebSocket.OPEN) {
                sendAudioChunks();
            }
        }
    }, currentChunkDuration);
}

function sendToLocalBackend(base64Audio, videoTime) {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
        console.warn('⚠️ WebSocket not connected');
        return;
    }

    websocket.send(JSON.stringify({
        audio: base64Audio,
        sourceLang: currentSettings.sourceLang,
        targetLang: currentSettings.targetLang,
        showOriginal: currentSettings.showOriginal,
        videoTime: videoTime,
    }));
    console.log(`📤 Sent to local backend @ ${formatTime(videoTime)}`);
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function stopAudioCapture() {
    if (audioProcessor) {
        audioProcessor.disconnect();
        audioProcessor = null;
    }
    if (mediaStreamSource) {
        mediaStreamSource.disconnect();
        mediaStreamSource = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    audioChunks = [];
    console.log('🔇 Audio capture stopped');
}

async function handleTranscription(data) {
    if (data.error) {
        console.error('[Transcription] Error:', data.error);
        return;
    }

    const original = data.original || data.text || '';
    const translated = data.translated || '';
    const showOriginal = data.showOriginal !== false && currentSettings.showOriginal;

    if (original.trim() || translated.trim()) {
        console.log(`[Subtitle] Original: ${original}`);
        if (translated) console.log(`[Subtitle] Translated: ${translated}`);

        displaySubtitle(original, translated, showOriginal);

        // Auto-save & Sync
        if (activeVideo && typeof subtitleStore !== 'undefined') {
            try {
                const videoUrl = window.location.href;
                const videoTime = activeVideo.currentTime;
                // Save locally
                await subtitleStore.saveSegment(
                    videoUrl,
                    Math.max(0, videoTime - 3),
                    videoTime,
                    original,
                    currentSettings.sourceLang || 'auto',
                    { [currentSettings.targetLang]: translated },
                    { model: 'whisper-large-v3' }
                );
                console.log('[Cache] Saved');

                // Sync to cloud
                if (typeof dataSyncService !== 'undefined') {
                    dataSyncService.syncSegment(
                        videoUrl, original, translated,
                        currentSettings.sourceLang || 'auto',
                        currentSettings.targetLang
                    );
                }
            } catch (err) {
                console.warn('[Cache] Failed to save/sync:', err);
            }
        }
    }
}

function createSubtitleOverlay() {
    if (subtitleOverlay) return;

    subtitleOverlay = document.createElement('div');
    subtitleOverlay.id = 'bypass-subtitles-overlay';
    subtitleOverlay.className = 'bypass-subtitles-container';

    positionOverlay();
    document.body.appendChild(subtitleOverlay);

    if (activeVideo) {
        new ResizeObserver(() => positionOverlay()).observe(activeVideo);
    }
    window.addEventListener('scroll', positionOverlay);
    console.log('📺 Subtitle overlay created');
}

function positionOverlay() {
    if (!subtitleOverlay || !activeVideo) return;
    const rect = activeVideo.getBoundingClientRect();
    subtitleOverlay.style.position = 'fixed';
    subtitleOverlay.style.left = `${rect.left}px`;
    subtitleOverlay.style.width = `${rect.width}px`;
    subtitleOverlay.style.bottom = `${window.innerHeight - rect.bottom + 40}px`;
}

function displaySubtitle(original, translated, showOriginal) {
    if (!subtitleOverlay) return;

    const subtitleContainer = document.createElement('div');
    subtitleContainer.className = 'bypass-subtitle-wrapper';

    // Translated text (main)
    if (translated) {
        const translatedEl = document.createElement('div');
        translatedEl.className = 'bypass-subtitle-text bypass-subtitle-translated';
        translatedEl.textContent = translated;
        subtitleContainer.appendChild(translatedEl);
    }

    // Original text (above)
    if (showOriginal && original && translated && original !== translated) {
        const originalEl = document.createElement('div');
        originalEl.className = 'bypass-subtitle-text bypass-subtitle-original';
        originalEl.textContent = original;
        subtitleContainer.insertBefore(originalEl, subtitleContainer.firstChild);
    } else if (!translated && original) {
        const originalEl = document.createElement('div');
        originalEl.className = 'bypass-subtitle-text bypass-subtitle-translated';
        originalEl.textContent = original;
        subtitleContainer.appendChild(originalEl);
    }

    subtitleOverlay.innerHTML = '';
    subtitleOverlay.appendChild(subtitleContainer);

    setTimeout(() => {
        subtitleContainer.classList.add('fade-out');
        setTimeout(() => {
            if (subtitleContainer.parentNode === subtitleOverlay) {
                subtitleOverlay.removeChild(subtitleContainer);
            }
        }, 500);
    }, CONFIG.SUBTITLE_DISPLAY_DURATION_MS);
}

function removeSubtitleOverlay() {
    if (subtitleOverlay) {
        subtitleOverlay.remove();
        subtitleOverlay = null;
    }
    window.removeEventListener('scroll', positionOverlay);
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `bypass-notification bypass-notification-${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);
    requestAnimationFrame(() => notification.classList.add('show'));

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
