import { env } from "../config/env";

export type MetaTemplateComponent = {
  type: string;
  format?: string;
  text?: string;
  buttons?: Array<{ type: string; text?: string; url?: string }>;
  example?: { body_text?: string[][]; header_text?: string[] };
};

export type MetaMessageTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category?: string;
  components?: MetaTemplateComponent[];
  rejected_reason?: string;
  rejection_reason?: string;
};

export type MetaPhoneNumberInfo = {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
};

type GraphError = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
};

export class MetaWhatsAppClientError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "MetaWhatsAppClientError";
    this.statusCode = statusCode;
  }
}

function baseUrl(): string {
  return `https://graph.facebook.com/${env.whatsappGraphApiVersion}`;
}

function sanitizeMetaError(status: number, body: GraphError): string {
  const code = body.error?.code;
  const message = (body.error?.message ?? "").toLowerCase();

  if (status === 401 || code === 190 || message.includes("invalid oauth")) {
    return "WhatsApp erişim anahtarı geçersiz veya süresi dolmuş.";
  }
  if (status === 403 || code === 10 || message.includes("permission")) {
    return "WhatsApp API izni yetersiz. Gerekli izinleri kontrol edin.";
  }
  if (message.includes("template") && message.includes("not found")) {
    return "WhatsApp şablonu bulunamadı veya onaylı değil.";
  }
  if (message.includes("parameter") || message.includes("variable")) {
    return "WhatsApp şablon parametreleri eşleşmiyor.";
  }
  if (status === 429 || code === 4 || code === 80007) {
    return "WhatsApp API istek limiti aşıldı. Lütfen daha sonra tekrar deneyin.";
  }
  if (status === 400 && message.includes("phone")) {
    return "Alıcı telefon numarası geçersiz.";
  }
  return "WhatsApp bağlantısı doğrulanamadı.";
}

async function graphFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.whatsappHttpTimeoutMs);

  try {
    const url = path.startsWith("http") ? path : `${baseUrl()}${path}`;
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    const text = await response.text();
    let json: T & GraphError = {} as T & GraphError;
    if (text) {
      try {
        json = JSON.parse(text) as T & GraphError;
      } catch {
        throw new MetaWhatsAppClientError("WhatsApp bağlantısı doğrulanamadı.", response.status);
      }
    }

    if (!response.ok) {
      throw new MetaWhatsAppClientError(
        sanitizeMetaError(response.status, json),
        response.status,
      );
    }

    return json;
  } catch (error) {
    if (error instanceof MetaWhatsAppClientError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new MetaWhatsAppClientError("WhatsApp API isteği zaman aşımına uğradı.");
    }
    throw new MetaWhatsAppClientError("WhatsApp bağlantısı doğrulanamadı.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function getPhoneNumber(
  phoneNumberId: string,
  accessToken: string,
): Promise<MetaPhoneNumberInfo> {
  return graphFetch<MetaPhoneNumberInfo>(
    `/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`,
    accessToken,
  );
}

export async function listMessageTemplates(
  wabaId: string,
  accessToken: string,
): Promise<MetaMessageTemplate[]> {
  const results: MetaMessageTemplate[] = [];
  let nextUrl: string | null =
    `${baseUrl()}/${wabaId}/message_templates?limit=100&fields=id,name,language,status,category,components`;

  while (nextUrl) {
    const currentUrl = nextUrl;
    const page: { data?: MetaMessageTemplate[]; paging?: { next?: string } } =
      await graphFetch<{ data?: MetaMessageTemplate[]; paging?: { next?: string } }>(
        currentUrl,
        accessToken,
      );
    if (page.data?.length) results.push(...page.data);
    nextUrl = page.paging?.next ?? null;
  }

  return results;
}

export type CreateMessageTemplateInput = {
  wabaId: string;
  accessToken: string;
  name: string;
  language: string;
  category: string;
  bodyText: string;
  bodyExampleParams: string[];
};

export async function createMessageTemplate(
  input: CreateMessageTemplateInput,
): Promise<{ id: string }> {
  try {
    return await graphFetch<{ id: string }>(
      `/${input.wabaId}/message_templates`,
      input.accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          language: input.language,
          category: input.category,
          components: [
            {
              type: "BODY",
              text: input.bodyText,
              example: {
                body_text: [input.bodyExampleParams],
              },
            },
          ],
        }),
      },
    );
  } catch (error) {
    if (error instanceof MetaWhatsAppClientError) {
      throw new MetaWhatsAppClientError(
        "Şablon Meta'ya gönderilemedi. Şablon içeriğini ve WhatsApp bağlantınızı kontrol edin.",
        error.statusCode,
      );
    }
    throw error;
  }
}

export type SendTemplateMessageInput = {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  templateName: string;
  languageCode: string;
  bodyParameters: string[];
};

export type SendTemplateMessageResult = {
  messages: Array<{ id: string }>;
};

export async function sendTemplateMessage(
  input: SendTemplateMessageInput,
): Promise<SendTemplateMessageResult> {
  const components =
    input.bodyParameters.length > 0
      ? [
          {
            type: "body",
            parameters: input.bodyParameters.map((text) => ({
              type: "text",
              text,
            })),
          },
        ]
      : undefined;

  return graphFetch<SendTemplateMessageResult>(
    `/${input.phoneNumberId}/messages`,
    input.accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: input.to.replace(/\D/g, ""),
        type: "template",
        template: {
          name: input.templateName,
          language: { code: input.languageCode },
          ...(components ? { components } : {}),
        },
      }),
    },
  );
}
