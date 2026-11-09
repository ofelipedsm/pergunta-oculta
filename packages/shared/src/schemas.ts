import { z } from 'zod';
import { CATEGORIES, LIMITS } from './types';
import { splitWords } from './normalize';

const name = z.string().trim().min(1).max(LIMITS.nameMax);
const roomCode = z
  .string()
  .trim()
  .toUpperCase()
  .length(LIMITS.roomCodeLength)
  .regex(/^[A-Z]+$/);

export const createRoomSchema = z.object({ name });

export const joinRoomSchema = z.object({
  code: roomCode,
  name: name.optional(),
  playerId: z.string().max(64).optional(),
  token: z.string().max(128).optional(),
});

export const roomConfigSchema = z
  .object({
    mode: z.enum(['bank', 'master', 'mixed']),
    categories: z.array(z.enum(CATEGORIES)).min(1),
    levels: z.array(z.union([z.literal(1), z.literal(2), z.literal(3)])).min(1),
    bonusEnabled: z.boolean(),
    bonusMinHidden: z.number().int().min(1).max(15),
    turnTimeoutSec: z.number().int().min(15).max(300),
    writeTimeoutSec: z.number().int().min(30).max(600),
    judgeTimeoutSec: z.number().int().min(10).max(120),
    endBy: z.enum(['score', 'rounds']),
    target: z.number().int().min(1).max(500),
  })
  .partial();

export const kickSchema = z.object({ playerId: z.string().max(64) });

export const masterSubmitSchema = z.object({
  question: z
    .string()
    .trim()
    .max(LIMITS.questionMaxChars)
    .refine(
      (q) => {
        const n = splitWords(q).length;
        return n >= LIMITS.questionMinWords && n <= LIMITS.questionMaxWords;
      },
      { message: `A pergunta precisa ter de ${LIMITS.questionMinWords} a ${LIMITS.questionMaxWords} palavras` },
    ),
  answers: z.array(z.string().trim().min(1).max(LIMITS.answerMax)).min(1).max(LIMITS.answersMax),
  category: z.string().trim().max(30).optional(),
});

export const openWordSchema = z.object({ index: z.number().int().min(0).max(LIMITS.questionMaxWords) });
export const guessSchema = z.object({ text: z.string().trim().min(1).max(LIMITS.guessMax) });
export const judgeSchema = z.object({ accept: z.boolean() });
export const bonusSchema = z.object({ text: z.string().trim().min(1).max(LIMITS.questionMaxChars) });

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type JoinRoomInput = z.infer<typeof joinRoomSchema>;
export type RoomConfigInput = z.infer<typeof roomConfigSchema>;
export type MasterSubmitInput = z.infer<typeof masterSubmitSchema>;
