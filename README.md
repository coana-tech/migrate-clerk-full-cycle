# migrate-clerk-users

Tool for importing Clerk users into WorkOS, including setting password hashes.

For more information on migrating from Clerk to WorkOS, refer to [the docs](https://workos.com/docs/migrate/clerk).

## Usage

```bash
CLERK_SECRET_KEY=sk_test_123 WORKOS_SECRET_KEY=sk_test_123 OUTPUT_PATH_USERS=./users_output.json OUTPUT_PATH_ORGANIZATIONS=./orgs_output.json npx migrate-full-cycle
```

Example output

```
% WORKOS_SECRET_KEY=sk_test_123 npx github:workos/migrate-clerk-users \
  --user-export example-input.json
Need to install the following packages:
  github:workos/migrate-clerk-users
Ok to proceed? (y) y
Fetched 15 users.
Fetched 5 organizations.
(1) Skipping non-user child record idn_0123
(2) Skipping non-user child record idn_0123
(3) Skipping non-user child record idn_0123
(4) Imported Clerk user user_0123 as WorkOS user user_0123
```

## Input file format

This tool consumes the data from the clerk API, which includes hashed passwords.

Note that the script will exit with an error if any custom password hashes are present.

Note that the script will fail if the user roles are not created in WorkOS
