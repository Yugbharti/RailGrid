import { z } from 'zod';

export const trainTypeSchema = z.enum([
  'RAJDHANI',
  'SHATABDI',
  'VANDE_BHARAT',
  'DURONTO',
  'EXPRESS',
  'MAIL',
  'PASSENGER',
  'SUPERFAST',
]);
export type TrainType = z.infer<typeof trainTypeSchema>;

export const runStatusSchema = z.enum(['SCHEDULED', 'RUNNING', 'ARRIVED', 'CANCELLED']);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const liveStatusSchema = z.object({
  trainNumber: z.string(),
  delayMinutes: z.number().nullable(),
  currentStation: z.string().nullable(),
  nextStation: z.string().nullable(),
  updatedAt: z.string().datetime(),
  stale: z.boolean().default(false),
});
export type LiveStatus = z.infer<typeof liveStatusSchema>;
