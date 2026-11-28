import { gunzipSync } from "node:zlib";

export const CONNECT_FLAG_COMPRESSED = 0x01;
export const CONNECT_FLAG_END_STREAM = 0x02;
const MAX_CONNECT_FRAME_BYTES = 16 * 1024 * 1024;

export interface ConnectEnvelopeFrame {
  flags: number;
  endStream: boolean;
  payload: Uint8Array;
}

export function concatUint8Arrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.byteLength === 0) return b;
  if (b.byteLength === 0) return a;
  const merged = new Uint8Array(a.byteLength + b.byteLength);
  merged.set(a, 0);
  merged.set(b, a.byteLength);
  return merged;
}

export function encodeConnectEnvelope(
  payload: Uint8Array,
  flags = 0
): Uint8Array {
  const frame = new Uint8Array(5 + payload.byteLength);
  const view = new DataView(frame.buffer);
  frame[0] = flags;
  view.setUint32(1, payload.byteLength, false);
  frame.set(payload, 5);
  return frame;
}

export function decodeConnectEnvelopes(buffer: Uint8Array): {
  frames: ConnectEnvelopeFrame[];
  remainder: Uint8Array;
} {
  const frames: ConnectEnvelopeFrame[] = [];
  let offset = 0;

  while (offset + 5 <= buffer.byteLength) {
    const flags = buffer[offset]!;
    const view = new DataView(
      buffer.buffer,
      buffer.byteOffset + offset,
      buffer.byteLength - offset
    );
    const length = view.getUint32(1, false);
    if (length > MAX_CONNECT_FRAME_BYTES) {
      throw new Error(
        "Connect 流式帧长度超出安全上限，上游非官方协议格式可能已变更。"
      );
    }
    if (offset + 5 + length > buffer.byteLength) {
      break;
    }
    const rawPayload = buffer.slice(offset + 5, offset + 5 + length);
    const payload =
      (flags & CONNECT_FLAG_COMPRESSED) !== 0
        ? new Uint8Array(gunzipSync(rawPayload))
        : rawPayload;
    frames.push({
      flags,
      endStream: (flags & CONNECT_FLAG_END_STREAM) !== 0,
      payload
    });
    offset += 5 + length;
  }

  return {
    frames,
    remainder: offset === 0 ? buffer : buffer.slice(offset)
  };
}

export interface ProtoField {
  fieldNumber: number;
  wireType: number;
  varint?: bigint;
  bytes?: Uint8Array;
}

function readVarint(
  bytes: Uint8Array,
  start: number
): { value: bigint; nextOffset: number } {
  let result = 0n;
  let shift = 0n;
  let offset = start;
  while (offset < bytes.byteLength) {
    const b = BigInt(bytes[offset]!);
    offset += 1;
    result |= (b & 0x7fn) << shift;
    if ((b & 0x80n) === 0n) {
      return { value: result, nextOffset: offset };
    }
    shift += 7n;
    if (shift > 63n) {
      throw new Error("Protobuf varint 字段异常，上游协议可能已变更。");
    }
  }
  throw new Error("Protobuf varint 截断，上游协议可能已变更。");
}

export function decodeProtoFields(bytes: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    const tag = readVarint(bytes, offset);
    offset = tag.nextOffset;
    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x07n);
    if (fieldNumber <= 0) {
      throw new Error("Protobuf 字段编号无效，上游协议可能已变更。");
    }
    if (wireType === 0) {
      const val = readVarint(bytes, offset);
      offset = val.nextOffset;
      fields.push({ fieldNumber, wireType, varint: val.value });
    } else if (wireType === 1) {
      if (offset + 8 > bytes.byteLength) {
        throw new Error("Protobuf 64-bit 字段截断。");
      }
      fields.push({
        fieldNumber,
        wireType,
        bytes: bytes.slice(offset, offset + 8)
      });
      offset += 8;
    } else if (wireType === 2) {
      const len = readVarint(bytes, offset);
      offset = len.nextOffset;
      const byteLen = Number(len.value);
      if (byteLen < 0 || offset + byteLen > bytes.byteLength) {
        throw new Error("Protobuf 长度分隔字段截断。");
      }
      fields.push({
        fieldNumber,
        wireType,
        bytes: bytes.slice(offset, offset + byteLen)
      });
      offset += byteLen;
    } else if (wireType === 5) {
      if (offset + 4 > bytes.byteLength) {
        throw new Error("Protobuf 32-bit 字段截断。");
      }
      fields.push({
        fieldNumber,
        wireType,
        bytes: bytes.slice(offset, offset + 4)
      });
      offset += 4;
    } else {
      throw new Error(`不支持的 Protobuf wireType=${wireType}。`);
    }
  }
  return fields;
}

