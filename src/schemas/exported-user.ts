import { z } from "zod";

export const ExportedUser = z.object({
  clerk: z.string(),
  workos: z.string(),
});

export type ExportedUser = z.infer<typeof ExportedUser>;
