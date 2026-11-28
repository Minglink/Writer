interface ImportMetaEnv {
  readonly MAIN_VITE_WRITER_APP_MODE?: string;
  readonly MAIN_VITE_WRITER_PUBLIC_DATA_API_BASE_URL?: string;
  readonly MAIN_VITE_WRITER_PUBLIC_DATA_API_KEY?: string;
  readonly MAIN_VITE_WRITER_GOOGLE_GEMINI_CLIENT_ID?: string;
  readonly MAIN_VITE_WRITER_GOOGLE_GEMINI_CLIENT_SECRET?: string;
  readonly MAIN_VITE_WRITER_GOOGLE_ANTIGRAVITY_CLIENT_ID?: string;
  readonly MAIN_VITE_WRITER_GOOGLE_ANTIGRAVITY_CLIENT_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
