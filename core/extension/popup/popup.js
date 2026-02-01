/**
 * Popup Script
 * Controls extension UI, settings, and status monitoring.
 */

// DOM Elements
const toggleBtn = document.getElementById('toggle-btn');
const toggleText = document.getElementById('toggle-text');
const videoDot = document.getElementById('video-dot');
const videoText = document.getElementById('video-text');
const backendDot = document.getElementById('backend-dot');
const backendText = document.getElementById('backend-text');
const sourceLang = document.getElementById('source-lang');
const targetLang = document.getElementById('target-lang');
const showOriginal = document.getElementById('show-original');
const reloadPageBtn = document.getElementById('reload-page-btn');
const dataSyncConsent = document.getElementById('data-sync-consent');

// New Mode Elements
const apiMode = document.getElementById('api-mode');
const groqSettings = document.getElementById('groq-settings');
const groqApiKey = document.getElementById('groq-api-key');
const toggleKeyVisibility = document.getElementById('toggle-key-visibility');

// Default to 'trial' (Server)
let selectedMode = 'trial';

let isEnabled = false;

const DEFAULT_SETTINGS = {
    sourceLang: 'auto',
    targetLang: 'vi',
    showOriginal: true,
    apiMode: 'trial',
    groqApiKey: '',
    dataSyncConsent: false,
};

async function init() {
    await loadSettings();
    await updateStatus();
    await detectHardwareAndRecommend();

    toggleBtn.addEventListener('click', toggleSubtitles);
    sourceLang.addEventListener('change', saveSettings);
    targetLang.addEventListener('change', saveSettings);
    showOriginal.addEventListener('change', saveSettings);
    reloadPageBtn.addEventListener('click', reDetectVideos);
    dataSyncConsent.addEventListener('change', saveSettings);

    // Mode selection
    apiMode.querySelectorAll('.mode-option').forEach(opt => {
        opt.addEventListener('click', () => {
            selectedMode = opt.dataset.value;
            apiMode.querySelectorAll('.mode-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            updateGroqSettingsVisibility();
            saveSettings();
        });
    });

    toggleKeyVisibility.addEventListener('click', toggleApiKeyVisibility);
    groqApiKey.addEventListener('input', saveSettings);
}

async function reDetectVideos() {
    const btn = document.getElementById('reload-page-btn');
    const originalText = btn.textContent;

    try {
        btn.textContent = 'Checking...';
        btn.disabled = true;

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'redetect' });

        if (response?.success) {
            const count = response.videoCount || 0;
            btn.textContent = count > 0 ? `Found ${count} video${count > 1 ? 's' : ''}` : 'No videos';
            await updateStatus();

            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 2000);
        } else {
            btn.textContent = 'No videos';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 2000);
        }
    } catch (error) {
        console.error('Failed to re-detect videos:', error);
        btn.textContent = 'Not available';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 2000);
    }
}

async function detectHardwareAndRecommend() {
    try {
        const { hardwareChecked } = await chrome.storage.local.get('hardwareChecked');
        if (hardwareChecked) return;

        const gpuInfo = detectGPU();
        await chrome.storage.local.set({ hardwareChecked: true });

        // Recommend Groq for weak hardware (integrated GPU)
        if (gpuInfo.isIntegrated || gpuInfo.tier === 'low') {
            showHardwareRecommendation(gpuInfo, {
                mode: 'groq',
                reason: 'Integrated GPU detected. Groq Cloud API recommended for smooth performance.'
            });
        }
    } catch (e) {
        console.warn('Hardware detection failed:', e);
    }
}

function detectGPU() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);

    const isIntegrated = /intel|amd|mali/i.test(renderer) && !/nvidia|geforce|radeon rx/i.test(renderer);
    return {
        renderer,
        isIntegrated,
        tier: isIntegrated ? 'low' : 'high'
    };
}

