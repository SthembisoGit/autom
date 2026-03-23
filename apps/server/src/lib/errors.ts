export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, message, details);
}

export function notFound(message: string, details?: unknown): AppError {
  return new AppError(404, message, details);
}

export function conflict(message: string, details?: unknown): AppError {
  return new AppError(409, message, details);
}

export function toErrorResponse(
  error: unknown,
  fallbackMessage: string
): {
  statusCode: number;
  payload: {
    message: string;
    details?: unknown;
  };
} {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      payload: {
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
  }

  return {
    statusCode: 500,
    payload: {
      message: fallbackMessage,
    },
  };
}
