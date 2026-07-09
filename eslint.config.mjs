import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: ["node_modules/**", ".next/**", "prisma/migrations/**"],
  },
  {
    rules: {
      // The standards ban console in app code; scripts under prisma/ and
      // scripts/ are cron jobs that log to files and migrate incrementally.
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["prisma/**", "scripts/**", "tests/**"],
    rules: { "no-console": "off" },
  },
];
