interface Arguments {
  output: string;
  WORKOS_SECRET_KEY: string;
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
    }
  }

  if (!parsedArgs.output || !parsedArgs.WORKOS_SECRET_KEY) {
    console.error(
      "Error: --output and --WORKOS_SECRET_KEY arguments are required."
    );
    process.exit(1);
  }

  return parsedArgs;
}
