import { z } from "zod";

export const ExportedOrganization = z.object({
  clerk: z.string(),
  workos: z.string(),
});

export type ExportedOrganization = z.infer<typeof ExportedOrganization>;
