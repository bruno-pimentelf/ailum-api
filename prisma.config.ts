import { defineConfig } from "prisma/config";
import { config } from "dotenv";

config(); // carrega .env antes do Prisma resolver as variáveis

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"]!,
  },
});
