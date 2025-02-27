async function main() {
  console.log("Exporting org memberships...");
}

export default function start() {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
