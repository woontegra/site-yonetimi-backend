import { env } from "../config/env";
import { HttpError } from "../utils/httpError";
import { platformEmailService } from "./email/platform-email.service";
import { MetaWhatsAppProvider } from "./meta-whatsapp-provider";
import { whatsAppIntegrationService } from "./whatsapp-integration.service";

export type MessageProviderSendInput = {
  toPhone: string;
  body: string;
  channel: "WHATSAPP" | "SMS";
  whatsAppTemplate?: {
    name: string;
    language: string;
    bodyParameters: string[];
  };
};

export type MessageProviderSendResult = {
  status: "SENT" | "FAILED";
  provider: string;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  sentAt?: Date | null;
};

export interface MessageProvider {
  readonly name: string;
  isAvailable(): boolean;
  send(input: MessageProviderSendInput): Promise<MessageProviderSendResult>;
}

export type WhatsAppProviderMode = "mock" | "meta";

function isDevelopmentEnv(): boolean {
  return env.nodeEnv !== "production";
}

export function getWhatsAppProviderMode(): WhatsAppProviderMode {
  return env.whatsappProviderMode;
}

class MockWhatsAppProvider implements MessageProvider {
  readonly name = "mock-whatsapp";

  isAvailable(): boolean {
    return isDevelopmentEnv();
  }

  async send(_input: MessageProviderSendInput): Promise<MessageProviderSendResult> {
    if (!this.isAvailable()) {
      return {
        status: "FAILED",
        provider: this.name,
        errorMessage: "WhatsApp sağlayıcısı bağlı değil.",
      };
    }
    return {
      status: "SENT",
      provider: this.name,
      providerMessageId: `mock-wa-${Date.now()}`,
      sentAt: new Date(),
    };
  }
}

class MockSmsProvider implements MessageProvider {
  readonly name = "mock-sms";

  isAvailable(): boolean {
    return isDevelopmentEnv();
  }

  async send(_input: MessageProviderSendInput): Promise<MessageProviderSendResult> {
    if (!this.isAvailable()) {
      return {
        status: "FAILED",
        provider: this.name,
        errorMessage: "SMS sağlayıcısı bağlı değil.",
      };
    }
    return {
      status: "SENT",
      provider: this.name,
      providerMessageId: `mock-sms-${Date.now()}`,
      sentAt: new Date(),
    };
  }
}

const mockWhatsAppProvider = new MockWhatsAppProvider();
const smsProvider = new MockSmsProvider();

export function getMessageProvider(channel: "WHATSAPP" | "SMS"): MessageProvider {
  if (channel === "WHATSAPP") return mockWhatsAppProvider;
  return smsProvider;
}

export async function resolveWhatsAppProvider(tenantId: string): Promise<MessageProvider> {
  const mode = getWhatsAppProviderMode();
  if (mode === "mock") {
    return mockWhatsAppProvider;
  }

  const integration = await whatsAppIntegrationService.getActiveIntegration(tenantId);
  if (!integration || integration.connectionStatus !== "CONNECTED") {
    throw new HttpError(400, "WhatsApp bağlantısı kurulmamış.");
  }

  const { accessToken } = await whatsAppIntegrationService.getDecryptedToken(tenantId);
  return new MetaWhatsAppProvider({
    phoneNumberId: integration.phoneNumberId,
    accessToken,
  });
}

export async function getIntegrationStatuses(tenantId?: string) {
  const whatsappMode = getWhatsAppProviderMode();
  const emailStatus = await platformEmailService.getPublicStatus();

  let whatsappStatus: {
    connected: boolean;
    provider: string;
    label: string;
    isMock: boolean;
    connectionStatus?: string;
    displayPhoneNumber?: string | null;
  };

  if (whatsappMode === "mock") {
    whatsappStatus = {
      connected: mockWhatsAppProvider.isAvailable(),
      provider: mockWhatsAppProvider.name,
      label: mockWhatsAppProvider.isAvailable() ? "Geliştirme (mock)" : "Bağlı değil",
      isMock: true,
    };
  } else if (tenantId) {
    const integration = await whatsAppIntegrationService.getActiveIntegration(tenantId);
    const connected = integration?.connectionStatus === "CONNECTED";
    whatsappStatus = {
      connected,
      provider: "META_WHATSAPP",
      label: connected
        ? integration?.displayPhoneNumber ?? "WhatsApp Bağlı"
        : "Bağlı değil",
      isMock: false,
      connectionStatus: integration?.connectionStatus ?? "DISCONNECTED",
      displayPhoneNumber: integration?.displayPhoneNumber ?? null,
    };
  } else {
    whatsappStatus = {
      connected: false,
      provider: "META_WHATSAPP",
      label: "Meta modu (tenant gerekli)",
      isMock: false,
    };
  }

  return {
    whatsapp: whatsappStatus,
    sms: {
      connected: smsProvider.isAvailable(),
      provider: smsProvider.name,
      label: smsProvider.isAvailable() ? "Geliştirme (mock)" : "Bağlı değil",
      isMock: true,
    },
    bank: {
      connected: false,
      label: "Manuel Yönetim Aktif",
      note: "Canlı Banka Bağlantısı Yakında",
    },
    email: {
      connected: emailStatus.connected,
      label: emailStatus.label,
      status: emailStatus.status,
    },
  };
}
