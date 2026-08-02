// ==========================================
// BRAVE AI - Auth API
// FastAPI-backed cookie session authentication.
// ==========================================

import { AuthResponse, LoginCredentials, User } from "@/lib/types";
import { apiClient } from "@/lib/api/client";

/**
 * Login with email and password.
 * The backend sets an HttpOnly session cookie on success.
 */
export async function login(
  credentials: LoginCredentials
): Promise<AuthResponse> {
  return apiClient<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

/** Logout from the current backend session. */
export async function logout(): Promise<void> {
  await apiClient<void>("/auth/logout", {
    method: "POST",
  });
}

/** Get current user session. */
export async function getUser(): Promise<User | null> {
  try {
    return await apiClient<User>("/auth/me");
  } catch {
    return null;
  }
}
