declare module "virtual:writer-locale-resources" {
  const resources: Record<"zh-CN" | "en-US", { url: string; schema: string }>;
  export default resources;
}
