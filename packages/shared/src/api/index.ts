/**
 * API Types and Utilities.
 *
 * Provides canonical response envelope types and utilities for
 * standardized API responses across all endpoints.
 */

export {
  // Object type constants
  ObjectTypes,
  type ObjectType,
  // Response envelope types
  type ApiResponse,
  type ApiListResponse,
  type ApiError,
  type ApiErrorResponse,
  type ApiResponseUnion,
  // Type guards
  isApiResponse,
  isApiListResponse,
  isApiErrorResponse,
  isSuccessResponse,
} from "./envelope";

export {
  // Request ID generation
  generateRequestId,
  // Wrapper options types
  type WrapResourceOptions,
  type WrapListOptions,
  type WrapErrorOptions,
  // Core wrapper functions
  wrapResource,
  wrapList,
  wrapError,
  // Convenience wrappers
  wrapCreated,
  wrapEmptyList,
  wrapValidationError,
  wrapNotFound,
} from "./response-utils";
