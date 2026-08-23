import type { WhatsAppParameterField } from "../services/whatsapp-integration.service";

export type WhatsAppLibraryTemplate = {
  key: string;
  displayName: string;
  description: string;
  language: string;
  category: string;
  suggestedMetaName: string;
  bodyText: string;
  parameterMapping: Record<string, WhatsAppParameterField>;
  variableLabels: Record<string, string>;
};

const SITE_GONDEREN_LABEL = "Site adı (gönderen)";

export const WHATSAPP_TEMPLATE_LIBRARY: WhatsAppLibraryTemplate[] = [
  {
    key: "aidat_hatirlatma",
    displayName: "Aidat Hatırlatma",
    description: "Aidat borcu ve son ödeme tarihi hatırlatması.",
    language: "tr",
    category: "UTILITY",
    suggestedMetaName: "aidat_hatirlatma",
    bodyText:
      "Sayın {{1}}, {{2}} sitesindeki {{3}} numaralı dairenize ait {{4}} tutarında aidat borcunuz bulunmaktadır. Son ödeme tarihi {{5}}. Bilginize sunarız. Bu mesaj {{6}} tarafından gönderilmiştir.",
    parameterMapping: {
      "1": "adSoyad",
      "2": "siteAdi",
      "3": "daireNo",
      "4": "borcTutari",
      "5": "vadeTarihi",
      "6": "siteAdi",
    },
    variableLabels: {
      "1": "Ad Soyad",
      "2": "Site adı",
      "3": "Daire no",
      "4": "Borç tutarı",
      "5": "Vade tarihi",
      "6": SITE_GONDEREN_LABEL,
    },
  },
  {
    key: "vade_gunu_hatirlatma",
    displayName: "Vade Günü Hatırlatma",
    description: "Vade günü aidat borcu hatırlatması.",
    language: "tr",
    category: "UTILITY",
    suggestedMetaName: "vade_gunu_hatirlatma",
    bodyText:
      "Sayın {{1}}, {{2}} sitesindeki {{3}} numaralı dairenize ait {{4}} tutarındaki ödemenizin son ödeme tarihi bugündür. Bilginize sunarız. Bu mesaj {{5}} tarafından gönderilmiştir.",
    parameterMapping: {
      "1": "adSoyad",
      "2": "siteAdi",
      "3": "daireNo",
      "4": "borcTutari",
      "5": "siteAdi",
    },
    variableLabels: {
      "1": "Ad Soyad",
      "2": "Site adı",
      "3": "Daire no",
      "4": "Borç tutarı",
      "5": SITE_GONDEREN_LABEL,
    },
  },
  {
    key: "gecikmis_aidat",
    displayName: "Gecikmiş Aidat",
    description: "Vadesi geçmiş aidat borcu hatırlatması.",
    language: "tr",
    category: "UTILITY",
    suggestedMetaName: "gecikmis_aidat",
    bodyText:
      "Sayın {{1}}, {{2}} sitesindeki {{3}} numaralı dairenize ait {{4}} tutarındaki borcun son ödeme tarihi geçmiştir. Güncel borç durumunuzu kontrol etmenizi rica ederiz. Bu mesaj {{5}} tarafından gönderilmiştir.",
    parameterMapping: {
      "1": "adSoyad",
      "2": "siteAdi",
      "3": "daireNo",
      "4": "borcTutari",
      "5": "siteAdi",
    },
    variableLabels: {
      "1": "Ad Soyad",
      "2": "Site adı",
      "3": "Daire no",
      "4": "Borç tutarı",
      "5": SITE_GONDEREN_LABEL,
    },
  },
  {
    key: "kismi_odeme_kalan_borc",
    displayName: "Kısmi Ödeme Sonrası Kalan Borç",
    description: "Kısmi ödeme sonrası kalan borç tutarı bildirimi.",
    language: "tr",
    category: "UTILITY",
    suggestedMetaName: "kismi_odeme_kalan_borc",
    bodyText:
      "Sayın {{1}}, ödemeniz için teşekkür ederiz. {{2}} sitesindeki {{3}} numaralı dairenize ait kalan borç tutarınız {{4}}'dir. Bilginize sunarız. Bu mesaj {{5}} tarafından gönderilmiştir.",
    parameterMapping: {
      "1": "adSoyad",
      "2": "siteAdi",
      "3": "daireNo",
      "4": "borcTutari",
      "5": "siteAdi",
    },
    variableLabels: {
      "1": "Ad Soyad",
      "2": "Site adı",
      "3": "Daire no",
      "4": "Kalan borç tutarı",
      "5": SITE_GONDEREN_LABEL,
    },
  },
  {
    key: "genel_borc_hatirlatma",
    displayName: "Genel Borç Hatırlatma",
    description: "Genel borç hatırlatma mesajı.",
    language: "tr",
    category: "UTILITY",
    suggestedMetaName: "genel_borc_hatirlatma",
    bodyText:
      "Sayın {{1}}, {{2}} sitesindeki {{3}} numaralı dairenize ait güncel borç tutarınız {{4}}'dir. Borç durumunuzu kontrol etmenizi rica ederiz. Bu mesaj {{5}} tarafından gönderilmiştir.",
    parameterMapping: {
      "1": "adSoyad",
      "2": "siteAdi",
      "3": "daireNo",
      "4": "borcTutari",
      "5": "siteAdi",
    },
    variableLabels: {
      "1": "Ad Soyad",
      "2": "Site adı",
      "3": "Daire no",
      "4": "Borç tutarı",
      "5": SITE_GONDEREN_LABEL,
    },
  },
];

const libraryByKey = new Map(WHATSAPP_TEMPLATE_LIBRARY.map((item) => [item.key, item]));

export function getLibraryTemplate(key: string): WhatsAppLibraryTemplate | undefined {
  return libraryByKey.get(key);
}
