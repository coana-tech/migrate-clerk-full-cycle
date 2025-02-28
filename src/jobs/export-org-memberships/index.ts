import dotenv from "dotenv";
import Queue from "p-queue";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  OrganizationMembership,
  RateLimitExceededException,
  WorkOS,
} from "@workos-inc/node";

import { ClerkExportedOrganization } from "../../schemas/clerk-exported-organization";
import { ndjsonStream } from "../../ndjson-stream";
import { sleep } from "../../sleep";
import { ClerkExportedOrgMembership } from "../../schemas/clerk-exported-org-memberships";
import { ExportedUser } from "../../schemas/exported-user";

dotenv.config();

const USE_LOCAL_API = (process.env.NODE_ENV ?? "").startsWith("dev");

const workos = new WorkOS(
  process.env.WORKOS_SECRET_KEY,
  USE_LOCAL_API
    ? {
        https: false,
        apiHostname: "localhost",
        port: 7000,
      }
    : {}
);

async function createOrganization(
  exportedOrgMembership: ClerkExportedOrgMembership,
  organizationId: string,
  workOsUserId: string
) {
  try {
    const roleSlug =
      exportedOrgMembership.role === "org:guest"
        ? "guest"
        : exportedOrgMembership.role ?? "member";

    console.log(organizationId, workOsUserId, roleSlug);
    return await workos.userManagement.createOrganizationMembership({
      organizationId: organizationId,
      userId: workOsUserId,
      roleSlug,
    });
  } catch (error) {
    if (error instanceof RateLimitExceededException) {
      throw error;
    }
  }
}

async function processLine(
  line: unknown,
  recordNumber: number,
  organizationId: string,
  exportedUsers: ExportedUser[]
): Promise<boolean> {
  const exportedOrgMembership = ClerkExportedOrgMembership.parse(line);

  if (
    !exportedOrgMembership.object ||
    exportedOrgMembership.object !== "organization_membership"
  ) {
    console.log(
      `(${recordNumber}) Skipping non-org child record ${exportedOrgMembership.id}`
    );
    return false;
  }

  if (
    !exportedOrgMembership.public_user_data ||
    !exportedOrgMembership.organization
  ) {
    console.error(
      `(${recordNumber}) Skipping organization membership without user or organization ${exportedOrgMembership.id}`
    );
    return false;
  }

  const workOsUserId = exportedUsers.find(
    (user) => user.clerk === exportedOrgMembership.public_user_data?.user_id
  )?.workos;

  if (!workOsUserId) {
    console.error(
      `(${recordNumber}) Could not find workos user for clerk user ${exportedOrgMembership.public_user_data.user_id}`
    );
    return false;
  }

  const workOsOrganizationMembership = await createOrganization(
    exportedOrgMembership,
    organizationId,
    workOsUserId
  );
  if (!workOsOrganizationMembership) {
    console.error(
      `(${recordNumber}) Could not find or create organization member ship for user ${exportedOrgMembership.public_user_data.user_id} in clerk organization ${exportedOrgMembership.organization.id}`
    );
    return false;
  }

  console.log(
    `(${recordNumber}) Imported Clerk organization membership for user ${exportedOrgMembership.public_user_data.user_id} in clerk org ${exportedOrgMembership.organization.id} as WorkOS organization membership ${workOsOrganizationMembership.id} in workos organisation${organizationId}`
  );

  return true;
}

const DEFAULT_RETRY_AFTER = 10;
const MAX_CONCURRENT_USER_IMPORTS = 10;

async function main() {
  const {
    orgExport: orgMembershipPath,
    workosOrgid: organizationId,
    exportedUsers: exportedUsersPath,
  } = await yargs(hideBin(process.argv))
    .option("org-export", {
      type: "string",
      required: true,
      description: "Path to the organization received from Clerk support.",
    })
    .option("workos-orgid", {
      type: "string",
      required: true,
      description: "WorkOS organization ID to import into.",
    })
    .option("exported-users", {
      type: "string",
      required: true,
      description:
        "Path to the exported users in step -> clerk-exported-users.",
    })
    .version(false)
    .parse();

  const queue = new Queue({ concurrency: MAX_CONCURRENT_USER_IMPORTS });

  let recordCount = 0;
  let completedCount = 0;

  let exportedUsers: ExportedUser[] = [];

  try {
    for await (const line of ndjsonStream(exportedUsersPath)) {
      exportedUsers.push(ExportedUser.parse(line));
    }
  } catch (error) {
    console.log("Error reading exported users file");
    console.error(error);
    return;
  }

  try {
    for await (const line of ndjsonStream(orgMembershipPath)) {
      recordCount++;
      await queue.onSizeLessThan(MAX_CONCURRENT_USER_IMPORTS);

      const recordNumber = recordCount;
      const enqueueTask = () =>
        queue
          .add(async () => {
            const successful = await processLine(
              line,
              recordNumber,
              organizationId,
              exportedUsers
            );
            if (successful) {
              completedCount++;
            }
          })
          .catch(async (error: unknown) => {
            console.log("error processing line", error);
            if (!(error instanceof RateLimitExceededException)) {
              throw error;
            }

            const retryAfter = (error.retryAfter ?? DEFAULT_RETRY_AFTER) + 1;
            console.warn(
              `Rate limit exceeded. Pausing queue for ${retryAfter} seconds.`
            );

            queue.pause();
            enqueueTask();

            await sleep(retryAfter * 1000);

            queue.start();
          });
      enqueueTask();
    }

    await queue.onIdle();

    console.log(
      `Done importing. ${completedCount} of ${recordCount} records imported.`
    );
  } finally {
  }
}

export default function start() {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
