import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    fileParallelism: false, // tests share one Postgres test database
    env: {
      // Never touch the dev database from tests.
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://kitpier@127.0.0.1:5433/kitpier_test",
      PAYPAL_MERCHANT_ID: "TESTMERCHANT",
      PAYPAL_API_BASE: "https://api-m.sandbox.paypal.com",
      // The app's days are UTC; fixtures use the database's current_date. Pin the test sessions to UTC so the two agree
      // at any local hour (otherwise date tests fail between local midnight and the UTC one).
      PGOPTIONS: "-c TimeZone=UTC",
    },
  },
});