export function encodeProtoVarint(value: number | bigint): Uint8Array {
  let v = typeof value === "bigint" ? value : BigInt(Math.max(0, value));
  const out: number[] = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    out.push(byte);
  } while (v > 0n);
  return new Uint8Array(out);
}

export function encodeProtoBytesField(
  fieldNumber: number,
  data: Uint8Array
): Uint8Array {
  const tag = encodeProtoVarint((fieldNumber << 3) | 2);
  const len = encodeProtoVarint(data.byteLength);
  return concatUint8Arrays(concatUint8Arrays(tag, len), data);
}

export function encodeProtoStringField(
  fieldNumber: number,
  value: string
): Uint8Array {
  return encodeProtoBytesField(fieldNumber, new TextEncoder().encode(value));
}

export function encodeProtoVarintField(
  fieldNumber: number,
  value: number | bigint
): Uint8Array {
  const tag = encodeProtoVarint(fieldNumber << 3);
  return concatUint8Arrays(tag, encodeProtoVarint(value));
}

function mapConnectCodeToStatus(code: string): number {
  switch (code.toLowerCase()) {
    case "unauthenticated":
      return 401;
    case "permission_denied":
      return 403;
    case "resource_exhausted":
      return 429;
    case "unimplemented":
    case "not_found":
      return 404;
    case "invalid_argument":
    case "failed_precondition":
      return 400;
    default:
      return 502;
  }
}

export function formatConnectEndStreamError(
  providerLabel: string,
  payloadText: string
): Error | undefined {
  const trimmed = payloadText.trim();
  if (!trimmed || trimmed === "{}") return undefined;
  let code: string;
  let message: string;
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { code?: string; message?: string };
    };
    if (!parsed.error) return undefined;
    code = typeof parsed.error.code === "string" ? parsed.error.code : "";
    message =
      typeof parsed.error.message === "string" ? parsed.error.message : "";
  } catch {
    return new Error(
      `${providerLabel} 非官方社区适配协议返回了无法解析的结束帧，上游接口可能已调整；建议切换其他订阅渠道。`
    );
  }
  const status = mapConnectCodeToStatus(code);
  if (
    code === "unimplemented" ||
    code === "not_found" ||
    code === "invalid_argument"
  ) {
    return new Error(
      `[HTTP ${status}] ${providerLabel} 非官方社区适配协议可能已被上游调整（${code}${message ? `: ${message}` : ""}），暂无法完成请求；建议切换其他订阅渠道。`
    );
  }
  return new Error(
    `[HTTP ${status}] ${code ? `${code}: ` : ""}${message || `${providerLabel} 上游流返回错误。`}`
  );
}

export function formatConnectHttpError(
  providerLabel: string,
  status: number,
  bodyText: string,
  retryAfterHeader: string | null
): Error {
  let detail = "";
  let code = "";
  try {
    const parsed = JSON.parse(bodyText) as {
      code?: string;
      message?: string;
      error?: { code?: string; message?: string } | string;
    };
    if (typeof parsed.code === "string") code = parsed.code;
    if (typeof parsed.message === "string") detail = parsed.message;
    else if (typeof parsed.error === "string") detail = parsed.error;
    else if (parsed.error && typeof parsed.error.message === "string") {
      detail = parsed.error.message;
      code = parsed.error.code ?? code;
    }
  } catch {
    detail = bodyText.trim().slice(0, 240);
  }
  if (
    status === 404 ||
    status === 405 ||
    status === 415 ||
    status === 426 ||
    status === 501
  ) {
    return new Error(
      `[HTTP ${status}] ${providerLabel} 非官方社区适配协议可能已被上游调整${detail ? `（${detail}）` : ""}，暂无法完成请求；建议切换其他订阅渠道或等待适配更新。`
    );
  }
  const retryHint = retryAfterHeader
    ? ` (Retry-After: ${retryAfterHeader})`
    : "";
  const codePrefix = code ? `${code}: ` : "";
  return new Error(
    `[HTTP ${status}]${retryHint} ${codePrefix}${detail || `${providerLabel} 订阅接口请求失败。`}`.trim()
  );
}
