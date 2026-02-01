const { DataSyncService, WHITELISTED_SITES } = require('../DataSyncService');

describe('DataSyncService', () => {
    let service;

    // Mock chrome storage
    const mockStorage = {
        deviceId: 'test-device-id',
        dataSyncConsent: false,
        supabaseUrl: 'https://test.supabase.co',
        supabaseAnonKey: 'test-key',
    };

    beforeEach(() => {
        // Reset chrome mocks
        chrome.storage.local.get.mockImplementation((keys) => {
            if (Array.isArray(keys)) {
                const result = {};
                keys.forEach(k => result[k] = mockStorage[k]);
                return Promise.resolve(result);
            }
            return Promise.resolve(mockStorage);
        });

        chrome.storage.local.set.mockImplementation((items) => {
            Object.assign(mockStorage, items);
            return Promise.resolve();
        });

        // Mock fetch
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ success: true }),
            })
        );

        // Mock crypto.randomUUID
        Object.defineProperty(global, 'crypto', {
            value: {
                randomUUID: jest.fn().mockReturnValue('new-uuid')
            },
            writable: true
        });

        service = new DataSyncService();
    });

    test('should initialize with values from storage', async () => {
        await service.init();
        expect(service.deviceId).toBe('test-device-id');
        expect(service.isConfigured).toBe(true);
        expect(service.isEnabled).toBe(false);
    });

    test('should generate new deviceId if missing', async () => {
        mockStorage.deviceId = null;
        await service.init();
        expect(service.deviceId).toBe('new-uuid');
        expect(chrome.storage.local.set).toHaveBeenCalledWith({ deviceId: 'new-uuid' });
    });

    test('should validate whitelisted sites', () => {
        expect(service.isWhitelistedSite('https://www.youtube.com/watch?v=123')).toBe(true);
        expect(service.isWhitelistedSite('https://bilibili.com/video/BV123')).toBe(true);
        expect(service.isWhitelistedSite('https://attacker.com')).toBe(false);
        expect(service.isWhitelistedSite('file:///C:/local/video.mp4')).toBe(false);
    });

    test('should NOT sync if consent is false', async () => {
        await service.init();
        // Consent is false by default in mockStorage

        const result = await service.syncSegment('https://youtube.com', 'Hello', 'Xin chào', 'en', 'vi');

        expect(result).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('should NOT sync if site not whitelisted', async () => {
        mockStorage.dataSyncConsent = true;
        await service.init();

        const result = await service.syncSegment('https://evil.com', 'Hello', 'Xin chào', 'en', 'vi');

        expect(result).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('should sync if consent true AND whitelisted AND configured', async () => {
        mockStorage.dataSyncConsent = true;
        await service.init();

        const result = await service.syncSegment('https://youtube.com', 'Hello', 'Xin chào', 'en', 'vi');

        expect(result).toBe(true);
        expect(global.fetch).toHaveBeenCalledWith(
            'https://test.supabase.co/rest/v1/subtitle_feedback',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'apikey': 'test-key'
                })
            })
        );
    });
});
