import path from "path";
import { config } from "dotenv";
import { serve } from "@hono/node-server";
import { createApp } from "./app";

config({ path: path.join(process.cwd(), ".env.local") });
config({ path: path.join(process.cwd(), ".env") });

const port = Number(process.env.PORT || process.env.BACKEND_PORT || 4000);
const app = createApp();

serve({ fetch: app.fetch, port }, info => {
  console.log(`Recovery OS API  http://localhost:${info.port}`);
});
