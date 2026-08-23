import { createApp } from "./app";
import { env } from "./config/env";
import { provisionPlatformAdmins } from "./services/platform-admin.service";

const app = createApp();

app.listen(env.port, () => {
  console.log(`Site Yönetim API http://localhost:${env.port}`);
  void provisionPlatformAdmins().catch((error) => {
    console.error("Platform admin bootstrap başarısız:", error);
  });
});
