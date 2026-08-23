import type { MessageProvider, MessageProviderSendInput, MessageProviderSendResult } from "./message-provider";
import {
  sendTemplateMessage,
  MetaWhatsAppClientError,
} from "./meta-whatsapp-client";

export type MetaWhatsAppProviderConfig = {
  phoneNumberId: string;
  accessToken: string;
};

export class MetaWhatsAppProvider implements MessageProvider {
  readonly name = "META_WHATSAPP";

  constructor(private readonly config: MetaWhatsAppProviderConfig) {}

  isAvailable(): boolean {
    return Boolean(this.config.phoneNumberId && this.config.accessToken);
  }

  async send(input: MessageProviderSendInput): Promise<MessageProviderSendResult> {
    if (!this.isAvailable()) {
      return {
        status: "FAILED",
        provider: this.name,
        errorMessage: "WhatsApp bağlantısı kurulmamış.",
      };
    }

    if (!input.whatsAppTemplate) {
      return {
        status: "FAILED",
        provider: this.name,
        errorMessage: "WhatsApp şablon bilgisi eksik.",
      };
    }

    try {
      const result = await sendTemplateMessage({
        phoneNumberId: this.config.phoneNumberId,
        accessToken: this.config.accessToken,
        to: input.toPhone,
        templateName: input.whatsAppTemplate.name,
        languageCode: input.whatsAppTemplate.language,
        bodyParameters: input.whatsAppTemplate.bodyParameters,
      });

      const messageId = result.messages?.[0]?.id ?? null;
      return {
        status: "SENT",
        provider: this.name,
        providerMessageId: messageId,
        sentAt: new Date(),
      };
    } catch (error) {
      const message =
        error instanceof MetaWhatsAppClientError
          ? error.message
          : "WhatsApp mesajı gönderilemedi.";
      return {
        status: "FAILED",
        provider: this.name,
        errorMessage: message,
      };
    }
  }
}
