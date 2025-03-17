import dotenv from "dotenv";
import Queue from "p-queue";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { RateLimitExceededException, User, WorkOS } from "@workos-inc/node";

import { ClerkExportedUser } from "../../schemas/clerk-exported-user";
import { ndjsonStream } from "../../ndjson-stream";
import { sleep } from "../../sleep";
import * as fs from "fs";
import path from "path";
import { parseArgs } from "../../parseArgs";

dotenv.config();

type MigratedUser = {
  clerk: string;
  workos: string;
};

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

async function findOrCreateUser(exportedUser: ClerkExportedUser) {
  const emailAddresses = exportedUser.email_addresses;
  const primaryEmail = emailAddresses?.find(
    (email) => email?.id === exportedUser.primary_email_address_id
  );

  if (!primaryEmail) {
    console.error(`Primary email not found for ${exportedUser.id}`);
    return false;
  }

  try {
    const passwordOptions = exportedUser.password_digest
      ? {
          passwordHash: exportedUser.password_digest,
          passwordHashType: "bcrypt" as const,
        }
      : {};

    return await workos.userManagement.createUser({
      email: primaryEmail.email_address,
      firstName: exportedUser.first_name ?? undefined,
      lastName: exportedUser.last_name ?? undefined,
      externalId: exportedUser.id,
      ...passwordOptions,
    });
  } catch (error) {
    if (error instanceof RateLimitExceededException) {
      throw error;
    }

    const matchingUsers = await workos.userManagement.listUsers({
      email: primaryEmail.email_address.toLowerCase(),
    });
    // If there is a single user with the same email address, update the external ID.
    if (matchingUsers.data.length === 1) {
      try {
        const updatedUser = await workos.userManagement.updateUser({
          userId: matchingUsers.data[0].id,
          externalId: exportedUser.id,
        });
        return updatedUser;
      } catch (error) {
        console.error(
          `Error updating user ${matchingUsers.data[0].id}:`,
          error
        );
        return false;
      }
    }
  }
}

async function processLine(
  line: unknown,
  recordNumber: number
): Promise<MigratedUser | boolean> {
  const exportedUser = ClerkExportedUser.parse(line);

  if (!exportedUser.object || exportedUser.object !== "user") {
    // console.log(
    //   `(${recordNumber}) Skipping non-user child record ${exportedUser.id}`
    // );
    return false;
  }

  const workOsUser = await findOrCreateUser(exportedUser);
  if (!workOsUser) {
    console.error(
      `(${recordNumber}) Could not find or create user ${exportedUser.id}`
    );
    return false;
  }

  console.log(
    `(${recordNumber}) Imported Clerk user ${exportedUser.id} as WorkOS user ${workOsUser.id}`
  );

  return {
    clerk: workOsUser.externalId ?? "",
    workos: workOsUser.id,
  };
}

const DEFAULT_RETRY_AFTER = 10;
const MAX_CONCURRENT_USER_IMPORTS = 10;

async function main() {
  const args = process.argv.slice(2);
  const { output } = parseArgs(args);
  if (!output) {
    console.error("Error: --output argument is required.");
    process.exit(1);
  }

  const queue = new Queue({ concurrency: MAX_CONCURRENT_USER_IMPORTS });

  let recordCount = 0;
  let completedCount = 0;

  const users: MigratedUser[] = [];

  try {
    const outputPath = path.resolve(output); // Ensure absolute path
    for await (const line of ndjsonStream("./src/files/users.json")) {
      recordCount++;
      await queue.onSizeLessThan(MAX_CONCURRENT_USER_IMPORTS);

      const recordNumber = recordCount;
      const enqueueTask = () =>
        queue
          .add(async () => {
            const successful = await processLine(line, recordNumber);
            if (successful !== false) {
              users.push(successful as MigratedUser);
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

    fs.writeFile(outputPath, JSON.stringify(users, null, 2), (err: any) => {
      // In case of a error throw err.
      if (err) console.error(err);
    });
    console.log(`Done importing. ${completedCount} users imported.`);
  } finally {
  }
}

export default function start() {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
