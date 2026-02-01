# Bypass Subtitles (Open Source)

**Bypass Subtitles** is a powerful tool to automatically generate and translate subtitles for any video on the web using AI.

## Repository Structure

- **`core/backend`**: FastAPI server handling audio transcription (Whisper/Groq) and translation (LLMs).
- **`core/extension`**: Chrome Extension that captures audio and displays subtitles overlaid on the video.
- **`landing`**: Next.js landing page for marketing/demos.

## Getting Started

### 1. Backend Setup (Self-Hosted)

The backend is required for transcription and translation.

1. Navigate to `core/backend`:

   ```bash
   cd core/backend
   ```

2. Create environment file:

   ```bash
   cp .env.example .env
   ```

3. Edit `.env` and add your API keys (OpenAI, Groq, Deepgram) and Supabase credentials.
4. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

5. Run the server:

   ```bash
   python main.py
   ```

   Server runs on `http://localhost:8000`.

### 2. Chrome Extension Setup

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `core/extension` folder.
5. In the extension settings (popup), switch Mode to **Server (Local)**.

### 3. Database (Supabase)

1. Creates a new Supabase project.
2. Run the SQL from `core/backend/supabase_schema.sql` in the Supabase SQL Editor to set up tables and policies.

## Docker Deployment

```bash
cd core/backend
docker build -t bypass-backend .
docker run -p 8000:8000 --env-file .env bypass-backend
```

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

[MIT](LICENSE)
