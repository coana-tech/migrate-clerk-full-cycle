interface Arguments {
  WORKOS_SECRET_KEY: string;
  output?: string;
  clerkOrgId?: string;
}

export function parseArgs(args: string[]): Arguments {
  const parsedArgs: Arguments = { output: "", WORKOS_SECRET_KEY: "" };

  for (const arg of args) {
    if (arg.startsWith("--output=")) {
      parsedArgs.output = arg.substring("--output=".length);
    } else if (arg.startsWith("--WORKOS_SECRET_KEY=")) {
      parsedArgs.WORKOS_SECRET_KEY = arg.substring(
        "--WORKOS_SECRET_KEY=".length
      );
    } else if (arg.startsWith("--clerkOrgId=")) {
      parsedArgs.clerkOrgId = arg.substring("--clerkOrgId=".length);
    }
  }

  if (!parsedArgs.WORKOS_SECRET_KEY) {
    console.error("Error: ---WORKOS_SECRET_KEY argument is required.");
    process.exit(1);
  }

  return parsedArgs;
}
