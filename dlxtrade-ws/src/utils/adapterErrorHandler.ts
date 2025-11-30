import { AxiosError } from 'axios';
import { logger } from './logger';

export interface AdapterErrorDetails {
  adapter: string;
  method: string;
  url: string;
  statusCode?: number;
  statusText?: string;
  responseSnippet?: string;
  errorMessage: string;
  stack?: string;
  isAuthError: boolean;
}

/**
 * Helper function to extract detailed error information from adapter errors
 */
export function extractAdapterError(
  adapterName: string,
  method: string,
  url: string,
  error: any
): AdapterErrorDetails {
  const isAxiosError = error instanceof AxiosError || error?.isAxiosError;
  const statusCode = isAxiosError ? error.response?.status : error?.statusCode || error?.status;
  const statusText = isAxiosError ? error.response?.statusText : error?.statusText;
  
  // Extract response body snippet (first 2000 chars)
  let responseSnippet: string | undefined;
  if (isAxiosError && error.response?.data) {
    try {
      const dataStr = typeof error.response.data === 'string' 
        ? error.response.data 
        : JSON.stringify(error.response.data);
      responseSnippet = dataStr.substring(0, 2000);
    } catch (e) {
      responseSnippet = String(error.response.data).substring(0, 2000);
    }
  } else if (error?.response?.data) {
    try {
      responseSnippet = JSON.stringify(error.response.data).substring(0, 2000);
    } catch (e) {
      responseSnippet = String(error.response.data).substring(0, 2000);
    }
  }

  // Determine error message
  const errorMessage = error?.message || error?.error?.message || String(error) || 'Unknown error';
  
  // Check if this is an authentication error
  const errorStr = errorMessage.toLowerCase();
  const isAuthError = 
    statusCode === 401 || 
    statusCode === 403 ||
    errorStr.includes('unsupported state') ||
    errorStr.includes('unable to authenticate') ||
    errorStr.includes('authentication') ||
    errorStr.includes('unauthorized') ||
    errorStr.includes('forbidden') ||
    errorStr.includes('invalid api key') ||
    errorStr.includes('api key') ||
    (responseSnippet && (
      responseSnippet.toLowerCase().includes('unsupported state') ||
      responseSnippet.toLowerCase().includes('unable to authenticate') ||
      responseSnippet.toLowerCase().includes('authentication') ||
      responseSnippet.toLowerCase().includes('unauthorized')
    ));

  // Log verbose error details
  logger.error({
    adapter: adapterName,
    method,
    url,
    statusCode,
    statusText,
    responseSnippet: responseSnippet?.substring(0, 500), // Log first 500 chars
    errorMessage,
    isAuthError,
    stack: error?.stack,
  }, `Adapter error: ${adapterName}`);

  return {
    adapter: adapterName,
    method,
    url,
    statusCode,
    statusText,
    responseSnippet,
    errorMessage,
    stack: error?.stack,
    isAuthError,
  };
}

/**
 * Create an adapter-specific error with detailed information
 */
export class AdapterError extends Error {
  public readonly adapter: string;
  public readonly method: string;
  public readonly url: string;
  public readonly statusCode?: number;
  public readonly statusText?: string;
  public readonly responseSnippet?: string;
  public readonly isAuthError: boolean;
  public readonly details: AdapterErrorDetails;

  constructor(details: AdapterErrorDetails) {
    super(`[${details.adapter}] ${details.method} ${details.url}: ${details.errorMessage}`);
    this.name = 'AdapterError';
    this.adapter = details.adapter;
    this.method = details.method;
    this.url = details.url;
    this.statusCode = details.statusCode;
    this.statusText = details.statusText;
    this.responseSnippet = details.responseSnippet;
    this.isAuthError = details.isAuthError;
    this.details = details;
    
    // Preserve stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AdapterError);
    }
  }
}

