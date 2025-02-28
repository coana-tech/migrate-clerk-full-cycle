import { z } from "zod";

export const ClerkExportedOrgMembership = z.object({
  object: z.string().nullish(),
  id: z.string(),
  role: z.string().nullish(),
  organization: z
    .object({
      object: z.string().nullish(),
      id: z.string(),
    })
    .nullish(),
  public_user_data: z
    .object({
      user_id: z.string(),
      identifier: z.string(),
    })
    .nullish(),
});

export type ClerkExportedOrgMembership = z.infer<
  typeof ClerkExportedOrgMembership
>;
