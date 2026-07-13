import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { THEMES, type ThemeName, getThemeByName } from "./themes";

type ThemeContextValue = {
  theme: ThemeName;
  setTheme: (name: ThemeName) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function applyTheme(name: ThemeName) {
  const t = getThemeByName(name);
  for (const [k, v] of Object.entries(t.vars)) {
    document.documentElement.style.setProperty(k, v);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    try {
      const stored = localStorage.getItem("theme");
      if (stored && THEMES.some(t => t.name === stored)) return stored as ThemeName;
    } catch {}
    return "dark";
  });

  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem("theme", theme); } catch {}
  }, [theme]);

  const setTheme = (name: ThemeName) => setThemeState(name);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
