"use client";

import { useState } from "react";

// テーマ切替（ライト/ダーク・カラースキーム）。WorkLedger design-spec §12 準拠。
// 初期値は layout.tsx の同期スクリプト（beforeInteractive）で
// data-theme / data-color-scheme に設定済み。ここでは切替UIの操作と
// localStorage（wl_theme_mode / wl_color_scheme）への保存のみを担当する。
// 初期state はレンダー中（lazy initializer）にDOM属性から読む。SSR時はdocument未定義のため既定値を返す。

type ThemeMode = "light" | "dark";
type ColorScheme = "default" | "heroui";

export default function ThemeToggle() {
  const [theme, setThemeState] = useState<ThemeMode>(() =>
    typeof document === "undefined"
      ? "light"
      : (document.documentElement.getAttribute("data-theme") as ThemeMode) || "light"
  );
  const [scheme, setSchemeState] = useState<ColorScheme>(() =>
    typeof document === "undefined"
      ? "default"
      : (document.documentElement.getAttribute("data-color-scheme") as ColorScheme) || "default"
  );

  function setTheme(next: ThemeMode) {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("wl_theme_mode", next);
    } catch {
      // localStorage不可時は保存をスキップ
    }
    setThemeState(next);
  }

  function setScheme(next: ColorScheme) {
    document.documentElement.setAttribute("data-color-scheme", next);
    try {
      localStorage.setItem("wl_color_scheme", next);
    } catch {
      // localStorage不可時は保存をスキップ
    }
    setSchemeState(next);
  }

  return (
    <div className="theme-controls">
      <div className="scheme-toggle" role="group" aria-label="カラースキーム切替">
        <button
          type="button"
          className={`scheme-btn${scheme === "default" ? " active" : ""}`}
          data-scheme="default"
          title="デフォルト（ブルー）"
          aria-label="デフォルト配色"
          onClick={() => setScheme("default")}
        />
        <button
          type="button"
          className={`scheme-btn${scheme === "heroui" ? " active" : ""}`}
          data-scheme="heroui"
          title="HeroUI風"
          aria-label="HeroUI風配色"
          onClick={() => setScheme("heroui")}
        />
      </div>
      <button
        type="button"
        className="theme-toggle-btn"
        title="ライト/ダーク切替"
        aria-label="ライト・ダークモード切替"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      >
        <svg className="icon-sun" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
        <svg className="icon-moon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
        </svg>
      </button>
    </div>
  );
}
