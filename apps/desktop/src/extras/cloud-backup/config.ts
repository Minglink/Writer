import { WRITER_PUBLIC_DATA_API_BASE_URL } from "../../main/writer-public-data-config";

export interface CloudBackupApiConfig {
  baseUrl: string;
}
export function loadCloudBackupApiConfig(): CloudBackupApiConfig | null {
  const url = new URL(WRITER_PUBLIC_DATA_API_BASE_URL);
  if (
    url.hostname === "writer-public-data.invalid" ||
    url.protocol !== "https:"
  )
    return null;
  return { baseUrl: WRITER_PUBLIC_DATA_API_BASE_URL };
}
