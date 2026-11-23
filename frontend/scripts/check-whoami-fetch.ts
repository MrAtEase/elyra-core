import { createWhoamiFetchOptions } from "../lib/auth/whoamiFetch";

const options = createWhoamiFetchOptions();

if (options.credentials !== "include") {
  throw new Error("whoami fetch must include credentials");
}

if (options.cache !== "no-store") {
  throw new Error("whoami fetch should opt out of cache");
}

console.log("whoami fetch options include credentials: include and cache: no-store");
