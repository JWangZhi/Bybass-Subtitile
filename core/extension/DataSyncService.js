/**
 * Supabase Data Sync Service
 * Syncs anonymous subtitle data from whitelisted sites when user opts in.
 */

const WHITELISTED_SITES = [
    'youtube.com', 'www.youtube.com',
    'bilibili.com', 'www.bilibili.com',
    'vimeo.com', 'www.vimeo.com',
    'twitch.tv', 'www.twitch.tv',
];

class DataSyncService {
    constructor() {
        this.deviceId = null;
        this.isEnabled = false;
        this.supabaseUrl = null;
        this.supabaseAnonKey = null;
        this.isConfigured = false;
        this.initPromise = this.init();
    }

    async init() {
        try {
            const result = await chrome.storage.local.get([
                'deviceId', 'dataSyncConsent', 'supabaseUrl', 'supabaseAnonKey'
            ]);

            if (result.deviceId) {
                this.deviceId = result.deviceId;
            } else {
                this.deviceId = crypto.randomUUID();
                await chrome.storage.local.set({ deviceId: this.deviceId });
            }

            this.supabaseUrl = result.supabaseUrl || null;
            this.supabaseAnonKey = result.supabaseAnonKey || null;
            this.isConfigured = !!(this.supabaseUrl && this.supabaseAnonKey);
            this.isEnabled = result.dataSyncConsent || false;

            console.log('[DataSync] Ready:', {
                deviceId: this.deviceId.substring(0, 8),
                configured: this.isConfigured
            });
        } catch (error) {
            console.error('[DataSync] Init failed:', error);
        }
    }

    isWhitelistedSite(url) {
        try {
            const hostname = new URL(url).hostname;
            return WHITELISTED_SITES.some(site => hostname.includes(site));
        } catch {
            return false;
        }
    }

    async setConsent(enabled) {
        this.isEnabled = enabled;
        await chrome.storage.local.set({ dataSyncConsent: enabled });
    }

    async syncSegment(videoUrl, original, translated, sourceLang, targetLang) {
        await this.initPromise;

        if (!this.isConfigured || !this.isEnabled) return false;
        if (!this.isWhitelistedSite(videoUrl)) return false;
        if (!original?.trim()) return false;

        try {
            const response = await fetch(`${this.supabaseUrl}/rest/v1/subtitle_feedback`, {
                method: 'POST',
                headers: {
                    'apikey': this.supabaseAnonKey,
                    'Authorization': `Bearer ${this.supabaseAnonKey}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal',
                },
                body: JSON.stringify({
                    device_id: this.deviceId,
                    site: new URL(videoUrl).hostname,
                    original_text: original.substring(0, 500),
                    translated_text: translated?.substring(0, 500) || null,
                    source_lang: sourceLang,
                    target_lang: targetLang,
                    created_at: new Date().toISOString(),
                }),
            });

            return response.ok;
        } catch (error) {
            console.error('[DataSync] Sync error:', error);
            return false;
        }
    }

    async getStats() {
        await this.initPromise;
        return {
            deviceId: this.deviceId?.substring(0, 8) + '...',
            isEnabled: this.isEnabled,
            isConfigured: this.isConfigured,
        };
    }
}

const dataSyncService = new DataSyncService();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DataSyncService, dataSyncService, WHITELISTED_SITES };
}
