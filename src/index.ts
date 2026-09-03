import { createApp } from "./app";
import { env } from "./config/env";
import { logAuthRuntimeSafely } from "./services/auth.service";
import { provisionPlatformAdmins } from "./services/platform-admin.service";
import { logEncryptionRuntimeSafely } from "./utils/secret-encryption";

const app = createApp();

app.listen(env.port, () => {
  console.log(`Site Yönetim API http://localhost:${env.port}`);
  logAuthRuntimeSafely();
  logEncryptionRuntimeSafely();
  void provisionPlatformAdmins().catch((error) => {
    console.error("Platform admin bootstrap başarısız:", error);
  });
});
