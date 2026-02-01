/**
 * IndexedDB Subtitle Storage
 * Caches transcriptions and translations locally for all 10 supported languages.
 */

const DB_NAME = 'BypassSubtitles';
const DB_VERSION = 1;
const SUPPORTED_LANGUAGES = ['en', 'vi', 'zh', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'th'];

class SubtitleStore {
    constructor() {
        this.db = null;
        this.initPromise = this.init();
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.error('[SubtitleStore] Failed to open:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                this.createStores(db);
            };
        });
    }

    createStores(db) {
        if (!db.objectStoreNames.contains('videos')) {
            const videoStore = db.createObjectStore('videos', { keyPath: 'id' });
            videoStore.createIndex('url', 'url', { unique: false });
            videoStore.createIndex('lastAccessed', 'lastAccessed', { unique: false });
        }

        if (!db.objectStoreNames.contains('segments')) {
            const segmentStore = db.createObjectStore('segments', { keyPath: 'id', autoIncrement: true });
            segmentStore.createIndex('videoId', 'videoId', { unique: false });
            segmentStore.createIndex('videoId_startTime', ['videoId', 'startTime'], { unique: false });
        }
    }

    async generateVideoId(url) {
        const encoder = new TextEncoder();
        const data = encoder.encode(url);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async saveVideo(url, title = '', duration = 0) {
        await this.initPromise;
        const id = await this.generateVideoId(url);

        const video = {
            id, url, title, duration,
            createdAt: new Date().toISOString(),
            lastAccessed: new Date().toISOString(),
        };

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('videos', 'readwrite');
            const store = tx.objectStore('videos');

            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
                if (getRequest.result) video.createdAt = getRequest.result.createdAt;
                const putRequest = store.put(video);
                putRequest.onsuccess = () => resolve(video);
                putRequest.onerror = () => reject(putRequest.error);
            };
        });
    }

    async getVideo(url) {
        await this.initPromise;
        const id = await this.generateVideoId(url);

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('videos', 'readonly');
            const store = tx.objectStore('videos');
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Save subtitle segment with translations.
     * @param {Object} metadata - Optional: { confidence, model, userCorrected, correctedText }
     */
    async saveSegment(videoUrl, startTime, endTime, original, sourceLang, translations = {}, metadata = {}) {
        await this.initPromise;
        const videoId = await this.generateVideoId(videoUrl);

        await this.saveVideo(videoUrl);

        const translationsObj = {};
        SUPPORTED_LANGUAGES.forEach(lang => {
            translationsObj[lang] = translations[lang] || null;
        });

        const segment = {
            videoId, startTime, endTime, original, sourceLang,
            translations: translationsObj,
            confidence: metadata.confidence || null,
            model: metadata.model || 'whisper-large-v3',
            userCorrected: metadata.userCorrected || false,
            correctedText: metadata.correctedText || null,
            createdAt: new Date().toISOString(),
        };

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('segments', 'readwrite');
            const store = tx.objectStore('segments');
            const index = store.index('videoId_startTime');
            const range = IDBKeyRange.only([videoId, startTime]);
            const cursorRequest = index.openCursor(range);

            cursorRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    // Update existing - merge translations
                    const existing = cursor.value;
                    Object.keys(translationsObj).forEach(lang => {
                        if (translationsObj[lang]) existing.translations[lang] = translationsObj[lang];
                    });
                    existing.original = original;
                    existing.sourceLang = sourceLang;
                    cursor.update(existing);
                    resolve(existing);
                } else {
                    const addRequest = store.add(segment);
                    addRequest.onsuccess = () => {
                        segment.id = addRequest.result;
                        resolve(segment);
                    };
                    addRequest.onerror = () => reject(addRequest.error);
                }
            };
        });
    }

    async getSegments(videoUrl) {
        await this.initPromise;
        const videoId = await this.generateVideoId(videoUrl);

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('segments', 'readonly');
            const store = tx.objectStore('segments');
            const index = store.index('videoId');
            const request = index.getAll(videoId);
            request.onsuccess = () => {
                const segments = request.result || [];
                segments.sort((a, b) => a.startTime - b.startTime);
                resolve(segments);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getSegmentAtTime(videoUrl, time) {
        const segments = await this.getSegments(videoUrl);
        return segments.find(s => time >= s.startTime && time <= s.endTime) || null;
    }

    async hasCache(videoUrl) {
        const segments = await this.getSegments(videoUrl);
        return segments.length > 0;
    }

    async getTranslation(videoUrl, time, lang) {
        const segment = await this.getSegmentAtTime(videoUrl, time);
        if (!segment) return null;
        return segment.translations[lang] || null;
    }

    async addTranslation(videoUrl, startTime, lang, translation) {
        await this.initPromise;
        const videoId = await this.generateVideoId(videoUrl);

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('segments', 'readwrite');
            const store = tx.objectStore('segments');
            const index = store.index('videoId_startTime');
            const range = IDBKeyRange.only([videoId, startTime]);
            const cursorRequest = index.openCursor(range);

            cursorRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const segment = cursor.value;
                    segment.translations[lang] = translation;
                    cursor.update(segment);
                    resolve(segment);
                } else {
                    resolve(null);
                }
            };
            cursorRequest.onerror = () => reject(cursorRequest.error);
        });
    }

    async exportVideoData(videoUrl) {
        const video = await this.getVideo(videoUrl);
        const segments = await this.getSegments(videoUrl);
        return { video, segments };
    }

    async exportAll() {
        await this.initPromise;

        const videos = await new Promise((resolve, reject) => {
            const tx = this.db.transaction('videos', 'readonly');
            const request = tx.objectStore('videos').getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        const segments = await new Promise((resolve, reject) => {
            const tx = this.db.transaction('segments', 'readonly');
            const request = tx.objectStore('segments').getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        return {
            exportedAt: new Date().toISOString(),
            version: DB_VERSION,
            supportedLanguages: SUPPORTED_LANGUAGES,
            videos, segments,
        };
    }

    async clearAll() {
        await this.initPromise;
        return Promise.all([
            new Promise((resolve, reject) => {
                const tx = this.db.transaction('videos', 'readwrite');
                const request = tx.objectStore('videos').clear();
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            }),
            new Promise((resolve, reject) => {
                const tx = this.db.transaction('segments', 'readwrite');
                const request = tx.objectStore('segments').clear();
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            }),
        ]);
    }

    async getStats() {
        await this.initPromise;

        const videos = await new Promise((resolve, reject) => {
            const tx = this.db.transaction('videos', 'readonly');
            const request = tx.objectStore('videos').count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        const segments = await new Promise((resolve, reject) => {
            const tx = this.db.transaction('segments', 'readonly');
            const request = tx.objectStore('segments').count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        return { videos, segments };
    }
}

const subtitleStore = new SubtitleStore();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SubtitleStore, subtitleStore, SUPPORTED_LANGUAGES };
}
