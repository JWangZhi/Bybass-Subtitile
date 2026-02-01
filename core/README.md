# Bypass Subtitles

> AI-powered Chrome Extension that generates real-time subtitles with translation for any video without built-in captions.

[![Beta](https://img.shields.io/badge/Status-Beta%20v0.1-orange)](https://github.com/wangzhi/bypass-subtitles)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Features

- **Real-time Transcription** - Powered by Whisper Large v3 via Groq API
- **Multi-language Translation** - 10 languages: English, Vietnamese, Chinese, Japanese, Korean, French, German, Spanish, Russian, Thai
- **Context-Aware Translation** - Auto-detects dialogue vs narration for accurate pronoun usage
- **Local Caching** - Subtitles saved locally, no re-transcription needed
- **Privacy Friendly** - Only audio sent to Groq for transcription

---

## Quick Start (5 minutes)

### Step 1: Get Groq API Key (Free)

1. Go to [console.groq.com](https://console.groq.com)
2. Sign up / Login
3. Go to **API Keys** > Create new key
4. Copy the key (starts with `gsk_...`)

### Step 2: Install Extension

1. Download this repository (Code > Download ZIP)
2. Unzip to a folder
3. Open Chrome > `chrome://extensions/`
4. Enable **Developer mode** (top right toggle)
5. Click **Load unpacked**
6. Select the `extension/` folder

### Step 3: Configure & Use

1. Click the extension icon in Chrome toolbar
2. Paste your Groq API Key
3. Select source language (or Auto)
4. Select target language for translation
5. Open any video webpage
6. Click **Enable Subtitles**

Done! Subtitles will appear automatically.

---

## Supported Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| YouTube | Tested | Full support |
| Bilibili | Tested | Global & CN |
| Vimeo | Tested | Full support |
| Twitch | Tested | Live & VOD |
| Netflix | Limited | DRM may block audio |
| Generic HTML5 Video | Tested | Most sites work |

---

## Supported Languages

**Source (Transcription):**
Auto-detect, English, Vietnamese, Chinese, Japanese, Korean, French, German, Spanish, Russian, Thai

**Target (Translation):**
Vietnamese, English, Chinese, Japanese, Korean, French, German, Spanish, Russian, Thai

---

## How It Works

```
Video Audio --> Capture --> Groq API (Whisper) --> Transcription
                                                         |
                                                         v
                                              Groq API (LLM) --> Translation
                                                         |
                                                         v
                                              Subtitle Overlay on Video
```

---

## Limitations (Beta)

- Requires internet connection (Groq API)
- Groq free tier: 7,200 audio seconds/hour (enough for real-time)
- DRM-protected content may not work (Netflix, Disney+)
- Very fast speech may have slight delay

---

## FAQ

**Q: Is it free?**
A: Yes! The extension is free. Groq API has a generous free tier (7,200 audio seconds/hour).

**Q: Is my audio sent to servers?**
A: Yes, audio is sent to Groq API for transcription. Groq does not store your data. See their [privacy policy](https://groq.com/privacy).

**Q: Can I use it offline?**
A: Not yet. Local mode using WebAssembly is on the roadmap.

**Q: Does it work with Netflix/Disney+?**
A: Limited. DRM protection may block audio capture on some premium platforms.

**Q: Why no subtitles on some videos?**
A: Some sites use special video players that block audio capture. Try refreshing the page.

**Q: What languages are supported?**
A: 10 languages for both transcription and translation: English, Vietnamese, Chinese, Japanese, Korean, French, German, Spanish, Russian, Thai.

**Q: How accurate is the transcription?**
A: Very accurate. Uses Whisper Large v3, one of the best speech recognition models available.

**Q: Will it slow down my browser?**
A: No. Processing happens on Groq servers. Your browser only captures and sends audio.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No subtitles appearing | Check if video is playing. Open DevTools (F12) > Console for errors. |
| "No API key" error | Paste Groq API key in extension popup. Get key at console.groq.com. |
| Rate limit error | Wait 1 minute. Free tier allows 20 requests/minute. |
| Audio not captured | Refresh the page. Some sites block audio capture. |
| Subtitles out of sync | Pause and resume the video to resync. |
| Extension not loading | Go to chrome://extensions, disable/enable the extension. |

---

## Contributing

Contributions welcome! Please open an issue first to discuss changes.

---

## License

MIT License - Free for personal and commercial use.

---

## Support

If you find this useful:

- Star this repo
- Report bugs via Issues
- Share with friends learning languages

---

**Made with care for language learners worldwide.**
