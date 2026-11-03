import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().trim().email().max(254).toLowerCase(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(254).toLowerCase(),
  password: z.string().min(1),
  turnstileToken: z.string().optional(),
});

export const refreshSchema = z.object({
  // refresh token comes from httpOnly cookie, no body needed
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(254).toLowerCase(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
