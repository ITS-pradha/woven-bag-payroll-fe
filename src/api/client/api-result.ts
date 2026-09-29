interface ApiResult<TData> {
  data?: TData;
  error?: unknown;
  response: Response;
}

interface ApiClientErrorOptions {
  status: number;
  payload?: unknown;
}

interface ErrorMetadata {
  code: string;
  message: string;
  requestId: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readErrorMetadata(payload: unknown): ErrorMetadata {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return {
      code: "UNEXPECTED_API_ERROR",
      message: "Respons server tidak dapat diproses.",
      requestId: undefined,
    };
  }

  const code =
    typeof payload.error.code === "string"
      ? payload.error.code
      : "UNEXPECTED_API_ERROR";
  const message =
    typeof payload.error.message === "string"
      ? payload.error.message
      : "Permintaan tidak dapat diproses oleh server.";
  const requestId =
    typeof payload.error.requestId === "string"
      ? payload.error.requestId
      : undefined;

  return { code, message, requestId };
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly payload: unknown;

  constructor({ status, payload }: ApiClientErrorOptions) {
    const metadata = readErrorMetadata(payload);
    super(metadata.message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = metadata.code;
    this.requestId = metadata.requestId;
    this.payload = payload;
  }
}

export function unwrapApiData<TData>(result: ApiResult<TData>): TData {
  if (
    result.error !== undefined ||
    !result.response.ok ||
    result.data === undefined
  ) {
    throw new ApiClientError({
      status: result.response.status,
      payload: result.error,
    });
  }

  return result.data;
}
