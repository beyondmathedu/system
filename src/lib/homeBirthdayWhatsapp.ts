/** Home birthday WhatsApp reminder contact (HK mobile, no country code in label). */
export const HOME_BIRTHDAY_WHATSAPP_LOCAL = "62037090";
export const HOME_BIRTHDAY_WHATSAPP_E164 = `852${HOME_BIRTHDAY_WHATSAPP_LOCAL}`;
export const HOME_BIRTHDAY_WHATSAPP_LABEL = `WhatsApp 提醒 ${HOME_BIRTHDAY_WHATSAPP_LOCAL}`;

export function homeBirthdayWhatsappHref(message: string): string {
  return `https://wa.me/${HOME_BIRTHDAY_WHATSAPP_E164}?text=${encodeURIComponent(message)}`;
}
