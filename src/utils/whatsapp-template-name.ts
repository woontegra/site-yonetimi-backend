/** Müvekkil Kasası şablon öneki. Meta’dan silinmez; Site Yönetimi listelerinde gizlenir. */
export function isMkPrefixedTemplateName(name: string): boolean {
  return name.trim().toLowerCase().startsWith("mk_");
}

/** Bu uygulamada oluşturulan / sahiplenilen şablonlar. */
export function isOwnedSiteYonetimiTemplate(row: {
  name: string;
  source: string;
  libraryKey?: string | null;
}): boolean {
  if (isMkPrefixedTemplateName(row.name)) return false;
  return row.source === "LIBRARY" || row.source === "CUSTOM" || Boolean(row.libraryKey);
}
