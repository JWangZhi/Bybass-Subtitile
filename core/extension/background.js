import config from './config.js';

let extensionEnabled = false;

// Configuration is now loaded from config.js
console.log('🔧 Configuration loaded:', config.backendUrl);

// Context history (kept on client, sent to server)
let translationContext = [];
const MAX_CONTEXT_SIZE = 3;

chrome.action.onClicked.addListener(async (tab) => {
    extensionEnabled = !extensionEnabled;

    try {
        await chrome.tabs.sendMessage(tab.id, {
            action: extensionEnabled ? 'enable' : 'disable',
        });
        updateBadge(tab.id, extensionEnabled);
    } catch (error) {
        console.error('Failed to communicate with content script:', error);
    }
});

function updateBadge(tabId, enabled) {
    chrome.action.setBadgeText({ tabId, text: enabled ? 'ON' : '' });
    chrome.action.setBadgeBackgroundColor({
        tabId, color: enabled ? '#10B981' : '#6B7280'
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Background received:', message.action);

    switch (message.action) {
        case 'getGlobalState':
            sendResponse({ extensionEnabled });
            break;

        case 'setGlobalState':
            extensionEnabled = message.enabled;
            sendResponse({ success: true });
            break;

        case 'transcribe':
            if (message.apiMode === 'trial') {
                handleBackendProcessing(message)
                    .then(sendResponse)
                    .catch(error => sendResponse({ error: error.message }));
            } else {
                handleDirectProcessing(message)
                    .then(sendResponse)
                    .catch(error => sendResponse({ error: error.message }));
            }
            return true; // Keep channel open

        case 'resetContext':
            translationContext = [];
            sendResponse({ success: true });
            break;

        default:
            sendResponse({ error: 'Unknown action' });
    }

    return true;
});

async function handleBackendProcessing(message) {
    const { audio, sourceLang, targetLang, showOriginal } = message;

    try {
        console.log('🚀 Sending audio to Backend Proxy...');

        if (!config.apiSecret || !config.backendUrl) {
            throw new Error("Miss match credentials");
        }

        const proxyEndpoint = `${config.backendUrl.replace(/\/+$/, '')}/api/proxy/process`;

        const audioBlob = base64ToBlob(audio, 'audio/wav');

        const formData = new FormData();
        formData.append('file', audioBlob, 'audio.wav');
        formData.append('source_lang', sourceLang || 'auto');
        formData.append('target_lang', targetLang || '');
        formData.append('show_original', String(showOriginal));
        formData.append('context', JSON.stringify(translationContext));

        const response = await fetch(proxyEndpoint, {
            method: 'POST',
            headers: {
                'X-API-Key': config.apiSecret
            },
            body: formData,
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `Backend Error ${response.status}`);
        }

        const result = await response.json();
        console.log(`✅ Backend Response (${result.provider}):`, result.text.substring(0, 30) + '...');

        // Update context
        if (result.original && result.translated) {
            translationContext.push({
                original: result.original,
                translated: result.translated
            });
            if (translationContext.length > MAX_CONTEXT_SIZE) translationContext.shift();
        }

        return result;

    } catch (error) {
        console.error('❌ Backend Processing Failed:', error);
        throw error;
    }
}

async function handleDirectProcessing(message) {
    const { audio, sourceLang, targetLang, apiMode, groqApiKey } = message;

    try {
        console.log(`🚀 Direct Processing (${apiMode})...`);

        if (!groqApiKey) {
            throw new Error(`API Key for ${apiMode} is missing!`);
        }

        const audioBlob = base64ToBlob(audio, 'audio/wav');
        const formData = new FormData();
        formData.append('file', audioBlob, 'audio.wav');
        formData.append('model', apiMode === 'groq' ? 'whisper-large-v3' : 'whisper-1');
        if (sourceLang && sourceLang !== 'auto') {
            formData.append('language', sourceLang);
        }

        const endpoint = apiMode === 'groq'
            ? 'https://api.groq.com/openai/v1/audio/transcriptions'
            : 'https://api.openai.com/v1/audio/transcriptions';

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${groqApiKey}`
            },
            body: formData,
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `API Error ${response.status}`);
        }

        const result = await response.json();
        let text = result.text;
        let original = text;
        let translated = '';

        // Handle Translation (via LLM)
        if (targetLang) {
            translated = await translateText(text, targetLang, groqApiKey, apiMode, translationContext);
        }

        const responseMsg = {
            text: translated || original,
            original: original,
            translated: translated,
            provider: apiMode
        };

        // Update context
        if (original && translated) {
            translationContext.push({
                original: original,
                translated: translated
            });
            if (translationContext.length > MAX_CONTEXT_SIZE) translationContext.shift();
        }

        return responseMsg;

    } catch (error) {
        console.error(`❌ Direct ${apiMode} Failed:`, error);
        throw error;
    }
}

async function translateText(text, targetLang, apiKey, mode, context = []) {
    // For simplicity, we use the backend's dedicated translate endpoint if available,
    // or we can use another LLM call. Let's use the backend/api/video/translate (if exists)
    // Actually, let's just use the backend proxy for translation too if we want to keep it simple,
    // but the goal was to avoid the server.
    // Let's do a simple Chat Completion call for translation if mode is groq/openai.

    console.log(`🌐 Translating to ${targetLang} via LLM...`);

    let contextStr = context.map(c => `Original: ${c.original}\nTranslation: ${c.translated}`).join('\n\n');
    let systemPrompt = `Translate the following text to ${targetLang}. Only return the translation, no extra text.`;
    if (contextStr) {
        systemPrompt += `\n\nPrevious context for consistency:\n${contextStr}`;
    }

    const endpoint = mode === 'groq'
        ? 'https://api.groq.com/openai/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';

    const model = mode === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-3.5-turbo';

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: 'system', content: `Translate the following text to ${targetLang}. Only return the translation, no extra text.` },
                { role: 'user', content: text }
            ],
            temperature: 0
        })
    });

    if (!response.ok) return '';

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
}

function base64ToBlob(base64, mimeType) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    const pcmData = new Int16Array(bytes.buffer);
    const wavBuffer = createWavFile(pcmData, 16000);

    return new Blob([wavBuffer], { type: mimeType });
}

function createWavFile(pcmData, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmData.length * (bitsPerSample / 8);
    const headerSize = 44;

    const buffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');

    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    const pcmOffset = 44;
    for (let i = 0; i < pcmData.length; i++) {
        view.setInt16(pcmOffset + i * 2, pcmData[i], true);
    }

    return buffer;
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('🎉 Bypass Subtitles (Thin Client) installed!');
    }
});

console.log('🚀 Bypass Subtitles background script loaded');
