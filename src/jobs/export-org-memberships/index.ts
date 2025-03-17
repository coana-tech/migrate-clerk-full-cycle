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
import { parseArgs } from "../../parseArgs";
import { ExportedOrganization } from "../../schemas/export-organizations";

type RoleTranslationType = {
  [key: string]: string;
};

// replace with own role translation
const roleTranslation: RoleTranslationType = {
  admin: "admin",
  basic_member: "member",
  "org:guest": "guest",
};

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

async function createOrganizationMembership(
  exportedOrgMembership: ClerkExportedOrgMembership,
  workOsUserId: string,
  workOsOrganizationId: string
) {
  try {
    const roleSlug =
      roleTranslation[exportedOrgMembership.role ?? "basic_member"];

    return await workos.userManagement.createOrganizationMembership({
      organizationId: workOsOrganizationId,
      userId: workOsUserId,
      roleSlug,
    });
  } catch (error) {
    console.log(error, exportedOrgMembership);
    if (error instanceof RateLimitExceededException) {
      throw error;
    }
  }
}

async function processLine(
  line: unknown,
  recordNumber: number,
  exportedUsers: ExportedUser[],
  exportedOrganizations: ExportedOrganization[]
): Promise<boolean> {
  try {
    if (typeof line === "string") {
      // console.log(`skip line ${recordNumber} because it is a string`);
      return false;
    }
    const exportedOrgMembership = ClerkExportedOrgMembership.parse(line);

    if (
      !exportedOrgMembership.object ||
      exportedOrgMembership.object !== "organization_membership"
    ) {
      // console.log(
      //   `(${recordNumber}) Skipping non-org child record ${exportedOrgMembership.id}`
      // );
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

    const workOsOrganizationId = exportedOrganizations.find(
      (org) => org.clerk === exportedOrgMembership.organization?.id
    )?.workos;

    if (!workOsOrganizationId) {
      console.error(
        `(${recordNumber}) Could not find workos organization for clerk organization ${exportedOrgMembership.organization.id}`
      );
      return false;
    }

    const workOsOrganizationMembership = await createOrganizationMembership(
      exportedOrgMembership,
      workOsUserId,
      workOsOrganizationId
    );
    if (!workOsOrganizationMembership) {
      console.error(
        `(${recordNumber}) Could not find or create organization member ship for user clerkId: ${exportedOrgMembership.public_user_data.user_id} workOSId: ${workOsUserId} in clerk organization ${exportedOrgMembership.organization.id}`
      );
      return false;
    }

    console.log(
      `(${recordNumber}) Imported Clerk organization membership for user ${exportedOrgMembership.public_user_data.user_id} in clerk org ${exportedOrgMembership.organization.id} as WorkOS organization membership ${workOsOrganizationMembership.id} in workos organisation ${workOsOrganizationId}`
    );

    return true;
  } catch (error) {
    console.error(`Error parsing line ${recordNumber}:`, error);
    return false;
  }
}

const DEFAULT_RETRY_AFTER = 10;
const MAX_CONCURRENT_USER_IMPORTS = 10;

async function main() {
  const args = process.argv.slice(2);
  const { clerkOrgId } = parseArgs(args);

  if (!clerkOrgId) {
    console.error("Error: --clerkOrgId argument is required.");
    process.exit(1);
  }

  const queue = new Queue({ concurrency: MAX_CONCURRENT_USER_IMPORTS });

  let recordCount = 0;
  let completedCount = 0;

  let exportedUsers: ExportedUser[] = [];
  let exportOrganizations: ExportedOrganization[] = [];

  try {
    for await (const line of ndjsonStream("./users_output.json")) {
      exportedUsers.push(ExportedUser.parse(line));
    }
  } catch (error) {
    console.error(error);
    return;
  }

  try {
    for await (const line of ndjsonStream("./orgs_output.json")) {
      exportOrganizations.push(ExportedOrganization.parse(line));
    }
  } catch (error) {
    console.error(error);
    return;
  }

  try {
    for await (const line of ndjsonStream(
      `./src/files/memberships/${clerkOrgId}.json`
    )) {
      recordCount++;
      await queue.onSizeLessThan(MAX_CONCURRENT_USER_IMPORTS);

      const recordNumber = recordCount;
      const enqueueTask = () =>
        queue
          .add(async () => {
            const successful = await processLine(
              line,
              recordNumber,
              exportedUsers,
              exportOrganizations
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
      `Done importing. ${completedCount} organization membership(s) imported.`
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
