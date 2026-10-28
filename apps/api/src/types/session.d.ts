import "express-session";

declare module "express-session" {
  interface SessionData {
    adminId?: string;
    /** OAuth 防 CSRF 的随机 state（authorize 存、callback 校验）。 */
    baiduOAuthState?: string;
  }
}
