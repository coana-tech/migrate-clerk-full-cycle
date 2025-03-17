import dotenv from "dotenv";
import Queue from "p-queue";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { RateLimitExceededException, WorkOS } from "@workos-inc/node";

import { ClerkExportedOrganization } from "../../schemas/clerk-exported-organization";
import { ndjsonStream } from "../../ndjson-stream";
import { sleep } from "../../sleep";
import * as fs from "fs";
import { parseArgs } from "../../parseArgs";
import path from "path";

dotenv.config();

const USE_LOCAL_API = (process.env.NODE_ENV ?? "").startsWith("dev");

export type MigratedOrganizations = {
  clerk: string;
  workos: string;
};

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
  exportedOrganization: ClerkExportedOrganization
) {
  if (!exportedOrganization.name) {
    console.log(
      `Skipping organization without a name ${exportedOrganization.id}`
    );
    return false;
  }

  try {
    const existingOrganization =
      await workos.organizations.getOrganizationByExternalId(
        exportedOrganization.id
      );

    if (existingOrganization) {
      return existingOrganization;
    }
  } catch (error) {
    if (error instanceof RateLimitExceededException) {
      throw error;
    }
  }

  try {
    return await workos.organizations.createOrganization({
      name: exportedOrganization.name ?? "",
      externalId: exportedOrganization.id,
    });
  } catch (error) {
    if (error instanceof RateLimitExceededException) {
      throw error;
    }
  }
}

async function processLine(
  line: unknown,
  recordNumber: number
): Promise<MigratedOrganizations | boolean> {
  const exportedOrganization = ClerkExportedOrganization.parse(line);

  if (
    !exportedOrganization.object ||
    exportedOrganization.object !== "organization"
  ) {
    // console.log(
    //   `(${recordNumber}) Skipping non-org child record ${exportedOrganization.id}`
    // );
    return false;
  }

  const workOsOrganization = await createOrganization(exportedOrganization);
  if (!workOsOrganization) {
    console.error(
      `(${recordNumber}) Could not create organization ${exportedOrganization.id}`
    );
    return false;
  }

  console.log(
    `(${recordNumber}) Imported Clerk organization ${exportedOrganization.name} ${exportedOrganization.id} as WorkOS organization ${workOsOrganization.id}`
  );

  return {
    clerk: workOsOrganization.externalId ?? "",
    workos: workOsOrganization.id,
  };
}

const DEFAULT_RETRY_AFTER = 10;
const MAX_CONCURRENT_ORG_IMPORTS = 10;

async function main() {
  const args = process.argv.slice(2);
  const { output } = parseArgs(args);
  if (!output) {
    console.error("Error: --output argument is required.");
    process.exit(1);
  }

  const queue = new Queue({ concurrency: MAX_CONCURRENT_ORG_IMPORTS });

  let recordCount = 0;
  let completedCount = 0;

  const organizations: MigratedOrganizations[] = [];

  try {
    const outputPath = path.resolve(output); // Ensure absolute path
    for await (const line of ndjsonStream("./src/files/organizations.json")) {
      recordCount++;
      await queue.onSizeLessThan(MAX_CONCURRENT_ORG_IMPORTS);

      const recordNumber = recordCount;
      const enqueueTask = () =>
        queue
          .add(async () => {
            const successful = await processLine(line, recordNumber);
            if (successful !== false) {
              organizations.push(successful as MigratedOrganizations);
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

    fs.writeFile(
      outputPath,
      JSON.stringify(organizations, null, 2),
      (err: any) => {
        // In case of a error throw err.
        if (err) console.error(err);
      }
    );

    console.log(`Done importing. ${completedCount} organizations imported.`);
  } finally {
  }
}

export default function start() {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
