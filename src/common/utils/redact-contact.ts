export interface RedactionResult { text: string; redacted: boolean; }

/**
 * Keeps booking conversations on Ojaly by hiding direct contact details.
 * The original text is never stored.
 */
export function redactContactDetails(input: string): RedactionResult {
  let text = String(input || '');
  let redacted = false;
  // Links first, so phone/email masking cannot leave fragments of a URL behind.
  text = text.replace(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi, () => { redacted = true; return '[link hidden]'; });
  text = text.replace(/\b(?:wa\.me|api\.whatsapp\.com|t\.me|instagram\.com|snapchat\.com)\/[^\s<>"']*/gi, () => { redacted = true; return '[link hidden]'; });
  // Email addresses.
  text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, () => { redacted = true; return '[email hidden]'; });
  // Nigerian mobile numbers, including +234 and spaced formats.
  text = text.replace(/(?:\+?234|0)[\s.-]?[789][01](?:[\s.-]?\d){8}\b/g, () => { redacted = true; return '[phone hidden]'; });
  // Other long international numbers.
  text = text.replace(/(?<!\d)(?:\+?\d[\d\s().-]{8,}\d)(?!\d)/g, (value) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) return value;
    redacted = true;
    return '[phone hidden]';
  });
  // Bare WhatsApp/Instagram handles.
  text = text.replace(/(^|\s)@[a-z0-9._]{3,30}\b/gi, (_match, prefix) => { redacted = true; return `${prefix}[social handle hidden]`; });
  return { text: text.trim(), redacted };
}
