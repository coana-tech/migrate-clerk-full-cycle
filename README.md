# migrate-full-cycle

Tool for importing Clerk users, organizations and organization memberships into WorkOS, including setting password hashes.

This tool is a forked repo from [migrate-clerk-users](https://github.com/workos/migrate-clerk-users)

For more information on migrating from Clerk to WorkOS, refer to [the docs](https://workos.com/docs/migrate/clerk).

## Usage

```bash
CLERK_SECRET_KEY=sk_test_123 WORKOS_SECRET_KEY=sk_test_123 npx migrate-full-cycle
```

Example output

```
Fetched 15 users.
Fetched 5 organizations.
Running: npx migrate-clerk-users --output=./users_output.json --WORKOS_SECRET_KEY=sk_test_123
(29) Imported Clerk user user_xxx01 as WorkOS user user_xxx01
(4) Imported Clerk user user_xxx02 as WorkOS user user_xxx02
(35) Imported Clerk user user_xxx03 as WorkOS user user_xxx03
(31) Imported Clerk user user_xxx04 as WorkOS user user_xxx04
(21) Imported Clerk user user_xxx05 as WorkOS user user_xxx05
Done importing. 5 users imported.

Running: npx migrate-clerk-orgs --output=./orgs_output.json --WORKOS_SECRET_KEY=sk_test_123
(2) Imported Clerk organization test-org-01 org_xxxx01 as WorkOS organization org_xxxx01
(3) Imported Clerk organization test-org-02 org_xxxx02 as WorkOS organization org_xxxx02
Done importing. 2 organizations imported.

Running: npx migrate-clerk-org-memberships --clerkOrgId=org_xxxx01 --WORKOS_SECRET_KEY=sk_test_123
(9) Imported Clerk organization membership for user user_xxx01 in clerk org org_xxxx01 as WorkOS organization membership om_xxxx01 in workos organisation org_xxxx01
(2) Imported Clerk organization membership for user user_xxx01 in clerk org org_xxxx01 as WorkOS organization membership om_xxxx02 in workos organisation org_xxxx01
Done importing. 2 organization membership(s) imported.

Running: npx migrate-clerk-org-memberships --clerkOrgId=org_xxxx02 --WORKOS_SECRET_KEY=sk_test_123
(7) Imported Clerk organization membership for user user_xxx01 in clerk org org_xxxx02 as WorkOS organization membership om_xxxx01 in workos organisation org_xxxx02
Done importing. 1 organization membership(s) imported.

Migration cycle completed successfully.
```

## Script sequence

The script runs in the following sequence

- Users are created
- Organizations are created
- Organization membership are created based on the previous steps

## Input file format

This tool consumes the data from the clerk API, which includes hashed passwords.

Note that the script will exit with an error if any custom password hashes are present.

Note that the script will fail if the user roles are not created in WorkOS
