// api/user.ts — ログイン中ユーザー (mock)
import { APP_DATA, type User } from "../data";

export const getCurrentUser = (): User => APP_DATA.user;
