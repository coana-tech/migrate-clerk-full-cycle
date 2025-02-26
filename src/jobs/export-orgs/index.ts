import dotenv from "dotenv";
import Queue from "p-queue";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { RateLimitExceededException, WorkOS } from "@workos-inc/node";

import { ClerkExportedOrganization } from "../clerk-exported-organization";
import { ndjsonStream } from "../../ndjson-stream";
import { sleep } from "../../sleep";
import * as fs from "fs";

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

async function findOrCreateUser(
  exportedOrganization: ClerkExportedOrganization,
  processMultiEmail: boolean
) {
  return true;

  if (!exportedOrganization.name) {
    console.log(
      `Skipping organization without a name ${exportedOrganization.id}`
    );
    return false;
  }

  try {
    return await workos.organizations.createOrganization({
      name: exportedOrganization.name ?? "",
    });
  } catch (error) {
    if (error instanceof RateLimitExceededException) {
      throw error;
    }

    const matchingUsers = await workos.userManagement.listUsers({
      email: primaryEmail.email_address.toLowerCase(),
    });
    if (matchingUsers.data.length === 1) {
      return matchingUsers.data[0];
    }
  }
}

async function processLine(
  line: unknown,
  recordNumber: number,
  processMultiEmail: boolean
): Promise<boolean> {
  const exportedOrganization = ClerkExportedOrganization.parse(line);

  if (
    !exportedOrganization.object ||
    exportedOrganization.object !== "organization"
  ) {
    console.log(
      `(${recordNumber}) Skipping non-user child record ${exportedOrganization.id}`
    );
    return false;
  }

  const workOsOrganization = await findOrCreateUser(
    exportedOrganization,
    processMultiEmail
  );
  if (!workOsOrganization) {
    console.error(
      `(${recordNumber}) Could not find or create user ${exportedOrganization.id}`
    );
    return false;
  }

  console.log(
    `(${recordNumber}) Imported Clerk organization ${exportedOrganization.name} ${exportedOrganization.id} as WorkOS organization ${workOsOrganization}`
  );

  // Data which will be appended to the file.
  let newData = `{"clerk":"${exportedOrganization.id}","workos":"${workOsOrganization}"},`;
  // Append old and new id entry.
  fs.appendFile("Output.json", newData, (err: any) => {
    // In case of a error throw err.
    if (err) console.error(err);
  });

  return true;
}

const DEFAULT_RETRY_AFTER = 10;
const MAX_CONCURRENT_USER_IMPORTS = 10;

async function main() {
  const { orgExport: userFilePath, processMultiEmail } = await yargs(
    hideBin(process.argv)
  )
    .option("org-export", {
      type: "string",
      required: true,
      description:
        "Path to the user and password export received from Clerk support.",
    })
    .option("process-multi-email", {
      type: "boolean",
      default: false,
      description:
        "In the case of a user with multiple email addresses, whether to use the first email provided or to skip processing the user.",
    })
    .version(false)
    .parse();

  const queue = new Queue({ concurrency: MAX_CONCURRENT_USER_IMPORTS });

  let recordCount = 0;
  let completedCount = 0;

  try {
    for await (const line of ndjsonStream(userFilePath)) {
      recordCount++;
      await queue.onSizeLessThan(MAX_CONCURRENT_USER_IMPORTS);

      const recordNumber = recordCount;
      const enqueueTask = () =>
        queue
          .add(async () => {
            const successful = await processLine(
              line,
              recordNumber,
              processMultiEmail
            );
            if (successful) {
              completedCount++;
            }
          })
          .catch(async (error: unknown) => {
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
