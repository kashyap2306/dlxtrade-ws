export declare class AppError extends Error {
    statusCode: number;
    message: string;
    code?: string;
    constructor(statusCode: number, message: string, code?: string);
}
export declare class ValidationError extends AppError {
    constructor(message: string);
}
export declare class AuthenticationError extends AppError {
    constructor(message?: string);
}
export declare class AuthorizationError extends AppError {
    constructor(message?: string);
}
export declare class NotFoundError extends AppError {
    constructor(message?: string);
}
export declare class ExchangeError extends AppError {
    constructor(message: string, statusCode?: number);
}
//# sourceMappingURL=errors.d.ts.map