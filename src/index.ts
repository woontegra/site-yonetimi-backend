import { createApp } from "./app";
import { env } from "./config/env";

const app = createApp();

app.listen(env.port, () => {
  console.log(`Site Yönetim API http://localhost:${env.port}`);
});
