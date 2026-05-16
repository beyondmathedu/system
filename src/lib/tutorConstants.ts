/** 對應 Tutor 頁 Inactive；此狀態的導師不應在其他頁面顯示 */
export const TUTOR_STATUS_INACTIVE = "已解僱";

export const TUTOR_STATUS_ACTIVE = "工作中";
export const TUTOR_STATUS_OCCASIONAL = "放假中";

/** 共用 iPad 登入帳（Auth email）；可進全部課室並記錄出席／堂後小結 */
export const TUTOR_SHARED_IPAD_EMAIL = "hk6896554@gmail.com";

/** 共用 iPad 登入帳（public.tutors）；非真實授課導師 */
export const TUTOR_SHARED_IPAD_DISPLAY_NAME = "iPad Shared";

export function isSharedIpadTutorDisplayName(name: string): boolean {
  return name.trim().toLowerCase() === TUTOR_SHARED_IPAD_DISPLAY_NAME.toLowerCase();
}
