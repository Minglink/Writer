/// <reference types="vite/client" />

import type { WriterApi } from "@writer/contracts";

declare global {
  interface Window {
    writer?: WriterApi;
  }
}

export {};