function showHardwareRecommendation(gpuInfo, recommendation) {
    const banner = document.createElement('div');
    banner.id = 'hardware-recommendation';
    banner.style.cssText = `
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 12px;
        margin: -15px -15px 15px -15px;
        border-radius: 12px 12px 0 0;
        font-size: 12px;
    `;
    banner.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 4px;">💡 Hardware Detected</div>
        <div style="opacity: 0.9; font-size: 11px;">${recommendation.reason}</div>
        <button id="apply-recommendation" style="
            background: rgba(255,255,255,0.2);
            border: 1px solid rgba(255,255,255,0.3);
            color: white;
            padding: 4px 12px;
            border-radius: 4px;
            margin-top: 8px;
            cursor: pointer;
            font-size: 11px;
        ">Apply Recommendation</button>
        <button id="dismiss-recommendation" style="
            background: transparent;
            border: none;
            color: rgba(255,255,255,0.7);
            padding: 4px 8px;
            cursor: pointer;
            font-size: 11px;
        ">Dismiss</button>
    `;

    document.body.insertBefore(banner, document.body.firstChild);

    document.getElementById('apply-recommendation').addEventListener('click', () => {
        apiMode.value = recommendation.mode;
        onApiModeChange();
        saveSettings();
        banner.remove();
    });

    document.getElementById('dismiss-recommendation').addEventListener('click', () => {
        banner.remove();
    });
}

async function loadSettings() {
    try {
        const result = await chrome.storage.sync.get(DEFAULT_SETTINGS);
        sourceLang.value = result.sourceLang;
        targetLang.value = result.targetLang;
        showOriginal.checked = result.showOriginal;
        selectedMode = result.apiMode || 'trial';

        // Update Visual Selector State
        apiMode.querySelectorAll('.mode-option').forEach(opt => {
            if (opt.dataset.value === selectedMode) {
                opt.classList.add('active');
            } else {
                opt.classList.remove('active');
            }
        });

        groqApiKey.value = result.groqApiKey || '';
        dataSyncConsent.checked = result.dataSyncConsent || false;

        updateGroqSettingsVisibility();
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

async function saveSettings() {
    try {
        const settings = {
            sourceLang: sourceLang.value,
            targetLang: targetLang.value,
            showOriginal: showOriginal.checked,
            apiMode: selectedMode,
            groqApiKey: groqApiKey.value,
            dataSyncConsent: dataSyncConsent.checked,
        };

        await chrome.storage.sync.set(settings);

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.tabs.sendMessage(tab.id, {
                action: 'updateSettings',
                settings,
            });
        } catch (e) {
            // Content script might not be loaded
        }
    } catch (error) {
        console.error('Failed to save settings:', error);
    }
}

function onApiModeChange() {
    updateGroqSettingsVisibility();
    saveSettings();
}

function updateGroqSettingsVisibility() {
    if (selectedMode === 'trial') {
        groqSettings.classList.add('hidden');
    } else {
        groqSettings.classList.remove('hidden');
    }
}

function toggleApiKeyVisibility() {
    if (groqApiKey.type === 'password') {
        groqApiKey.type = 'text';
        toggleKeyVisibility.textContent = 'Hide';
    } else {
        groqApiKey.type = 'password';
        toggleKeyVisibility.textContent = '•••';
    }
}

async function updateStatus() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });

        isEnabled = response.isEnabled;

        // Video status
        if (response.hasVideo) {
            videoDot.classList.add('active');
            videoText.textContent = 'Found';
        } else {
            videoDot.classList.remove('active');
            videoText.textContent = 'Not found';
        }

        // Backend/API status
        // Always show Ready since we are using hardcoded key
        backendDot.classList.add('active');
        backendText.textContent = 'Ready';

        updateToggleButton();

        updateToggleButton();

    } catch (error) {
        console.error('Failed to get status:', error);
        videoText.textContent = 'No page';
        backendText.textContent = 'N/A';
    }
}

function updateToggleButton() {
    if (isEnabled) {
        toggleBtn.classList.remove('btn-primary');
        toggleBtn.classList.add('btn-danger');
        toggleText.textContent = 'Disable Subtitles';
    } else {
        toggleBtn.classList.remove('btn-danger');
        toggleBtn.classList.add('btn-primary');
        toggleText.textContent = 'Enable Subtitles';
    }
}

async function toggleSubtitles() {
    try {
        // Validation removed (handled in background.js)

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const action = isEnabled ? 'disable' : 'enable';

        await chrome.tabs.sendMessage(tab.id, {
            action,
            settings: {
                sourceLang: sourceLang.value,
                targetLang: targetLang.value,
                showOriginal: showOriginal.checked,
                apiMode: selectedMode,
                groqApiKey: groqApiKey.value,
            },
        });

        isEnabled = !isEnabled;
        updateToggleButton();
        setTimeout(updateStatus, 500);

    } catch (error) {
        console.error('Failed to toggle subtitles:', error);
    }
}

document.addEventListener('DOMContentLoaded', init);
