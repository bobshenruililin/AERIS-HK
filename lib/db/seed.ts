import { seedKowloonWestBuildings } from "./queries";

async function main() {
  const result = await seedKowloonWestBuildings();
  if (!result.ok) {
    console.error("seed failed", result.error);
    process.exit(1);
  }
  console.log(`seeded ${result.count} Kowloon West buildings`);
}

void main();
