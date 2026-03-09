import { defineConfig } from "prisma/config";
import { config } from "dotenv";

// Só carrega o .env se DATABASE_URL ainda não estiver no ambiente
if (!process.env["DATABASE_URL"]) {
  config();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"]!,
  },
});
