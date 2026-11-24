interface ImportMetaEnv {
  readonly MAIN_VITE_WRITER_APP_MODE?: string;
  readonly MAIN_VITE_WRITER_PUBLIC_DATA_API_BASE_URL?: string;
  readonly MAIN_VITE_WRITER_PUBLIC_DATA_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
