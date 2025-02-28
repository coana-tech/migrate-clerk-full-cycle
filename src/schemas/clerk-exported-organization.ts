import { z } from "zod";

export const ClerkExportedOrganization = z.object({
  object: z.string().nullish(),
  id: z.string(),
  name: z.string().nullish(),
  slug: z.string().nullish(),
  image_url: z.string().nullish(),
  has_image: z.boolean().nullish(),
  max_allowed_memberships: z.number().nullish(),
  admin_delete_enabled: z.boolean().nullish(),
  public_metadata: z.record(z.unknown()).nullish(),
  private_metadata: z.record(z.unknown()).nullish(),
  created_by: z.string().nullish(),
  created_at: z.number().nullish(),
  updated_at: z.number().nullish(),
  logo_url: z.string().nullish(),
});

export type ClerkExportedOrganization = z.infer<
  typeof ClerkExportedOrganization
>;
